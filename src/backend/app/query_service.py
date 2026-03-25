from __future__ import annotations

import logging
import os
import re
from textwrap import dedent

import google.generativeai as genai

from .database import get_connection
from .guardrails import validate_sql_read_only

logger = logging.getLogger(__name__)

# ── Few-shot examples grounded in the real SAP O2C schema ──────────────────
FEW_SHOTS = """
-- Q1 -- Which products are associated with the highest number of billing documents?
-- (billing_document_items.material links directly to products.product)
SELECT p.product, COUNT(DISTINCT bi.billing_document) AS billing_doc_count
FROM products p
JOIN billing_document_items bi ON bi.material = p.product
GROUP BY p.product
ORDER BY billing_doc_count DESC
LIMIT 20;

-- Q2 -- Trace the complete O2C document flow
-- sales_order_headers → outbound_delivery_items (via reference_sd_document = sales_order)
-- → outbound_delivery_headers (via delivery_document)
-- → billing_document_items (via reference_sd_document = delivery_document)
-- → billing_document_headers (via billing_document)
-- → journal_entry_items_accounts_receivable (via reference_document = billing_document)
SELECT
    soh.sales_order,
    soh.sold_to_party,
    soh.total_net_amount,
    soh.overall_delivery_status,
    soh.overall_ord_reltd_billg_status,
    odh.delivery_document,
    bdh.billing_document,
    bdh.billing_document_date,
    bdh.total_net_amount AS billed_amount,
    je.accounting_document
FROM sales_order_headers soh
LEFT JOIN outbound_delivery_items odi ON odi.reference_sd_document = soh.sales_order
LEFT JOIN outbound_delivery_headers odh ON odh.delivery_document = odi.delivery_document
LEFT JOIN billing_document_items bi ON bi.reference_sd_document = odi.delivery_document
LEFT JOIN billing_document_headers bdh ON bdh.billing_document = bi.billing_document
LEFT JOIN journal_entry_items_accounts_receivable je ON je.reference_document = bdh.billing_document
LIMIT 50;

-- Q3 -- Identify sales orders that are delivered but not fully billed (broken/incomplete O2C flow)
SELECT DISTINCT
    soh.sales_order,
    soh.sold_to_party,
    soh.overall_delivery_status,
    soh.overall_ord_reltd_billg_status,
    soh.total_net_amount
FROM sales_order_headers soh
WHERE soh.overall_delivery_status = 'C'
    AND (soh.overall_ord_reltd_billg_status IS NULL
             OR soh.overall_ord_reltd_billg_status = ''
             OR soh.overall_ord_reltd_billg_status != 'C')
ORDER BY soh.sales_order
LIMIT 100;
"""


class QueryService:
    def __init__(self) -> None:
        self.model_name = os.getenv("GEMINI_MODEL", "")
        self.model_candidates: list[str] = []
        self._models: dict[str, object] = {}
        api_key = os.getenv("GEMINI_API_KEY")
        self.model = None
        if api_key:
            genai.configure(api_key=api_key)
            self.model_candidates = self._resolve_model_candidates(self.model_name)
            if self.model_candidates:
                self.model_name = self.model_candidates[0]
                self.model = genai.GenerativeModel(self.model_name)
                self._models[self.model_name] = self.model
            logger.info("gemini_init configured=%s resolved_candidates=%s", bool(self.model_name), self.model_candidates)
        else:
            logger.warning("gemini_init skipped: GEMINI_API_KEY missing")

    def _resolve_model_candidates(self, configured: str) -> list[str]:
        preferred = [
            configured.strip().removeprefix("models/") if configured else "",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
            "gemini-1.5-flash-latest",
            "gemini-1.5-pro-latest",
        ]
        preferred = [p for p in preferred if p]

        try:
            available = {
                m.name.removeprefix("models/")
                for m in genai.list_models()
                if "generateContent" in getattr(m, "supported_generation_methods", [])
            }
        except Exception:
            logger.exception("gemini_list_models_failed")
            # If model listing fails, try preferred names in order.
            return list(dict.fromkeys(preferred))

        candidates = [name for name in preferred if name in available]
        if not candidates and available:
            candidates = [next(iter(available))]
        return list(dict.fromkeys(candidates))

    def _get_model(self, model_name: str):
        cached = self._models.get(model_name)
        if cached is not None:
            return cached
        model = genai.GenerativeModel(model_name)
        self._models[model_name] = model
        return model

    def _generate_sql_with_model_fallback(self, prompt: str) -> str | None:
        for candidate in self.model_candidates:
            try:
                model = self._get_model(candidate)
                response = model.generate_content(prompt)
                raw = (response.text or "").strip()
                sql = raw.replace("```sql", "").replace("```", "").strip()
                if not sql:
                    logger.warning("gemini_empty_response model=%s", candidate)
                    continue
                self.model_name = candidate
                logger.info("gemini_generate_success model=%s", candidate)
                return sql
            except Exception as exc:
                logger.warning("gemini_generate_failed model=%s error=%s", candidate, exc)
        return None

    def _schema_context(self) -> tuple[str, set[str]]:
        lines = []
        allowed_tables: set[str] = set()
        with get_connection() as conn:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
            for row in tables:
                table = row[0]
                if table == "app_metadata":
                    continue
                allowed_tables.add(table)
                cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
                lines.append(f"- {table}({', '.join(cols)})")
        return "\n".join(lines), allowed_tables

    @staticmethod
    def _extract_billing_document(question: str) -> str | None:
        match = re.search(r"\b\d{6,}\b", question)
        return match.group(0) if match else None

    @staticmethod
    def _is_top_products_query(question_lower: str) -> bool:
        return (
            ("highest" in question_lower or "most" in question_lower)
            and ("billing" in question_lower or "invoice" in question_lower)
            and "product" in question_lower
        )

    @staticmethod
    def _is_flow_trace_query(question_lower: str) -> bool:
        wants_flow = any(token in question_lower for token in ("trace", "flow", "full", "o2c"))
        has_doc_context = any(
            token in question_lower
            for token in ("order", "billing", "document", "delivery", "invoice", "trace", "flow")
        )
        return wants_flow and has_doc_context

    @staticmethod
    def _is_delivered_not_billed_query(question_lower: str) -> bool:
        mentions_delivery = "delivered" in question_lower or "delivery" in question_lower
        mentions_gap = any(token in question_lower for token in ("not billed", "unbilled", "broken", "incomplete"))
        return mentions_delivery and mentions_gap

    @staticmethod
    def _is_billed_not_delivered_query(question_lower: str) -> bool:
        return "billed" in question_lower and any(token in question_lower for token in ("not delivered", "without delivery"))

    @staticmethod
    def _sql_top_products() -> str:
        return dedent("""
            SELECT p.product, COUNT(DISTINCT bi.billing_document) AS billing_doc_count
            FROM products p
            JOIN billing_document_items bi ON bi.material = p.product
            GROUP BY p.product
            ORDER BY billing_doc_count DESC
            LIMIT 20
        """).strip()

    @staticmethod
    def _sql_flow_trace(billing_doc: str | None) -> str:
        where_clause = f"WHERE bdh.billing_document = '{billing_doc}'" if billing_doc else ""
        return dedent("""
            SELECT soh.sales_order, soh.sold_to_party, soh.overall_delivery_status,
                   soh.overall_ord_reltd_billg_status, soh.total_net_amount,
                   odh.delivery_document, bdh.billing_document, bdh.total_net_amount AS billed_amount,
                   je.accounting_document
            FROM sales_order_headers soh
            LEFT JOIN outbound_delivery_items odi ON odi.reference_sd_document = soh.sales_order
            LEFT JOIN outbound_delivery_headers odh ON odh.delivery_document = odi.delivery_document
            LEFT JOIN billing_document_items bi ON bi.reference_sd_document = odi.delivery_document
            LEFT JOIN billing_document_headers bdh ON bdh.billing_document = bi.billing_document
            LEFT JOIN journal_entry_items_accounts_receivable je ON je.reference_document = bdh.billing_document
            {where_clause}
            LIMIT 50
        """).format(where_clause=where_clause).strip()

    @staticmethod
    def _sql_delivered_not_billed() -> str:
        return dedent("""
            SELECT DISTINCT soh.sales_order, soh.sold_to_party,
                   soh.overall_delivery_status, soh.overall_ord_reltd_billg_status,
                   soh.total_net_amount
            FROM sales_order_headers soh
            WHERE soh.overall_delivery_status = 'C'
              AND (soh.overall_ord_reltd_billg_status IS NULL
                   OR soh.overall_ord_reltd_billg_status = ''
                   OR soh.overall_ord_reltd_billg_status != 'C')
            ORDER BY soh.sales_order
            LIMIT 100
        """).strip()

    @staticmethod
    def _sql_billed_not_delivered() -> str:
        return dedent("""
            SELECT DISTINCT soh.sales_order, soh.sold_to_party,
                   soh.overall_delivery_status, soh.overall_ord_reltd_billg_status,
                   soh.total_net_amount
            FROM sales_order_headers soh
            WHERE soh.overall_ord_reltd_billg_status = 'C'
              AND (soh.overall_delivery_status IS NULL
                   OR soh.overall_delivery_status != 'C')
            ORDER BY soh.sales_order
            LIMIT 100
        """).strip()

    def _fallback_sql(self, question: str, allowed_tables: set[str]) -> str:
        question_lower = question.lower()
        billing_doc = self._extract_billing_document(question)

        if self._is_top_products_query(question_lower) and {"products", "billing_document_items"}.issubset(allowed_tables):
            logger.info("deterministic_match query=top_products")
            return self._sql_top_products()

        if self._is_flow_trace_query(question_lower) and {
            "sales_order_headers",
            "outbound_delivery_headers",
            "billing_document_headers",
        }.issubset(allowed_tables):
            logger.info("deterministic_match query=flow_trace billing_doc=%s", billing_doc)
            return self._sql_flow_trace(billing_doc)

        if self._is_delivered_not_billed_query(question_lower) and "sales_order_headers" in allowed_tables:
            logger.info("deterministic_match query=delivered_not_billed")
            return self._sql_delivered_not_billed()

        if self._is_billed_not_delivered_query(question_lower) and "sales_order_headers" in allowed_tables:
            logger.info("deterministic_match query=billed_not_delivered")
            return self._sql_billed_not_delivered()

        return "SELECT 'Could not confidently map question to schema. Please be more specific.' AS message LIMIT 1"

    def generate_sql(self, question: str) -> tuple[str, set[str], str, str | None]:
        schema_text, allowed_tables = self._schema_context()
        deterministic_sql = self._fallback_sql(question, allowed_tables)
        fallback_message = "could not confidently map question to schema"

        # Keep required query classes deterministic for reliability in demos/reviews.
        if fallback_message not in deterministic_sql.lower():
            logger.info("sql_generation_mode=deterministic")
            return deterministic_sql, allowed_tables, "deterministic", None

        if not self.model_candidates:
            logger.info("sql_generation_mode=fallback_no_model")
            return deterministic_sql, allowed_tables, "fallback", None

        prompt = dedent(f"""
            You are a SAP ERP analytics SQL generator for SQLite.
            Produce exactly ONE read-only SQL SELECT query and NOTHING else — no explanation, no markdown fences.
            Use ONLY the tables and columns listed in the schema below.
            Always include LIMIT 200 or lower.
            Use LEFT JOINs for optional relationships (e.g., tracing document flows where some steps may be missing).
            Key relationships in the SAP O2C dataset:
              - billing_document_items.material → products.product  [DIRECT join for product-billing analysis]
              - outbound_delivery_items.reference_sd_document → sales_order_headers.sales_order
              - outbound_delivery_items.delivery_document → outbound_delivery_headers.delivery_document
              - billing_document_items.reference_sd_document → outbound_delivery_headers.delivery_document  [NOT sales_order!]
              - billing_document_items.billing_document → billing_document_headers.billing_document
              - journal_entry_items_accounts_receivable.reference_document → billing_document_headers.billing_document
              - payments_accounts_receivable.sales_document → sales_order_headers.sales_order
              - sales_order_headers.sold_to_party → business_partners.business_partner

            Schema:
            {schema_text}

            Few-shot examples:
            {FEW_SHOTS}

            User question: {question}
        """)

        sql = self._generate_sql_with_model_fallback(prompt)
        if sql:
            logger.info("sql_generation_mode=gemini model=%s", self.model_name)
            return sql, allowed_tables, "gemini", self.model_name

        # Never fail the endpoint because of provider/model errors.
        logger.info("sql_generation_mode=fallback_after_model_failure")
        return deterministic_sql, allowed_tables, "fallback", None

    def run_query(self, sql: str) -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]

    def _build_answer(self, question: str, rows: list[dict]) -> str:
        if not rows:
            return "No data found for your query in the current dataset."
        q = question.lower()
        if "highest" in q or "most" in q:
            top = rows[0]
            key = next((k for k in top if "count" in k or "amount" in k or "doc" in k), None)
            if key:
                return f"Found {len(rows)} results. Top entry: {top} ({key}={top.get(key)})."
        if "trace" in q or "flow" in q:
            return f"Traced {len(rows)} document flow record(s) in the O2C chain."
        if "broken" in q or "incomplete" in q or "not billed" in q or "not delivered" in q:
            return f"Found {len(rows)} sales order(s) with an incomplete O2C flow."
        return f"Dataset query returned {len(rows)} record(s)."

    def ask(self, question: str) -> dict:
        sql, allowed_tables, generation_source, model_name = self.generate_sql(question)
        ok, checked = validate_sql_read_only(sql, allowed_tables)
        if not ok:
            logger.warning("sql_validation_failed error=%s", checked)
            return {
                "ok": False,
                "error": checked,
                "sql": sql,
                "rows": [],
                "answer": "",
                "generation_source": generation_source,
                "model_name": model_name,
            }

        try:
            rows = self.run_query(checked)
            logger.info("sql_query_executed rows=%d", len(rows))
            return {
                "ok": True,
                "sql": checked,
                "rows": rows,
                "answer": self._build_answer(question, rows),
                "generation_source": generation_source,
                "model_name": model_name,
            }
        except Exception as exc:
            logger.exception("sql_query_execution_failed error=%s", exc)

            # Try deterministic fallback SQL as a safe recovery path for bad model SQL.
            fallback_sql = self._fallback_sql(question, allowed_tables)
            fb_ok, fb_checked = validate_sql_read_only(fallback_sql, allowed_tables)
            if fb_ok and fb_checked != checked:
                try:
                    fb_rows = self.run_query(fb_checked)
                    logger.info("sql_query_fallback_executed rows=%d", len(fb_rows))
                    return {
                        "ok": True,
                        "sql": fb_checked,
                        "rows": fb_rows,
                        "answer": self._build_answer(question, fb_rows),
                        "generation_source": "deterministic-fallback",
                        "model_name": None,
                    }
                except Exception as fb_exc:
                    logger.exception("sql_query_fallback_failed error=%s", fb_exc)

            return {
                "ok": False,
                "error": "Generated SQL could not be executed safely. Please rephrase your question.",
                "sql": checked,
                "rows": [],
                "answer": "",
                "generation_source": generation_source,
                "model_name": model_name,
            }
