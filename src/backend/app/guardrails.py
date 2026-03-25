from __future__ import annotations

import re

import sqlparse

DOMAIN_KEYWORDS = {
    "order",
    "delivery",
    "invoice",
    "billing",
    "payment",
    "customer",
    "product",
    "material",
    "address",
    "sales",
    "sap",
    "journal",
}

READ_ONLY_PREFIXES = ("select", "with")
FORBIDDEN_SQL = {"insert", "update", "delete", "drop", "alter", "truncate", "create", "attach", "pragma"}


def is_domain_question(question: str) -> bool:
    tokens = set(re.findall(r"[a-zA-Z]+", question.lower()))
    return len(tokens.intersection(DOMAIN_KEYWORDS)) > 0


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
