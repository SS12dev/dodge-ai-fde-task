# Architecture Lock

## Overview

The system uses a pragmatic full-stack architecture optimized for local development, quick iteration, and a simple public demo.

## Locked Architecture

### Frontend

- React + TypeScript
- Vite for local development and build
- Cytoscape.js for graph visualization

The frontend is a desktop-first analyst workbench with:

- a graph exploration pane
- a query and results pane
- lightweight status feedback for dataset and API health

### Backend

- FastAPI for HTTP endpoints
- request/response JSON API
- isolated services for ingest, graph projection, guardrails, and query generation

Core API responsibilities:

- dataset ingest
- graph retrieval
- natural-language query execution
- health checks

### Data Layer

- SQLite as the primary datastore
- normalized relational tables populated from the provided dataset
- graph relationships projected from relational data and foreign-key style linkages

SQLite is the right choice for this assignment because it:

- keeps infrastructure simple
- supports non-trivial SQL queries
- is easy to run in local and demo environments
- keeps the data model transparent for reviewers

### LLM Layer

- free-tier LLM provider integration
- schema-aware prompting
- few-shot examples for required query shapes
- runtime model fallback across supported free-tier Gemini models
- governed hybrid routing between deterministic query templates and LLM generation

## Key Architectural Decisions

### Single Source of Truth

The relational database remains the source of truth.

The graph is a projection of the relational data, not an independently managed graph store. This avoids duplicating state and keeps SQL-based validation straightforward.

### Transparent Querying

Natural-language questions are translated into structured queries that are visible to the user. Reviewers should be able to inspect generated SQL and compare it against returned rows.

The system should also expose the query handling path for debugging and reviewer trust, for example whether a response came from deterministic routing or Gemini generation.

### Governed Hybrid Query Engine

The query layer is intentionally hybrid.

1. Required, high-value ERP investigation workflows use deterministic query routing to validated SQL templates.
2. Broader domain-valid analyst prompts use schema-aware Gemini generation.
3. If one model is unavailable or quota-limited, the system retries alternative supported free-tier models.
4. If model-generated SQL is invalid or cannot be executed, the system must fail safely rather than crash.

This mirrors a production-style enterprise design where reliability, observability, and safety matter more than routing every request through a model.

### Guardrail-First Execution

Guardrails happen before unsafe or irrelevant execution paths. The system should reject off-domain prompts early and validate SQL before execution.

### Simplicity Over Novelty

The architecture favors predictable behavior over sophistication that does not help the assignment. Any new component must justify its operational cost.

## Preferred Endpoint Model

- POST /api/ingest/load
- GET /api/graph
- POST /api/chat/query
- GET /api/health

## UI Architecture Direction

The expected UI structure is:

1. Header or status band
2. Graph explorer pane
3. Query composer pane
4. Results section with:
   - natural-language answer
   - query handling mode
   - generated SQL
   - tabular records

## Reliability Expectations

The architecture should support:

- deterministic smoke testing for core flows
- easy deployment to a public demo host
- fast debugging when query generation misbehaves
- clear separation between ingest, graph logic, and query logic
- explicit logs for routing decisions, model failures, and SQL execution failures