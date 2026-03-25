# Submission Checklist

## Purpose

This checklist maps directly to the Dodge AI FDE submission form and ensures no required artifact is missed.

## Required Form Fields

### 1. Name

- candidate full name entered in form

### 2. Email

- candidate email entered in form

### 3. Live Demo / Deployed Application

- public URL works without authentication
- app loads and supports a full reviewer walkthrough
- backend endpoints are reachable from the deployed frontend

### 4. Public GitHub Repository

- repository is public
- repository contains:
  - src
  - README.md
  - sessions
- setup instructions are complete and accurate

### 5. AI Coding Sessions / Prompt Logs

- AI logs are included in sessions and/or uploaded as a zip file
- logs demonstrate prompting, debugging, and iteration behavior

## Required Technical Scope Check

Before submission, verify all are true:

1. Graph construction works on the provided dataset.
2. Graph visualization supports exploration, node inspection, and relationship visibility.
3. Conversational query interface generates and executes structured queries dynamically.
4. Required query classes are supported:
   - top products by billing-document association
   - full flow tracing for a billing document
   - incomplete or broken sales-order flows
5. Guardrails reject unrelated prompts.
6. Generated SQL is visible for transparency.
7. README explains architecture decisions, database choice, prompting strategy, and guardrails.

## Demo Readiness Script

Recommended reviewer flow:

1. Show health and successful data load.
2. Show graph nodes and edges.
3. Click a node and inspect metadata.
4. Reveal neighboring graph context.
5. Run required query class A.
6. Run required query class B with a billing document.
7. Run required query class C.
8. Ask an off-domain prompt and show rejection.
9. Show generated SQL and returned rows.

## Final Pre-Submission Check

- smoke test passes locally
- frontend production build passes
- deployment URL tested in an incognito browser
- README and docs are in sync
- latest commit includes documentation lock files