from __future__ import annotations

from collections import defaultdict

from .database import get_connection


def _pick_id_column(columns: list[str]) -> str | None:
    candidates = [c for c in columns if c == "id" or c.endswith("_id")]
    return candidates[0] if candidates else None


def list_graph_nodes(limit_per_table: int = 25) -> dict:
    nodes = []
    with get_connection() as conn:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        for trow in tables:
            table = trow[0]
            if table == "app_metadata":
                continue
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            id_col = _pick_id_column(cols)
            rows = conn.execute(f"SELECT * FROM {table} LIMIT ?", (limit_per_table,)).fetchall()
            for row in rows:
                row_dict = dict(row)
                node_id_value = row_dict.get(id_col) if id_col else row_dict.get(cols[0])
                node_id = f"{table}:{node_id_value}"
                nodes.append(
                    {
                        "id": node_id,
                        "table": table,
                        "label": str(node_id_value),
                        "data": row_dict,
                    }
                )
    return {"nodes": nodes}


def infer_graph_edges(limit_per_table: int = 200) -> dict:
    edges = []
    index_by_table_id = defaultdict(set)

    with get_connection() as conn:
        tables = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
            if r[0] != "app_metadata"
        ]

        table_columns = {}
        table_id_col = {}
        for table in tables:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            table_columns[table] = cols
            table_id_col[table] = _pick_id_column(cols)

            id_col = table_id_col[table]
            if id_col:
                id_rows = conn.execute(f"SELECT {id_col} FROM {table} LIMIT ?", (limit_per_table,)).fetchall()
                index_by_table_id[table].update(str(r[0]) for r in id_rows if r[0] is not None)

        for source_table in tables:
            cols = table_columns[source_table]
            fk_like_cols = [c for c in cols if c.endswith("_id") and c != table_id_col[source_table]]

            source_rows = conn.execute(f"SELECT * FROM {source_table} LIMIT ?", (limit_per_table,)).fetchall()
            for row in source_rows:
                record = dict(row)
                source_node = f"{source_table}:{record.get(table_id_col[source_table], record.get(cols[0]))}"
                for fk_col in fk_like_cols:
                    fk_val = record.get(fk_col)
                    if fk_val is None:
                        continue
                    fk_val = str(fk_val)
                    for target_table in tables:
                        if fk_val in index_by_table_id[target_table]:
                            target_id_col = table_id_col[target_table]
                            target_node = f"{target_table}:{fk_val}" if target_id_col else f"{target_table}:{fk_val}"
                            edges.append(
                                {
                                    "id": f"{source_node}->{target_node}:{fk_col}",
                                    "source": source_node,
                                    "target": target_node,
                                    "label": fk_col,
                                }
                            )

    return {"edges": edges}
