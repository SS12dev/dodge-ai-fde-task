from __future__ import annotations

import re

import sqlparse

DOMAIN_KEYWORDS = {
    # core O2C document types
    "order", "deliver", "invoic", "billing", "payment",
    # entities
    "customer", "product", "material", "address", "sales", "sap", "journal",
    "partner", "plant", "document", "shipment",
    # SAP-specific terms
    "accounting", "fiscal", "companycode", "schedule", "cancellation",
    "outbound", "inbound", "billed", "unbilled", "blocked", "quantity", "currency",
    # analytics / flow
    "trace", "flow", "o2c", "status", "report", "history", "erp",
    "amount", "revenue", "open", "closed", "complete", "incomplete",
}

READ_ONLY_PREFIXES = ("select", "with")
FORBIDDEN_SQL = {"insert", "update", "delete", "drop", "alter", "truncate", "create", "attach", "pragma"}


def is_domain_question(question: str) -> bool:
    lowered = question.lower()
    return any(kw in lowered for kw in DOMAIN_KEYWORDS)


def validate_sql_read_only(sql: str, allowed_tables: set[str]) -> tuple[bool, str]:
    s = sql.strip().strip(";")
    if not s:
        return False, "Generated SQL is empty."

    normalized = s.lower()
    if not normalized.startswith(READ_ONLY_PREFIXES):
        return False, "Only read-only SQL queries are allowed."

    parsed = sqlparse.parse(s)
    if not parsed:
        return False, "Unable to parse SQL query."

    lowered_tokens = set(re.findall(r"[a-z_]+", normalized))
    if lowered_tokens.intersection(FORBIDDEN_SQL):
        return False, "Mutation statements are not allowed."

    table_mentions = set(re.findall(r"(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)", normalized))
    disallowed = [t for t in table_mentions if t not in allowed_tables]
    if disallowed:
        return False, f"Query references disallowed tables: {', '.join(disallowed)}"

    if "limit" not in normalized:
        s = f"{s} LIMIT 200"

    return True, s
