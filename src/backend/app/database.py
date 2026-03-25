import os
import sqlite3
from contextlib import contextmanager

_HERE = os.path.abspath(__file__)  # .../src/backend/app/database.py
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_HERE))))
DB_PATH = os.getenv("DB_PATH") or os.path.join(_REPO_ROOT, "data", "erp.db")


os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


@contextmanager
def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def ensure_internal_tables() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.commit()


def list_tables() -> list[str]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    return [row[0] for row in rows]
