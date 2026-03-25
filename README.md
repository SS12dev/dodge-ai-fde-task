# Dodge AI FDE Task — Context Graph & NL Query System

A full-stack application that models fragmented ERP business data (Orders, Deliveries, Invoices, Payments) as an interconnected graph, visualises it, and lets users ask natural-language questions that are translated into live SQL queries grounded in the dataset.

---

## Architecture

```
┌─────────────────────┐        ┌──────────────────────────────────┐
│  React + Cytoscape  │◄──────►│  FastAPI (Python)                │
│  Vite / TypeScript  │  REST  │  ├── /api/ingest/load  (CSV→SQLite) │
│  Split-pane UI:     │        │  ├── /api/graph        (nodes+edges) │
│  - Graph Explorer   │        │  ├── /api/chat/query   (NL→SQL)   │
│  - Chat Panel       │        │  └── /api/health                  │
└─────────────────────┘        └────────────┬─────────────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │  SQLite (erp.db) │
                                   │  data/ *.csv     │
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
| **LLM** | Google Gemini 1.5 Flash (free tier) | Fast, cheap, good at code/SQL generation. Fallback path activates if key is missing. |
| **Frontend graph lib** | Cytoscape.js | Battle-tested, handles large graphs, no paid license. |
| **Deployment** | Single-platform (Railway/Render) | Fewest moving parts, no split frontend/backend CDN complexity. |

---

## LLM Prompting Strategy

The prompt is **schema-aware and few-shot**:

1. The full table schema is injected into every prompt so the model never hallucinates column names.
2. The system instruction restricts the model to emit **one read-only SQL query and nothing else**.
3. Three few-shot examples (see `query_service.py`) cover the required query shapes.
4. If no API key is set, a deterministic fallback SQL is returned so the system works without credentials during development.

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

Download the dataset CSV files and place them in the `data/` folder:
```
data/
  orders.csv
  deliveries.csv
  invoices.csv
  payments.csv
  customers.csv
  products.csv
  ...
```

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

On first open, the UI automatically calls `POST /api/ingest/load` which reads all CSVs from `data/`, normalises column names, and populates `data/erp.db`.

---

## Supported Queries (Examples)

| # | Query |
|---|---|
| a | Which products are associated with the highest number of billing documents? |
| b | Trace the full flow of billing document 10001234 |
| c | Identify sales orders that are delivered but not billed |

---

## Project Structure

```
.
├── .env.example
├── .gitignore
├── README.md
├── data/                   ← drop CSV files here
├── sessions/               ← AI coding session logs
│   └── copilot-session.md
└── src/
    ├── backend/
    │   ├── requirements.txt
    │   └── app/
    │       ├── main.py         ← FastAPI routes + CORS
    │       ├── database.py     ← SQLite connection
    │       ├── ingest.py       ← CSV → SQLite
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
