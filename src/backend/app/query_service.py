from __future__ import annotations

import os
from textwrap import dedent

import google.generativeai as genai

from .database import get_connection
from .guardrails import validate_sql_read_only


class QueryService:
    def __init__(self) -> None:
        self.model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
        api_key = os.getenv("GEMINI_API_KEY")
        self.model = None
        if api_key:
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(self.model_name)

    def _schema_context(self) -> tuple[str, set[str]]:
        lines = []
        allowed_tables = set()
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

    def _fallback_sql(self, question: str, allowed_tables: set[str]) -> str:
        q = question.lower()
        if "highest number of billing" in q or "highest number of invoice" in q:
            product_table = next((t for t in allowed_tables if "product" in t), None)
            invoice_table = next((t for t in allowed_tables if "invoice" in t or "billing" in t), None)
            item_table = next((t for t in allowed_tables if "item" in t and "order" in t), None)
            if product_table and invoice_table and item_table:
                return dedent(
                    f"""
                    SELECT p.*, COUNT(DISTINCT i.id) AS billing_docs
                    FROM {product_table} p
                    JOIN {item_table} oi ON oi.product_id = p.id
                    JOIN {invoice_table} i ON i.order_item_id = oi.id
                    GROUP BY p.id
                    ORDER BY billing_docs DESC
                    LIMIT 10
                    """
                ).strip()
        return "SELECT 'Could not confidently map question to schema. Please be more specific.' AS message LIMIT 1"

    def generate_sql(self, question: str) -> tuple[str, set[str]]:
        schema_text, allowed_tables = self._schema_context()

        if not self.model:
            return self._fallback_sql(question, allowed_tables), allowed_tables

        prompt = dedent(
            f"""
            You are an ERP analytics SQL generator for SQLite.
            Produce exactly one read-only SQL query and nothing else.
            Use only listed tables/columns.
            Always include LIMIT 200 or lower.

            Schema:
            {schema_text}

            User question:
            {question}
            """
        )

        response = self.model.generate_content(prompt)
        raw = (response.text or "").strip()
        sql = raw.replace("```sql", "").replace("```", "").strip()
        return sql, allowed_tables

    def run_query(self, sql: str) -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]

    def ask(self, question: str) -> dict:
        sql, allowed_tables = self.generate_sql(question)
        ok, checked = validate_sql_read_only(sql, allowed_tables)
        if not ok:
            return {"ok": False, "error": checked, "sql": sql, "rows": []}

        rows = self.run_query(checked)
        return {
            "ok": True,
            "sql": checked,
            "rows": rows,
            "answer": f"Returned {len(rows)} rows from dataset-backed query.",
        }
