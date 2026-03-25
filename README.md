# Dodge AI FDE Task — Context Graph & NL Query System

A full-stack application that models fragmented ERP business data (Orders, Deliveries, Invoices, Payments) as an interconnected graph, visualises it, and lets users ask natural-language questions that are translated into live SQL queries grounded in the dataset.

## Locked Project Docs

- [docs/requirements-lock.md](docs/requirements-lock.md) - assignment-aligned MVP scope, acceptance criteria, and non-goals
- [docs/architecture-lock.md](docs/architecture-lock.md) - locked system design and architectural decisions
- [docs/implementation-approach.md](docs/implementation-approach.md) - delivery approach, priorities, and definition of done
- [docs/requirements-traceability.md](docs/requirements-traceability.md) - requirement to implementation and validation mapping
- [docs/submission-checklist.md](docs/submission-checklist.md) - form-aligned submission checklist
- [docs/prompt-test-suite.md](docs/prompt-test-suite.md) - detailed manual prompt suite with expected outcomes
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - repo-specific guidance for future Copilot-assisted work

---

## Architecture

```
┌─────────────────────┐        ┌──────────────────────────────────┐
│  React + Cytoscape  │◄──────►│  FastAPI (Python)                │
│  Vite / TypeScript  │  REST  │  ├── /api/ingest/load  (JSONL/CSV→SQLite) │
│  Split-pane UI:     │        │  ├── /api/graph        (nodes+edges) │
│  - Graph Explorer   │        │  ├── /api/chat/query   (NL→SQL)   │
│  - Chat Panel       │        │  └── /api/health                  │
└─────────────────────┘        └────────────┬─────────────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │  SQLite (erp.db) │
                                   │  data/ JSONL/CSV │
                                   └─────────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │  Google Gemini   │
                                   │  (free tier)     │
                                   └─────────────────┘
```

### Key architectural decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Database** | SQLite | Zero-infrastructure, single file, sufficient for the dataset size. All analytics use standard SQL — easy to swap to Postgres with no code changes. |
| **Graph representation** | Relational tables + in-request graph projection | Avoids a separate graph DB. Nodes and edges are derived on read from FK relationships, keeping a single source of truth. |
| **LLM** | Google Gemini API (model auto-selection) | Tries available Gemini generateContent models and falls back to deterministic SQL when provider calls fail. |
| **Frontend graph lib** | Cytoscape.js | Battle-tested, handles large graphs, no paid license. |
| **Deployment** | Single-platform (Railway/Render) | Fewest moving parts, no split frontend/backend CDN complexity. |

---

## LLM Prompting Strategy

The system uses a **governed hybrid query architecture**.

1. For required, high-value ERP workflows, the backend uses deterministic routing to validated SQL templates.
2. For broader domain-valid analyst questions, the backend uses Gemini with schema-aware prompting.
3. If a preferred Gemini model is rate-limited or unavailable, the backend retries alternative free-tier models.
4. All generated SQL is validated as read-only before execution.
5. The UI surfaces the generated SQL and the query handling mode for transparency.

The Gemini prompt is **schema-aware and few-shot**:

1. The full table schema is injected into every prompt so the model never hallucinates column names.
2. The system instruction restricts the model to emit **one read-only SQL query and nothing else**.
3. Three few-shot examples (see `query_service.py`) cover the required query shapes.
4. If no API key is set, or if model generation fails, the system falls back safely without crashing the API.

### Why hybrid instead of pure LLM routing?

This is an intentional production-style tradeoff.

In enterprise ERP workflows, a purely generative query layer is often too brittle for repeated business-critical investigations. The hybrid approach gives:

1. predictable behavior for benchmark workflows that reviewers must verify
2. flexibility for broader analyst exploration
3. resilience under free-tier rate limits and transient model failures
4. better debugging through explicit routing, SQL visibility, and logs

Example prompt skeleton:

```
You are an ERP analytics SQL generator for SQLite.
Produce exactly one read-only SQL query and nothing else.
Use only listed tables/columns. Always include LIMIT 200 or lower.

Schema:
- orders(id, customer_id, created_at, ...)
- deliveries(id, order_id, plant_id, ...)
...

User question:
Which products are associated with the highest number of billing documents?
```

---

## Guardrails

Two layers of protection:

### 1. Domain filter (pre-LLM)
`guardrails.py :: is_domain_question()` — checks whether the user's question contains at least one token from the domain keyword set `{order, delivery, invoice, billing, payment, customer, product, material, address, sales, sap, journal}`. Off-domain questions are rejected immediately with:

> "This system is designed to answer questions related to the provided dataset only."

### 2. SQL safety validator (post-LLM)
`guardrails.py :: validate_sql_read_only()` — before any generated SQL is executed:
- Rejects anything not starting with `SELECT` or `WITH`
- Scans for mutation keywords: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `ATTACH`, `PRAGMA`
- Validates that every referenced table is in the allowed list (tables that exist in the DB)
- Appends `LIMIT 200` if no explicit LIMIT is present

---

## Setup & Run

### Prerequisites
- Python 3.11+
- Node.js 18+

### 1. Clone and install

```bash
# Backend (project-local .venv — no global installs)
python -m venv .venv
# Windows:
.venv\Scripts\pip install -r src/backend/requirements.txt
# macOS/Linux:
.venv/bin/pip install -r src/backend/requirements.txt

# Frontend
cd src/frontend && npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in GEMINI_API_KEY from https://ai.google.dev
```

### 3. Add dataset

Place the provided SAP O2C dataset under `data/` (JSONL folder layout):
```
data/
  sap-o2c-data/
    sales_order_headers/
      part-*.jsonl
    sales_order_items/
      part-*.jsonl
    outbound_delivery_headers/
    outbound_delivery_items/
    billing_document_headers/
    billing_document_items/
    ...
```

Notes:
- Ingest supports this JSONL subfolder format by default.
- Flat CSV fallback is still supported if you pass a folder containing `*.csv`.

### 4. Run backend

```bash
# Windows
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000 --app-dir src/backend

# macOS/Linux
.venv/bin/python -m uvicorn app.main:app --reload --port 8000 --app-dir src/backend
```

### 5. Run frontend

```bash
cd src/frontend && npm run dev
# Open http://localhost:5173
```

The frontend proxies `/api/*` to `http://localhost:8000` in dev mode — no CORS config needed.

### 6. Load data

On first open, the UI calls `POST /api/ingest/load`, which reads JSONL entity folders from `data/sap-o2c-data/`, normalises column names, serializes nested fields, and populates `data/erp.db`.

---

## Supported Queries (Examples)

| # | Query |
|---|---|
| a | Which products are associated with the highest number of billing documents? |
| b | Trace the full flow for billing document 10001234 (Sales Order → Delivery → Billing → Journal Entry when available) |
| c | Which sales orders are delivered but not billed (or billed without delivery)? |

---

## Validation & Refinement Loop

Use these scripts to keep the system reliable while iterating:

### 1. E2E smoke test (API behavior)

```bash
# From repo root (backend must be running on localhost:8000)
.venv\Scripts\python src/backend/scripts/e2e_smoke_test.py --out src/backend/smoke_reports/e2e_smoke_report.json
```

This validates:
- `/api/health`
- `/api/graph` non-empty response
- 3 business queries return rows
- off-domain guardrail rejection

Exit codes:
- `0`: all checks passed
- `2`: one or more checks failed
- `1`: test crashed (API unreachable or invalid response)

### 2. Model discovery + benchmark (LLM stability)

```bash
.venv\Scripts\python src/backend/scripts/gemini_discovery_benchmark.py --max-models 3 --iterations 2 --out-dir src/backend/benchmark_results
```

Outputs:
- unified report JSON
- detailed benchmark CSV
- summary benchmark CSV

Refinement cycle:
1. Run smoke test after backend changes.
2. If SQL quality regresses, inspect generated SQL in smoke report and tune few-shots in `query_service.py`.
3. Re-run unified benchmark to compare model reliability/latency.
4. Keep the best model in `.env` via `GEMINI_MODEL`.

---

## Project Structure

```
.
├── .env.example
├── .gitignore
├── README.md
├── data/                   ← drop SAP O2C JSONL folder (CSV fallback supported)
├── sessions/               ← AI coding session logs
│   └── copilot-session.md
└── src/
    ├── backend/
    │   ├── requirements.txt
    │   └── app/
    │       ├── main.py         ← FastAPI routes + CORS
    │       ├── database.py     ← SQLite connection
    │       ├── ingest.py       ← JSONL/CSV → SQLite
    │       ├── graph_service.py← node/edge projection
    │       ├── guardrails.py   ← domain filter + SQL validation
    │       └── query_service.py← NL → SQL → answer
    └── frontend/
        └── src/
            ├── App.tsx
            ├── components/
            │   ├── GraphView.tsx
            │   └── ChatPanel.tsx
            └── lib/
                ├── api.ts
                └── types.ts
```

---

## Deployment (Railway)

1. Push repo to GitHub (public).
2. Create a new Railway project → **Deploy from GitHub repo**.
3. Add a service for the backend: set **Root Directory** to `src/backend`, **Start Command** to `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
4. Add env vars: `GEMINI_API_KEY`, `CORS_ORIGINS=<frontend URL>`.
5. Add a static/Vite service for the frontend pointing to `src/frontend` with build command `npm run build` and output `dist/`.
