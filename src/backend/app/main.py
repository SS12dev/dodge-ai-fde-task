from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import ensure_internal_tables, list_tables
from .graph_service import infer_graph_edges, list_graph_nodes
from .guardrails import is_domain_question
from .ingest import integrity_snapshot, load_csv_folder
from .query_service import QueryService

load_dotenv()

app = FastAPI(title="Dodge AI FDE Task API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
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
    return {"status": "ok", "tables": list_tables()}


@app.post("/api/ingest/load")
def ingest(req: IngestRequest) -> dict:
    _here = os.path.abspath(__file__)  # .../src/backend/app/main.py
    _repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_here))))
    data_dir = req.data_dir or os.getenv("DATA_DIR") or os.path.join(_repo_root, "data")
    try:
        report = load_csv_folder(data_dir)
        return {"ok": True, "report": report, "integrity": integrity_snapshot()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/graph")
def graph(limit_per_table: int = 25) -> dict:
    nodes = list_graph_nodes(limit_per_table=limit_per_table)
    edges = infer_graph_edges(limit_per_table=max(limit_per_table, 100))
    return {"nodes": nodes["nodes"], "edges": edges["edges"]}


@app.post("/api/chat/query")
def chat_query(req: QueryRequest) -> dict:
    if not is_domain_question(req.question):
        return {
            "ok": False,
            "error": "This system is designed to answer questions related to the provided dataset only.",
            "rows": [],
            "sql": "",
        }

    return query_service.ask(req.question)
