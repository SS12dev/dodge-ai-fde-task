# Prompt Test Suite

## Purpose

This document provides a detailed set of prompts to manually test the Dodge AI Context Graph system against the current SAP O2C dataset.

Each prompt includes expected behavior, expected SQL shape, and pass criteria.

## Prerequisites

Start backend and frontend first.

1. Backend:

   `& ".\\.venv\\Scripts\\python.exe" -m uvicorn app.main:app --reload --port 8000 --app-dir src/backend`

2. Frontend:

   `cd src/frontend && npm run dev`

3. Open:

   `http://localhost:5173`

## How To Evaluate A Prompt

For every prompt in this suite, verify all of the following:

1. `ok` behavior in UI:
   - success prompts should return an answer and rows
   - guardrail prompts should return domain rejection
2. generated SQL is visible
3. SQL is read-only and schema-grounded
4. rows are reasonable for the query intent
5. no runtime errors in browser console

---

## A. Required Assignment Queries

### A1. Top Products By Billing Association

- Prompt:
  `Which products are associated with the highest number of billing documents?`
- Expected behavior:
  - returns top products with billing document counts
  - deterministic path is acceptable and expected
- Expected SQL shape:
  - joins `products` with `billing_document_items`
  - aggregates `COUNT(DISTINCT billing_document)`
  - `ORDER BY ... DESC`, `LIMIT`
- Expected output:
  - rows > 0
  - columns include `product`, `billing_doc_count`
- Sample observed output:
  - top row product `S8907367039280` with `billing_doc_count=22`

### A2. Full O2C Flow Trace

- Prompt:
  `Show me the full O2C flow trace`
- Expected behavior:
  - traces sales order to delivery to billing to journal linkage
- Expected SQL shape:
  - `sales_order_headers` + `outbound_delivery_items` + `outbound_delivery_headers`
  - `billing_document_items` + `billing_document_headers`
  - `journal_entry_items_accounts_receivable`
  - `LEFT JOIN`s
- Expected output:
  - rows > 0
  - columns include `sales_order`, `delivery_document`, `billing_document`
- Sample observed output:
  - 50 rows (limited)

### A3. Billing Document Specific Trace

- Prompt:
  `Trace the full flow for billing document 10001234`
- Expected behavior:
  - applies billing-document filter when numeric id is present
- Expected SQL shape:
  - includes `WHERE bdh.billing_document = '10001234'`
- Expected output:
  - either rows > 0 if document exists, or 0 rows if not present in current dataset
  - no fallback message query

### A4. Delivered But Not Billed

- Prompt:
  `Identify sales orders that are delivered but not billed`
- Expected behavior:
  - finds orders with delivery complete and billing incomplete
- Expected SQL shape:
  - filters on `overall_delivery_status` and billing status mismatch
- Expected output:
  - rows > 0

### A5. Billed But Not Delivered

- Prompt:
  `Identify sales orders that are billed but not delivered`
- Expected behavior:
  - finds orders with billing complete and delivery incomplete
- Expected SQL shape:
  - filters on billing complete with delivery mismatch
- Expected output:
  - rows can be 0 or more depending on dataset
  - no fallback message query

---

## B. Gemini-Path Prompt Coverage

These prompts are intended to test the dynamic NL-to-SQL path beyond deterministic templates.

### B1. Plant Product Coverage

- Prompt:
  `For each plant, count distinct products and sort descending.`
- Expected SQL shape:
  - joins `plants` and `product_plants`
  - `COUNT(DISTINCT product)` grouped by plant
- Expected output:
  - rows > 0

### B2. Billing To Accounting Mapping

- Prompt:
  `List billing documents with corresponding accounting documents and billing dates.`
- Expected SQL shape:
  - joins `billing_document_headers` with `journal_entry_items_accounts_receivable`
- Expected output:
  - rows can be 0 or more
  - columns include billing doc and accounting doc fields

### B3. Top Customers By Billed Amount

- Prompt:
  `Show total billed amount by sold-to-party for the top 10 customers.`
- Expected SQL shape:
  - uses billing headers and/or billing items
  - grouped by sold-to-party
  - ordered descending by billed amount
- Expected output:
  - rows > 0 preferred
  - if 0 rows, SQL should still be coherent and non-fallback

### B4. Sales Orders Vs Payments

- Prompt:
  `Compare number of sales orders versus payments by sold-to-party.`
- Expected SQL shape:
  - combines sales orders and payments grouped by partner/customer
- Expected output:
  - rows > 0
- Sample observed output:
  - 8 rows

### B5. Deliveries Without Billing

- Prompt:
  `Show customers who have deliveries but no billing documents.`
- Expected SQL shape:
  - uses delivery + billing linkage and anti-join/null filter pattern
- Expected output:
  - rows can be 0 or more

### B6. Top Business Partners By Sales Orders

- Prompt:
  `List top 10 business partners by number of sales orders.`
- Expected SQL shape:
  - joins `sales_order_headers` to `business_partners`
  - grouped by partner
  - ordered descending

### B7. Unbilled Deliveries

- Prompt:
  `Show delivery documents that do not map to any billing document.`
- Expected SQL shape:
  - delivery to billing anti-join / null filter

### B8. Product Master Completeness Check

- Prompt:
  `Give me products that appear in billing items but not in product descriptions.`
- Expected SQL shape:
  - billing items to product descriptions anti-join pattern

---

## C. Guardrail Prompts

Each of these must be rejected.

### C1

- Prompt:
  `Write a poem about mountains.`

### C2

- Prompt:
  `What is the capital of France?`

### C3

- Prompt:
  `Explain quantum physics simply.`

Expected output for all C-prompts:

1. `ok = false`
2. error message:
   `This system is designed to answer questions related to the provided dataset only.`
3. empty rows and empty SQL

---

## D. Robustness Prompts

### D1. Ambiguous Domain Prompt

- Prompt:
  `Show me billing trends.`
- Expected:
  - should either produce coherent SQL or explicit fallback message query
  - must not hallucinate answer without data execution

### D2. Invalid Document Id Format

- Prompt:
  `Trace flow for billing document ABCD-XYZ`
- Expected:
  - still produces safe SQL (likely generic flow trace if id cannot be extracted)

### D3. Large Numeric Id Not Present

- Prompt:
  `Trace the full flow for billing document 99999999`
- Expected:
  - SQL includes billing-document filter
  - rows may be 0

---

## E. Pass/Fail Rubric

A prompt test run is considered healthy when:

1. Required query set (Section A) passes.
2. At least 5 of 8 Gemini-path prompts in Section B produce non-fallback SQL.
3. All guardrail prompts in Section C are rejected correctly.
4. No frontend crashes or Cytoscape runtime errors occur.

---

## F. Known Fallback Signal

If you see this SQL exactly, generation failed to map:

`SELECT 'Could not confidently map question to schema. Please be more specific.' AS message LIMIT 1`

If fallback appears for many Section B prompts:

1. verify backend logs for model errors/rate limits
2. verify `.env` model settings
3. restart backend after `.env` changes
