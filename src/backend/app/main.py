from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import ensure_internal_tables, list_tables
from .graph_service import infer_graph_edges, list_graph_nodes, prioritize_connected_view
from .guardrails import is_domain_question
from .ingest import integrity_snapshot, load_csv_folder
from .logging_config import setup_logging
from .query_service import QueryService

load_dotenv()
setup_logging()

logger = logging.getLogger(__name__)

app = FastAPI(title="Dodge AI FDE Task API", version="0.1.0")


def parse_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

query_service = QueryService()
ensure_internal_tables()


class IngestRequest(BaseModel):
    data_dir: str | None = None


class QueryRequest(BaseModel):
    question: str


@app.get("/api/health")
def health() -> dict:
    logger.info("health_check")
    return {"status": "ok", "tables": list_tables()}


@app.post("/api/ingest/load")
def ingest(req: IngestRequest) -> dict:
    _here = os.path.abspath(__file__)  # .../src/backend/app/main.py
    _repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_here))))
    data_dir = req.data_dir or os.getenv("DATA_DIR") or os.path.join(_repo_root, "data")
    logger.info("ingest_start data_dir=%s", data_dir)
    try:
        report = load_csv_folder(data_dir)
        logger.info("ingest_success tables=%d rows_loaded=%d", len(report.get("tables", [])), report.get("rows_loaded", 0))
        return {"ok": True, "report": report, "integrity": integrity_snapshot()}
    except Exception as exc:
        logger.exception("ingest_failed data_dir=%s", data_dir)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/graph")
def graph(limit_per_table: int = 22, mode: str = "fast") -> dict:
    """
    Fetch the graph with edge-first construction.
    
    The new strategy prioritizes connected nodes:
    1. Fetches edges (determines which records are connected)
    2. Extracts all node IDs from those edges
    3. Fetches those nodes from the database
    4. Supplements with sample isolated nodes for coverage
    
    This results in a much more connected graph with minimal isolated nodes.
    Default limit_per_table=22 prioritizes faster loading while preserving
    the key O2C structure and cross-entity transparency.
    """
    logger.info("graph_request limit_per_table=%d", limit_per_table)
    nodes = list_graph_nodes(limit_per_table=limit_per_table)
    edges = infer_graph_edges(limit_per_table=max(limit_per_table, 100))
    node_ids = {node["id"] for node in nodes["nodes"]}
    filtered_edges = [
        edge
        for edge in edges["edges"]
        if edge["source"] in node_ids and edge["target"] in node_ids
    ]
    if mode == "full":
        logger.info("graph_response mode=full nodes=%d edges=%d", len(nodes["nodes"]), len(filtered_edges))
        return {"nodes": nodes["nodes"], "edges": filtered_edges}

    prioritized_nodes, prioritized_edges = prioritize_connected_view(
        nodes["nodes"],
        filtered_edges,
        samples_per_table=1,
    )
    logger.info("graph_response mode=fast nodes=%d edges=%d", len(prioritized_nodes), len(prioritized_edges))
    return {"nodes": prioritized_nodes, "edges": prioritized_edges}


@app.post("/api/chat/query")
def chat_query(req: QueryRequest) -> dict:
    logger.info("chat_query_received question=%s", req.question)
    if not is_domain_question(req.question):
        logger.info("chat_query_rejected_off_domain")
        return {
            "ok": False,
            "error": "This system is designed to answer questions related to the provided dataset only.",
            "rows": [],
            "sql": "",
        }

    response = query_service.ask(req.question)
    logger.info("chat_query_completed ok=%s rows=%d", response.get("ok"), len(response.get("rows", [])))
    return response
