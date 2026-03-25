# AI Coding Session Log — GitHub Copilot (VS Code)

**Tool:** GitHub Copilot (Agent mode, Claude Sonnet 4.6)  
**Date:** 2026-03-25  
**Project:** Dodge AI FDE Task — Context Graph & NL Query System

---

## Session Overview

This log captures the key prompts, decisions, and iteration patterns used during the build of this project with GitHub Copilot in VS Code agent mode.

---

## Phase 0 — Task Understanding & Plan

**Prompt:**
> "i have a task can you help me understand it" [attached full task description]

**Response/Decision:**
- Copilot parsed the full submission requirements, extracted functional requirements (graph construction, graph visualisation, conversational query interface, guardrails), identified rejection risks (non-functional demo, missing guardrails, answers not grounded in data).
- Produced a structured plan with technology options.

**Prompt:**
> "i need it done asap so lets just create a plan to complete it asap and get started"

**Response/Decision:**
- Locked to fastest reliable stack: **FastAPI + SQLite + React (Vite) + Cytoscape.js + Google Gemini**.
- Confirmed deployment on a single platform (Railway/Render) to minimise moving parts.
- Stored execution plan in session memory to track progress.

---

## Phase 1 — Project Scaffolding

**Prompt:**
> "Start implementation"

**Key actions:**
- Created project directory structure: `src/backend/app/`, `src/frontend/src/components/`, `sessions/`, `data/`.
- Vite initialisation completed; starter `App.tsx` scaffolded.
- Created all backend modules in parallel: `database.py`, `ingest.py`, `graph_service.py`, `guardrails.py`, `query_service.py`, `main.py`.

**Notable iteration:**
- Vite `create vite@latest` ran interactively; Copilot detected the stall, killed the interactive session, used `create_directory` tool directly and scaffolded files manually without re-triggering the initialiser.

---

## Phase 2 — Backend Implementation

**Key modules built:**

### `database.py`
- Used `sqlite3.Row` for dict-like row access.
- DB path resolved from absolute `__file__` path (4 dirname levels up to repo root) to work regardless of cwd.

### `ingest.py`
- `load_csv_folder()` — reads all `*.csv` from `data/`, normalises column names (lowercase, underscores), writes to SQLite via pandas `.to_sql()`.
- `integrity_snapshot()` — checks all `*_id` columns across all tables for null/empty rates.

### `graph_service.py`
- `list_graph_nodes()` — returns nodes for each table, using the first `*_id` column as node ID.
- `infer_graph_edges()` — detects FK relationships by scanning `*_id` columns and matching values across tables. Schema-agnostic, works with any dataset shape.

### `guardrails.py`
- Layer 1: keyword-based domain classifier.
- Layer 2: SQL safety validator — read-only enforcement, table allowlist, mutation keyword scanner, auto-LIMIT injection.

### `query_service.py`
- Schema injected into every prompt to prevent hallucinated column names.
- No-key fallback: deterministic SQL for known query shapes so development works without credentials.

### `main.py`
- CORS middleware configured from env var (comma-separated origins).
- Ingest triggered automatically on demand with correct repo-root path resolution.

---

## Phase 3 — Frontend Implementation

**Key files built:**

### `App.tsx`
- On mount: calls ingest, then fetches graph.
- Shows status and per-table node count summary in header.

### `GraphView.tsx`
- Cytoscape.js COSE layout for force-directed graph.
- Cleanup via `cy.destroy()` on unmount to prevent memory leaks.

### `ChatPanel.tsx`
- Three example query buttons pre-fill the textarea.
- Shows generated SQL and raw result rows alongside the response.

**Build issue encountered:**
- TypeScript `verbatimModuleSyntax` in Vite 8 template requires `import type` for type-only imports.
- Copilot patched all 4 affected files in one multi-replace operation.

---

## Phase 4 — Environment & Run Wiring

**Prompt:**
> "dont use the global env, make a local python .venv and then use it"

**Actions:**
- Used VS Code `configure_python_environment` tool to create `.venv` at repo root.
- Used `install_python_packages` tool to install into that `.venv` (not global pip).
- All run commands use `.venv/Scripts/python.exe` (Windows) / `.venv/bin/python` (macOS/Linux).

**End-to-end test results:**
- `/api/health` → `{"status": "ok"}`
- Off-domain query `"write me a poem"` → guardrail rejected correctly
- Domain query `"which products have the most billing documents?"` → SQL generated and executed (fallback SQL without Gemini key)
- `POST /api/ingest/load` → resolves correct path: `<repo_root>/data/`

---

## Key Prompting Patterns Used

1. **Parallel file creation** — backend modules created in a single tool batch (7 files at once).
2. **Schema-first prompting** — prompted the LLM prompt builder to inject full table schema before the question.
3. **Explicit rejection criteria** — guardrail keyword list explicitly enumerated in the prompt to Copilot, not left to guesswork.
4. **Checkpoint validation** — after every major phase, ran a compile or network test before proceeding.
5. **Path-independent resolution** — always used `os.path.abspath(__file__)` + dirname chains instead of cwd-relative paths.

---

## Debugging Workflow

| Issue | Diagnosis | Fix |
|---|---|---|
| Vite CLI stalled on interactive prompt | Detected lack of output, tool showed `null` | Switched to manual `create_directory` + `create_file` tools |
| TS `verbatimModuleSyntax` errors | Read build output, identified 4 files | Patched all with `multi_replace_string_in_file` |
| `DATA_DIR=./data` resolved from wrong cwd | Checked error message path in HTTP response | Left env var blank, rely on abs-path fallback in main.py |
| DB path ended at `src/` not repo root | Counted filepath depth: `app/main.py` = 4 levels not 3 | Added extra `dirname()` call |
| Backend not responding after `Start-Process` | Process spawned detached, no stdout captured | Used background terminal with `isBackground=true` instead |
