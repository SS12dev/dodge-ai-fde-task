# Requirements Lock

## Purpose

This document locks the scope of the Dodge AI FDE assignment so implementation work stays aligned with the actual evaluation criteria.

## Assignment Interpretation

The task is to build a context graph system with a natural-language query interface over a fragmented ERP dataset.

The deliverable is a working end-to-end demo, not a broad ERP platform.

## Locked MVP

The MVP is an analyst-facing O2C investigation tool that:

- ingests the provided dataset
- models entities and relationships as a graph
- visualizes the graph in a simple explorable UI
- answers natural-language questions by generating and executing structured queries dynamically
- uses governed hybrid routing so critical workflows are reliable while broader prompts remain flexible
- returns dataset-grounded natural-language responses
- rejects off-topic prompts

## Functional Requirements

### 1. Graph Construction

The system must:

- ingest the provided ERP dataset
- define nodes for core business entities
- define edges for explicit business relationships
- make those modeling decisions understandable and defensible

Expected entity coverage includes as much of the provided dataset as is useful, with emphasis on:

- sales orders
- deliveries
- billing documents
- journal entries or payments where available
- customers or business partners
- products or materials
- addresses where useful to relationship tracing

### 2. Graph Visualization

The UI must allow users to:

- view connected entities and relationships
- inspect node metadata
- expand or reveal related nodes from a selected node
- understand the graph without reading raw database tables

A simple implementation is acceptable if it is clear and usable.

### 3. Conversational Query Interface

The system must:

- accept natural-language questions
- translate them into structured operations dynamically
- execute those operations against the underlying data
- return accurate, relevant, data-backed answers
- expose enough detail for reviewers to trust the result

For production-style reliability, the system may use deterministic routing for validated high-value workflows as long as:

1. real SQL is executed against the dataset
2. broader domain-valid questions still use dynamic generation
3. generated SQL and result evidence remain transparent to reviewers and users

### 4. Required Query Classes

The MVP must reliably support these query classes:

1. Which products are associated with the highest number of billing documents?
2. Trace the full flow of a given billing document, including Sales Order, Delivery, Billing, and Journal Entry when the dataset supports it.
3. Identify sales orders with broken or incomplete flows, such as delivered but not billed or billed without delivery.

### 5. Guardrails

The system must reject unrelated prompts such as:

- general knowledge questions
- creative writing requests
- irrelevant topics outside the dataset

Target rejection message:

This system is designed to answer questions related to the provided dataset only.

## Non-Goals

The following are out of scope for the MVP unless needed for demo stability:

- authentication
- multi-user collaboration
- write-back actions into ERP systems
- generic open-ended assistant behavior
- advanced graph analytics beyond what supports the demo
- overly polished product surfaces unrelated to the assignment requirements

## Acceptance Criteria

The MVP is considered complete when all of the following are true:

1. The dataset can be loaded and queried successfully.
2. The graph renders with meaningful nodes and edges.
3. A user can inspect node details.
4. A user can reveal or expand related entities from a selected node.
5. The required query classes return real, dataset-grounded results.
6. The generated SQL is visible for transparency.
7. Off-domain prompts are rejected cleanly.
8. The project has a public repo, setup instructions, and demo-ready deployment path.
9. AI coding session logs are preserved in sessions.

## Delivery Checklist

- public GitHub repository
- working deployed demo link
- README with the required explanatory sections
- sessions logs or equivalent AI workflow evidence
- stable local setup instructions