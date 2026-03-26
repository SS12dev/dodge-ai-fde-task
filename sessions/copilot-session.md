# AI Coding Session Log — GitHub Copilot (VS Code)

**Tool:** GitHub Copilot (VS Code Agent mode; multi-session, multi-model usage)  
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

---

## Phase 5 — Graph View Refactor & Chat UX Overhaul

**Prompts:**
> "improve graph view" / "rebuild chat panel UX"

**Key actions:**
- Rewrote `GraphView.tsx`: COSE layout with configurable node/edge styles, node metadata tooltip panel, proper `cy.destroy()` cleanup on unmount, sidebar with table-grouped node counts.
- Rewrote `ChatPanel.tsx` with analyst workbench UX:
  - **Tabbed results** — Business Answer / Generated SQL / Raw Data as separate tabs
  - **Sort/pin** — conversation history with pinned queries persisting at top
  - **Copy SQL** — one-click clipboard copy of generated SQL
  - **Keyboard shortcut** — `Ctrl+Enter` submits query
  - **Drag reorder** — drag handle (⠿) on history items for manual reordering
  - **Example queries** — guided query buttons pre-fill the textarea
- Patched the table header misalignment (sticky `thead` with `bg-white`).

**TypeScript issue encountered:**
- `react-beautiful-dnd` had incompatible types with React 18 strict mode; replaced with lightweight manual drag handler using `onDragStart`/`onDragOver`/`onDrop`.

---

## Phase 6 — Render Backend Deployment Debugging

**Prompt:**
> "lets deploy" / [multiple iteration prompts as errors arose]

**Initial Render settings:** Docker, Root Directory = `src/backend`

**Iteration 1 — Health Check path:**
- Render default health check was `/` → returned 404. Fixed: Health Check Path → `/api/health`.

**Iteration 2 — Data files not in repo:**
- `data/sap-o2c-data/` was in `.gitignore`. Backend crashed on ingest with empty data dir.
- Fixed: removed the `.gitignore` line, committed and pushed all 73 JSONL files.

**Iteration 3 — DB directory missing in container:**
- `sqlite3.OperationalError: unable to open database file`
- Cause: `/app/data/` directory didn't exist inside the running container.
- Fix: added `os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)` in `database.py` before any connection opens.

**Iteration 4 — `_REPO_ROOT` path wrong inside Docker:**
- `__file__` in container resolved to `/app/app/database.py`; climbing 4 `dirname()` levels reached `/` not the data dir.
- Fix: added `DB_PATH` env var `= /app/data/erp.db` on the Render service. Backend honours `os.environ.get("DB_PATH")` first.

**Iteration 5 — `data/` not inside Docker image:**
- Dockerfile only copied `app/` into the image. The JSONL files existed in the repo but weren't in the container.
- Fix: Rewrote Dockerfile to build from **repo root context** instead of `src/backend`:
  ```dockerfile
  COPY src/backend/requirements.txt .
  COPY src/backend/app /app/app
  COPY data /app/data
  ENV DATA_DIR=/app/data
  ```

**Iteration 6 — Docker Build Context mismatch:**
- Root Directory was still `src/backend`, so Docker build context was `src/backend/` — `COPY data` failed (no `data/` under there).
- Fix in Render service settings:
  - Root Directory → *(empty)*
  - Dockerfile Path → `src/backend/Dockerfile`
  - Docker Build Context → `.`
- Build succeeded on next deploy.

**Iteration 7 — Stale `DATA_DIR` env var:**
- An old `DATA_DIR=/opt/render/project/src/data` env var was set from a prior attempt. Backend read it and looked in the wrong place → ingest returned 400.
- Fix: deleted the env var in Render dashboard; Dockerfile `ENV DATA_DIR=/app/data` took effect.
- Ingest ran: `POST /api/ingest/load` → all 16 SAP O2C tables loaded.

**Key debugging command used:**
```powershell
Invoke-RestMethod -Uri "https://<your-backend-service>.onrender.com/api/ingest/load" `
  -Method POST -ContentType "application/json" -Body "{}"
```

---

## Phase 7 — Frontend Static Site Deployment (Render)

**Prompt:**
> "now lets deploy the frontend"

---

## Phase 8 — Submission Hardening and Reviewer UX (2026-03-26)

**Tool:** GitHub Copilot (VS Code Agent, GPT-5.3-Codex)

### Objectives

1. improve graph responsiveness for live demo reliability
2. preserve transparency while reducing visual fragmentation
3. align documentation and deployment config for final submission

### Key implementation iterations

1. Added table sorting and expand/collapse in chat result tables.
2. Introduced stage-aware graph legend grouping and improved dark-theme graph colors.
3. Added chat reset controls and removed cross-refresh chat persistence.
4. Added centered graph loading overlay to avoid blank-screen ambiguity during layout.
5. Optimized graph startup by fetching existing graph first and using ingest only as fallback.
6. Reduced frontend graph render pressure by lowering payload size and Cytoscape layout cost.
7. Diagnosed graph segmentation from aggressive payload capping and added connectivity prioritization.
8. Added **Fast/Full graph mode toggle**:
  - Fast: connected, reviewer-friendly low-latency view
  - Full: unfiltered view for maximum transparency
9. Updated README, lock docs, and render config to match current behavior and deployment URLs.

### Debugging pattern used

1. quantify before change (component counts, nodes/edges, endpoint timing)
2. patch smallest possible code paths
3. re-run compile/build checks after every change set
4. validate API behavior with explicit fast/full payload checks

### Final reviewer-facing outcome

1. required query workflows remain data-grounded and guardrailed
2. graph is demo-safe under Fast mode and auditable under Full mode
3. submission artifacts (README/docs/sessions/deploy config) are synchronized

**Render Static Site settings:**
- Root Directory: `src/frontend`
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- Env var: `VITE_API_BASE_URL=https://<your-backend-service>.onrender.com`

**Outcome:** Build succeeded first attempt. Site live at `https://<your-frontend-service>.onrender.com`.

---

## Phase 8 — Post-deploy CORS Wiring

**Action:**
- Set `CORS_ORIGINS=https://<your-frontend-service>.onrender.com,http://localhost:5173` on backend Render service.
- Triggered redeploy; confirmed browser requests from frontend reach backend without CORS errors.

---

## Phase 9 — Favicon & Tab Title Polish

**Prompt:**
> "can you fix the title and icon in the tab"

**Actions:**
- Updated `src/frontend/index.html`: `<title>Dodge AI — O2C Analyst Workbench</title>`
- Previous `favicon.svg` was the default purple Vite logo.
- Replaced with a custom teal graph icon (dark teal rect, white circle nodes, white edge lines) matching the analyst workbench brand.
- Created `public/favicon-v2.svg` (cache-busting copy) and updated `index.html` to reference it.

**Issue encountered:**
- `replace_string_in_file` on the SVG only replaced the opening `<svg>` tag, leaving old content appended → corrupted file.
- Fix: used PowerShell `Set-Content` with a heredoc string to atomically overwrite both SVG files.

**Committed:** `926e04e` — pushed to master.

---

## Phase 10 — Submission Preparation

**Prompt:**
> "help me prepare everything for submission"

**Actions:**
- Audited README: confirmed all required sections present (architecture, LLM strategy, guardrails, setup, supported queries, deployment).
- Added live demo URL, backend API URL, and GitHub URL to README header.
- Extended this session log with Phases 5–10.
- Created `sessions.zip` for form upload.

**Submission details:**
- Live demo: add final deployed URL before submission
- Backend: add final backend URL before submission
- GitHub: add final public repository URL before submission
- Form: add current submission form URL before submission

---

## Extended Debugging Workflow

| Issue | Diagnosis | Fix |
|---|---|---|
| Docker COPY of data/ failed | Root Directory set to `src/backend`; build context didn't include repo root | Changed Root Dir to empty, set Dockerfile Path + Build Context explicitly |
| `sqlite3.OperationalError` on DB open | Container had no `/app/data/` directory | Added `os.makedirs()` before connection in `database.py` |
| `_REPO_ROOT` resolved to `/` inside container | `dirname()` chain counted too many levels | Added explicit `DB_PATH` env var; backend honours it first |
| Stale env var overriding Dockerfile ENV | Old `DATA_DIR` set in Render dashboard pointed to wrong path | Deleted env var from Render; Dockerfile ENV took effect |
| SVG file corrupted after replace_string | Tool only matched opening `<svg>` tag, appended old body | Used PowerShell `Set-Content` heredoc for atomic overwrite |
| Ingest 405 when testing from browser | Browser sent GET; endpoint requires POST | Used `Invoke-RestMethod -Method POST` |
