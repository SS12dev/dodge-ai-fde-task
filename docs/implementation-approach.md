# Implementation Approach

## Objective

Ship the smallest end-to-end system that fully satisfies the Dodge AI FDE task while remaining easy to explain, demo, and extend.

## Working Principles

1. Satisfy the assignment requirements before adding bonus features.
2. Optimize for demo reliability over unnecessary breadth.
3. Keep all answers grounded in the dataset.
4. Make the system easy for reviewers to inspect.
5. Prefer direct fixes to root causes over superficial patches.
6. Treat deterministic routing for benchmark workflows as a production-style reliability feature, not as a shortcut.

## Phase 1: Data and Backend Reliability

Focus:

- ingest the provided dataset cleanly
- normalize schema and preserve useful relationships
- support the required query classes reliably
- implement governed hybrid routing for deterministic and Gemini-backed prompts
- validate SQL and off-domain behavior
- add logs and safe failure handling for model and SQL execution issues

Exit criteria:

- backend starts cleanly
- data load succeeds on the real dataset
- graph endpoint returns meaningful nodes and edges
- required business queries work end to end
- smoke tests pass for health, graph, query, and guardrail flows

## Phase 2: MVP Frontend

Focus:

- clear split-pane layout
- graph rendering and basic exploration
- node metadata inspection
- simple neighbor expansion or reveal behavior
- query input with guided examples
- query mode visibility for deterministic versus Gemini handling
- readable results table
- generated SQL visibility

Exit criteria:

- the UI can support a two-minute reviewer walkthrough
- graph and query interactions are understandable without explanation
- error and loading states are obvious

## Phase 3: Demo Hardening

Focus:

- deployment readiness
- README clarity
- demo walkthrough stability
- capture of AI session logs and implementation reasoning

Exit criteria:

- public repository is complete
- demo link works without authentication
- README covers architecture, database choice, prompting strategy, and guardrails
- sessions evidence is accessible

## Prioritized Backlog

### Must Have

- reliable ingest
- reliable graph construction
- required queries
- governed hybrid query routing
- off-domain guardrails
- graph inspection
- routing visibility in the UI
- result table and SQL transparency
- public deployment path

### Nice To Have

- graph highlighting from query results
- better guided prompts
- lightweight semantic lookup for entities
- streaming responses

### Avoid Unless Necessary

- auth
- broad agent workflows
- generic knowledge chat
- large refactors that do not improve task coverage

## Demo Narrative

The intended reviewer demo should be:

1. Open the app and show dataset and graph are loaded.
2. Explore a node and inspect connected business context.
3. Ask one required aggregation question.
4. Ask one trace question for a document flow.
5. Ask one broken-flow question.
6. Show one broader Gemini-routed analyst question.
7. Show generated SQL, query mode, and resulting records.
8. Show an off-domain prompt being rejected.

## Definition of Done

The assignment is ready for submission when:

1. The MVP acceptance criteria in docs/requirements-lock.md are satisfied.
2. The architecture remains consistent with docs/architecture-lock.md.
3. The repo is easy to run from the README.
4. The public demo works.
5. The AI-assisted development trail is preserved.