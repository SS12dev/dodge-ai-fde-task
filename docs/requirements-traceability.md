# Requirements Traceability Matrix

## Purpose

This matrix ties each assignment requirement to implementation areas and validation evidence.

## Matrix

| Requirement | Implementation Area | Validation |
|---|---|---|
| Graph construction from ERP dataset | backend ingest and graph projection services | health endpoint table coverage, graph endpoint non-empty |
| Graph visualization with exploration and node inspection | frontend graph explorer with node selection and neighbor reveal | manual UI walkthrough and frontend build |
| Conversational NL query interface with dynamic structured query execution | backend query service and chat endpoint | API smoke test query checks |
| Query class A: top products by billing docs | deterministic query logic and/or LLM generation path | smoke test query_top_products |
| Query class B: billing document flow trace | deterministic flow SQL with sales, delivery, billing, journal joins | smoke test query_o2c_trace and manual billing-doc prompt |
| Query class C: broken or incomplete flows | deterministic broken-flow SQL patterns | smoke test query_broken_flow |
| Guardrails for off-domain prompts | domain filter and SQL safety validator | smoke test guardrail_off_domain |
| README architecture, DB choice, prompting, guardrails | README and lock docs | documentation review |
| Working demo path | deployment section and submission checklist | deploy smoke walkthrough |
| AI session logs preserved | sessions directory and uploaded logs | repository check |

## Evidence Commands

Run from repository root using the project virtual environment:

1. Backend smoke test:

   .venv/Scripts/python.exe src/backend/scripts/e2e_smoke_test.py --out src/backend/smoke_reports/e2e_smoke_report.json

2. Frontend build:

   cd src/frontend && npm run build

3. Manual guardrail probe:

   POST /api/chat/query with a non-domain prompt and confirm rejection message.

## Change Control

When implementation changes affect requirements, update this matrix in the same change set.