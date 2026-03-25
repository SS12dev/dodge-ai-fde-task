# Dodge AI FDE Assignment Instructions

## Project Intent

This repository is for the Dodge AI Forward Deployed Engineer hiring task.

The goal is not to build a broad ERP assistant. The goal is to deliver a working, reviewable context graph system with an LLM-powered query interface over the provided SAP O2C dataset.

Every change should be evaluated against the assignment requirements first.

## Locked Product Definition

Build an analyst-facing O2C investigation workbench that:

- ingests the provided ERP dataset into a relational store
- projects interconnected business entities as a graph
- visualizes the graph in a simple UI
- lets users ask natural-language questions about the dataset
- translates those questions into read-only structured queries dynamically
- returns data-backed answers grounded in the dataset
- rejects unrelated prompts with clear guardrails

## Non-Negotiable Requirements

Any implementation work must preserve and improve the following:

1. Graph construction from the dataset with defensible node and edge modeling.
2. Graph visualization that supports exploration, node inspection, and relationship visibility.
3. Conversational query interface backed by real query execution, not canned responses.
4. Support for the required business query classes:
   - top products by billing-document association
   - full document-flow tracing for a given billing document
   - incomplete or broken sales-order flows
5. Guardrails that reject off-domain prompts.
6. README coverage for architecture decisions, database choice, prompting strategy, and guardrails.
7. A working demo path suitable for deployment and reviewer walkthrough.
8. Preserved AI session logs in the sessions directory.

## MVP Boundaries

Prioritize these capabilities:

- reliable ingest and schema normalization
- reliable graph construction and rendering
- transparent NL-to-SQL with generated SQL visible to the user
- readable results presentation
- predictable guardrails and test coverage

Explicitly avoid spending time on these unless required to complete the task:

- authentication or user management
- multi-tenant features
- workflow automation beyond the assignment
- overly broad chat features unrelated to the dataset
- decorative UI work that does not improve demo clarity

## Architecture Constraints

Follow the existing architecture unless there is a strong reason to change it:

- backend: FastAPI in src/backend/app
- storage: SQLite as the primary local datastore
- graph projection: derived from relational data rather than a separate graph database
- frontend: React + TypeScript + Cytoscape in src/frontend
- LLM integration: free-tier provider support with schema-aware prompting and deterministic fallback behavior

Keep the system easy to run locally and easy to deploy as a public demo.

## Query and Guardrail Rules

- All answers must be grounded in the dataset.
- Generated SQL must be read-only.
- Prefer deterministic handling for the core required query shapes when it materially improves reliability.
- Surface the generated SQL in the UI for transparency.
- Reject unrelated prompts with the assignment-aligned domain guardrail message.
- Do not silently fabricate answers when no valid query can be produced.

## UI and UX Direction

Treat the UI as an analyst workbench, not a consumer chatbot.

Preferred interaction model:

- top status area for dataset and system health
- graph explorer pane for nodes and relationships
- query pane for prompts and guided examples
- result area for business answer, generated SQL, and tabular data

When improving the frontend, prioritize:

- clear graph exploration
- node metadata inspection
- simple node expansion or neighbor reveal behavior
- readable results tables instead of raw JSON dumps
- obvious error and loading states

## Quality Bar

Before considering a task complete, try to preserve or improve:

- backend health endpoint behavior
- graph endpoint non-empty responses on the real dataset
- required query behaviors
- guardrail rejection behavior
- frontend build health
- smoke-test coverage for core workflows

## Documentation Expectations

Keep the following docs aligned with the codebase:

- README.md for setup, architecture, prompting, and guardrails
- docs/requirements-lock.md for task scope and acceptance criteria
- docs/architecture-lock.md for system design decisions
- docs/implementation-approach.md for delivery plan and priorities

When requirements change, update the lock documents in the same change set.