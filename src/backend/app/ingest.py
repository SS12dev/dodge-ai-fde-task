from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import pandas as pd

from .database import ensure_internal_tables, get_connection

logger = logging.getLogger(__name__)

# The dataset lives under data/sap-o2c-data/  (JSONL files, one entity per sub-folder)
_SAP_SUBDIR = "sap-o2c-data"


def _normalize_key(name: str) -> str:
    """camelCase or kebab-case → snake_case."""
    import re
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower().replace("-", "_")


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns={c: _normalize_key(c) for c in df.columns})
    # SQLite can't store dict/list values — serialize them to JSON strings
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].apply(
                lambda v: json.dumps(v) if isinstance(v, (dict, list)) else v
            )
    return df


def _resolve_data_dir(data_dir: str) -> Path:
    """Return the sap-o2c-data sub-folder if it exists, otherwise the raw path."""
    base = Path(data_dir)
    candidate = base / _SAP_SUBDIR
    return candidate if candidate.exists() else base


def _load_jsonl_dir(folder: Path) -> pd.DataFrame | None:
    """Concatenate all .jsonl parts in a folder into a single DataFrame."""
    parts = sorted(folder.glob("*.jsonl"))
    if not parts:
        return None
    frames = []
    for p in parts:
        rows = []
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        if rows:
            frames.append(pd.DataFrame(rows))
    return pd.concat(frames, ignore_index=True) if frames else None


def load_csv_folder(data_dir: str) -> dict:
    """Load the SAP O2C JSONL dataset (or CSV fallback) into SQLite."""
    ensure_internal_tables()
    base = Path(data_dir)
    if not base.exists():
        raise FileNotFoundError(f"Data directory not found: {data_dir}")

    root = _resolve_data_dir(data_dir)
    logger.info("load_data_root root=%s", root)
    if not root.exists():
        raise FileNotFoundError(f"Data directory not found: {root}")

    # Try entity sub-folders first (JSONL layout)
    entity_dirs = [d for d in sorted(root.iterdir()) if d.is_dir()]
    if not entity_dirs:
        # Fallback: flat CSV files
        csv_files = sorted(root.glob("*.csv"))
        if not csv_files:
            raise FileNotFoundError(f"No CSV files found in {root}")
        entity_dirs = []  # handled below

    report: dict = {"tables": [], "rows_loaded": 0, "files": []}

    with get_connection() as conn:
        if entity_dirs:
            logger.info("load_mode=jsonl entity_dirs=%d", len(entity_dirs))
            for entity_dir in entity_dirs:
                table_name = _normalize_key(entity_dir.name)
                df = _load_jsonl_dir(entity_dir)
                if df is None or df.empty:
                    continue
                df = _normalize_columns(df)
                df.to_sql(table_name, conn, if_exists="replace", index=False)
                row_count = len(df)
                report["files"].append(entity_dir.name)
                report["tables"].append({"table": table_name, "rows": row_count})
                report["rows_loaded"] += row_count
                logger.info("table_loaded table=%s rows=%d", table_name, row_count)
        else:
            logger.info("load_mode=csv")
            for csv_file in sorted(root.glob("*.csv")):
                table_name = _normalize_key(csv_file.stem)
                df = pd.read_csv(csv_file)
                df = _normalize_columns(df)
                df.to_sql(table_name, conn, if_exists="replace", index=False)
                row_count = len(df)
                report["files"].append(csv_file.name)
                report["tables"].append({"table": table_name, "rows": row_count})
                report["rows_loaded"] += row_count
                logger.info("table_loaded table=%s rows=%d", table_name, row_count)

        conn.execute(
            "INSERT OR REPLACE INTO app_metadata(key, value) VALUES (?, ?)",
            ("last_ingest_dir", str(root)),
        )
        conn.commit()

    logger.info("load_complete tables=%d rows_loaded=%d", len(report["tables"]), report["rows_loaded"])

    return report


def integrity_snapshot() -> dict:
    """Row counts and non-null rates for key join columns across all tables."""
    KEY_COLS = {
        "billing_document_headers": "billing_document",
        "billing_document_items": "billing_document",
        "outbound_delivery_headers": "delivery_document",
        "outbound_delivery_items": "delivery_document",
        "sales_order_headers": "sales_order",
        "sales_order_items": "sales_order",
        "payments_accounts_receivable": "accounting_document",
        "journal_entry_items_accounts_receivable": "accounting_document",
        "products": "product",
        "business_partners": "business_partner",
    }
    stats = []
    with get_connection() as conn:
        existing = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        for table, col in KEY_COLS.items():
            if table not in existing:
                continue
            total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            non_null = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {col} IS NOT NULL AND TRIM(CAST({col} AS TEXT)) <> ''"
            ).fetchone()[0]
            stats.append({"table": table, "key_column": col, "total": total, "non_null": non_null})
    return {"integrity": stats}
