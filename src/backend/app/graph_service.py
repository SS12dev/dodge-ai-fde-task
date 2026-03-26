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


def _collect_connected_node_ids(conn, tables: set[str], limit_per_table: int) -> set[str]:
    """Traverse O2C_EDGES and collect all node IDs actually referenced in the dataset."""
    connected = set()
    for src_table, src_fk, tgt_table in O2C_EDGES:
        if src_table not in tables or tgt_table not in tables:
            continue
        src_pk = ENTITY_PK.get(src_table, src_fk)
        tgt_pk = ENTITY_PK.get(tgt_table, src_fk)
        src_cols = {r[1] for r in conn.execute(f"PRAGMA table_info({src_table})").fetchall()}
        tgt_cols = {r[1] for r in conn.execute(f"PRAGMA table_info({tgt_table})").fetchall()}
        if src_fk not in src_cols or tgt_pk not in tgt_cols:
            continue
        edge_limit = max(limit_per_table * 4, 120)
        rows = conn.execute(
            f"SELECT {src_pk}, {src_fk} FROM {src_table} WHERE {src_fk} IS NOT NULL LIMIT ?",
            (edge_limit,),
        ).fetchall()
        for row in rows:
            connected.add(f"{src_table}:{row[0]}")
            connected.add(f"{tgt_table}:{row[1]}")
    return connected


def _fetch_node(conn, table: str, pk: str, pk_val: str, colour: str) -> dict | None:
    """Fetch a single node's data from the database."""
    row = conn.execute(f"SELECT * FROM {table} WHERE {pk} = ?", (pk_val,)).fetchone()
    if not row:
        return None
    rd = dict(row)
    node_id = f"{table}:{pk_val}"
    return {
        "id": node_id,
        "table": table,
        "label": str(pk_val),
        "group": table,
        "colour": colour,
        "data": rd,
    }


def _collect_sample_nodes(conn, tables: set[str], seen_node_ids: set[str], sample_limit: int) -> list[dict]:
    """Fetch sample nodes from each table that aren't already in seen_node_ids.
    
    This ensures transparency—we show sample data even from disconnected tables
    so the user knows the full dataset structure, not just connected components.
    """
    sample_nodes = []
    for table in sorted(tables):
        pk = ENTITY_PK.get(table)
        if not pk:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            pk = cols[0] if cols else None
        if not pk:
            continue
        colour = _COLOURS.get(table, "#888")
        rows = conn.execute(f"SELECT * FROM {table} LIMIT ?", (sample_limit,)).fetchall()
        for row in rows:
            rd = dict(row)
            pk_val = rd.get(pk, "?")
            node_id = f"{table}:{pk_val}"
            if node_id not in seen_node_ids:
                sample_nodes.append({
                    "id": node_id,
                    "table": table,
                    "label": str(pk_val),
                    "group": table,
                    "colour": colour,
                    "data": rd,
                })
                seen_node_ids.add(node_id)
    return sample_nodes


def list_graph_nodes(limit_per_table: int = 25) -> dict:
    """
    Build nodes using edge-first strategy with transparency.
    
    1. Collect node IDs from edges (connected components)
    2. Fetch those connected nodes
    3. Supplement with sample nodes for full dataset visibility
    
    This ensures all entity types are visible in the graph, maintaining transparency
    while prioritizing connected relationships.
    
    limit_per_table controls how many connected nodes per table are shown.
    """
    nodes = []
    seen_node_ids: set[str] = set()

    with get_connection() as conn:
        tables = _existing_tables(conn)
        connected_node_ids = _collect_connected_node_ids(conn, tables, limit_per_table)
        table_to_ids: dict[str, list[str]] = {}
        for node_id in connected_node_ids:
            table, _ = node_id.split(":", 1)
            table_to_ids.setdefault(table, []).append(node_id)

        # Add connected nodes first, bounded per table for responsiveness.
        for table in sorted(table_to_ids.keys()):
            pk = ENTITY_PK.get(table)
            if not pk:
                continue
            colour = _COLOURS.get(table, "#888")
            for node_id in sorted(table_to_ids[table])[:limit_per_table]:
                if node_id in seen_node_ids:
                    continue
                _, pk_val = node_id.split(":", 1)
                node = _fetch_node(conn, table, pk, pk_val, colour)
                if node:
                    seen_node_ids.add(node_id)
                    nodes.append(node)

        # Then add sample nodes for transparency
        sample_nodes = _collect_sample_nodes(conn, tables, seen_node_ids, sample_limit=2)
        nodes.extend(sample_nodes)

    return {"nodes": nodes}


def infer_graph_edges(limit_per_table: int = 200) -> dict:
    """
    Infer edges from O2C relationships in the dataset.
    
    Uses higher limits now since list_graph_nodes has been optimized to fetch
    only connected and sample nodes, reducing the chance of orphaned edges.
    """
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
            
            edge_limit = max(limit_per_table * 5, 140)
            rows = conn.execute(
                f"SELECT {src_pk}, {src_fk} FROM {src_table} WHERE {src_fk} IS NOT NULL LIMIT ?",
                (edge_limit,),
            ).fetchall()
            for row in rows:
                src_node = f"{src_table}:{row[0]}"
                tgt_node = f"{tgt_table}:{row[1]}"
                edge_id = f"{src_node}→{tgt_node}"
                if edge_id not in seen:
                    seen.add(edge_id)
                    edges.append({"id": edge_id, "source": src_node, "target": tgt_node, "label": src_fk})
    return {"edges": edges}


def _build_adjacency(nodes: list[dict], edges: list[dict]) -> dict[str, set[str]]:
    node_ids = {node["id"] for node in nodes}
    adjacency: dict[str, set[str]] = {}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source not in node_ids or target not in node_ids:
            continue
        adjacency.setdefault(source, set()).add(target)
        adjacency.setdefault(target, set()).add(source)
    return adjacency


def _explore_component(start: str, adjacency: dict[str, set[str]], visited: set[str]) -> set[str]:
    stack = [start]
    component: set[str] = set()
    while stack:
        current = stack.pop()
        if current in visited:
            continue
        visited.add(current)
        component.add(current)
        for neighbor in adjacency.get(current, set()):
            if neighbor not in visited:
                stack.append(neighbor)
    return component


def _largest_connected_component(adjacency: dict[str, set[str]]) -> set[str]:
    visited: set[str] = set()
    largest_component: set[str] = set()
    for start in adjacency:
        if start in visited:
            continue
        component = _explore_component(start, adjacency, visited)
        if len(component) > len(largest_component):
            largest_component = component
    return largest_component


def _add_transparency_samples(nodes: list[dict], keep_ids: set[str], samples_per_table: int) -> None:
    per_table_kept: dict[str, int] = {}
    for node in nodes:
        table = node.get("table", "")
        if node["id"] in keep_ids:
            per_table_kept[table] = per_table_kept.get(table, 0) + 1

    for node in nodes:
        node_id = node["id"]
        table = node.get("table", "")
        if node_id in keep_ids:
            continue
        current_count = per_table_kept.get(table, 0)
        if current_count >= samples_per_table:
            continue
        keep_ids.add(node_id)
        per_table_kept[table] = current_count + 1


def prioritize_connected_view(nodes: list[dict], edges: list[dict], samples_per_table: int = 1) -> tuple[list[dict], list[dict]]:
    """
    Keep the graph visually coherent by prioritizing the largest connected component,
    while retaining a tiny per-table sample for transparency.
    """
    if not nodes:
        return nodes, edges

    adjacency = _build_adjacency(nodes, edges)
    if not adjacency:
        return nodes, edges

    keep_ids = _largest_connected_component(adjacency)
    _add_transparency_samples(nodes, keep_ids, samples_per_table)

    filtered_nodes = [node for node in nodes if node["id"] in keep_ids]
    filtered_edges = [edge for edge in edges if edge.get("source") in keep_ids and edge.get("target") in keep_ids]
    return filtered_nodes, filtered_edges
