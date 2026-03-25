from __future__ import annotations

from .database import get_connection

# SAP O2C entity → primary key column
ENTITY_PK: dict[str, str] = {
    "sales_order_headers": "sales_order",
    "sales_order_items": "sales_order",
    "sales_order_schedule_lines": "sales_order",
    "outbound_delivery_headers": "delivery_document",
    "outbound_delivery_items": "delivery_document",
    "billing_document_headers": "billing_document",
    "billing_document_items": "billing_document",
    "billing_document_cancellations": "billing_document",
    "journal_entry_items_accounts_receivable": "accounting_document",
    "payments_accounts_receivable": "accounting_document",
    "business_partners": "business_partner",
    "business_partner_addresses": "business_partner",
    "customer_company_assignments": "customer",
    "customer_sales_area_assignments": "customer",
    "products": "product",
    "product_descriptions": "product",
    "product_plants": "product",
    "product_storage_locations": "product",
    "plants": "plant",
}

# Explicit O2C flow edges: (source_table, source_fk_col, target_table)
O2C_EDGES: list[tuple[str, str, str]] = [
    ("sales_order_items",           "sales_order",           "sales_order_headers"),
    ("sales_order_schedule_lines",  "sales_order",           "sales_order_headers"),
    ("sales_order_headers",         "sold_to_party",         "business_partners"),
    ("sales_order_items",           "material",              "products"),
    ("outbound_delivery_items",     "reference_sd_document", "sales_order_headers"),
    ("outbound_delivery_items",     "delivery_document",     "outbound_delivery_headers"),
    ("billing_document_items",      "reference_sd_document", "outbound_delivery_headers"),
    ("billing_document_items",      "material",              "products"),
    ("billing_document_items",      "billing_document",      "billing_document_headers"),
    ("billing_document_headers",    "sold_to_party",         "business_partners"),
    ("journal_entry_items_accounts_receivable", "reference_document", "billing_document_headers"),
    ("payments_accounts_receivable","sales_document",        "sales_order_headers"),
    ("product_descriptions",        "product",               "products"),
    ("product_plants",              "product",               "products"),
    ("product_plants",              "plant",                 "plants"),
    ("product_storage_locations",   "product",               "products"),
    ("business_partner_addresses",  "business_partner",      "business_partners"),
    ("customer_company_assignments","customer",              "business_partners"),
    ("customer_sales_area_assignments", "customer",          "business_partners"),
]

_COLOURS: dict[str, str] = {
    "sales_order_headers": "#005f73",
    "sales_order_items": "#0a9396",
    "outbound_delivery_headers": "#94d2bd",
    "outbound_delivery_items": "#52b788",
    "billing_document_headers": "#e9c46a",
    "billing_document_items": "#f4a261",
    "billing_document_cancellations": "#e76f51",
    "journal_entry_items_accounts_receivable": "#264653",
    "payments_accounts_receivable": "#2a9d8f",
    "business_partners": "#8338ec",
    "products": "#3a86ff",
    "plants": "#fb8500",
}


def _existing_tables(conn) -> set[str]:
    return {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        if r[0] != "app_metadata"
    }


def list_graph_nodes(limit_per_table: int = 25) -> dict:
    nodes = []
    seen_node_ids: set[str] = set()
    with get_connection() as conn:
        tables = _existing_tables(conn)
        for table in sorted(tables):
            pk = ENTITY_PK.get(table)
            if not pk:
                cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
                pk = cols[0] if cols else None
            if not pk:
                continue
            rows = conn.execute(f"SELECT * FROM {table} LIMIT ?", (limit_per_table,)).fetchall()
            colour = _COLOURS.get(table, "#888")
            for row in rows:
                rd = dict(row)
                pk_val = rd.get(pk, "?")
                node_id = f"{table}:{pk_val}"
                # Cytoscape requires globally unique element IDs.
                if node_id in seen_node_ids:
                    continue
                seen_node_ids.add(node_id)
                nodes.append({
                    "id": node_id,
                    "table": table,
                    "label": str(pk_val),
                    "group": table,
                    "colour": colour,
                    "data": rd,
                })
    return {"nodes": nodes}


def infer_graph_edges(limit_per_table: int = 200) -> dict:
    edges: list[dict] = []
    seen: set[str] = set()

    with get_connection() as conn:
        tables = _existing_tables(conn)
        for src_table, src_fk, tgt_table in O2C_EDGES:
            if src_table not in tables or tgt_table not in tables:
                continue
            src_pk = ENTITY_PK.get(src_table, src_fk)
            tgt_pk = ENTITY_PK.get(tgt_table, src_fk)
            src_cols = {r[1] for r in conn.execute(f"PRAGMA table_info({src_table})").fetchall()}
            tgt_cols = {r[1] for r in conn.execute(f"PRAGMA table_info({tgt_table})").fetchall()}
            if src_fk not in src_cols or tgt_pk not in tgt_cols:
                continue
            rows = conn.execute(
                f"SELECT {src_pk}, {src_fk} FROM {src_table} WHERE {src_fk} IS NOT NULL LIMIT ?",
                (limit_per_table,),
            ).fetchall()
            for row in rows:
                src_node = f"{src_table}:{row[0]}"
                tgt_node = f"{tgt_table}:{row[1]}"
                edge_id = f"{src_node}→{tgt_node}"
                if edge_id not in seen:
                    seen.add(edge_id)
                    edges.append({"id": edge_id, "source": src_node, "target": tgt_node, "label": src_fk})
    return {"edges": edges}
