from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

from .database import ensure_internal_tables, get_connection


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    renamed = {}
    for col in df.columns:
        c = col.strip().lower().replace(" ", "_").replace("-", "_")
        renamed[col] = c
    return df.rename(columns=renamed)


def load_csv_folder(data_dir: str) -> dict:
    ensure_internal_tables()
    base = Path(data_dir)
    if not base.exists():
        raise FileNotFoundError(f"Data directory not found: {data_dir}")

    csv_files = sorted(base.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in {data_dir}")

    report = {"tables": [], "rows_loaded": 0, "files": []}

    with get_connection() as conn:
        for csv_file in csv_files:
            table_name = csv_file.stem.strip().lower().replace(" ", "_").replace("-", "_")
            df = pd.read_csv(csv_file)
            df = _normalize_columns(df)
            df.to_sql(table_name, conn, if_exists="replace", index=False)

            row_count = len(df.index)
            report["files"].append(str(csv_file.name))
            report["tables"].append({"table": table_name, "rows": row_count})
            report["rows_loaded"] += row_count

        conn.execute("INSERT OR REPLACE INTO app_metadata(key, value) VALUES (?, ?)", ("last_ingest_dir", str(base)))
        conn.commit()

    return report


def integrity_snapshot() -> dict:
    # Generic ID quality report, useful when dataset schema differs.
    id_col_stats = []
    with get_connection() as conn:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        for trow in tables:
            table = trow[0]
            if table == "app_metadata":
                continue
            cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
            for col in cols:
                col_name = col[1]
                if "id" not in col_name:
                    continue
                total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                non_null = conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE {col_name} IS NOT NULL AND TRIM(CAST({col_name} AS TEXT)) <> ''"
                ).fetchone()[0]
                id_col_stats.append(
                    {
                        "table": table,
                        "column": col_name,
                        "total_rows": total,
                        "non_null_rows": non_null,
                        "null_or_empty_rows": total - non_null,
                    }
                )
    return {"id_quality": id_col_stats}
