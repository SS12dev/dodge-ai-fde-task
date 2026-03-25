from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: int = 60) -> dict[str, Any]:
    body = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url=url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        msg = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {msg}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed request to {url}: {exc}") from exc


def check(name: str, condition: bool, details: str, report: list[dict[str, Any]]) -> None:
    report.append({"name": name, "ok": condition, "details": details})


def run(base_url: str, ingest: bool, graph_limit: int) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    health = http_json("GET", f"{base_url}/api/health")
    check(
        "health",
        health.get("status") == "ok",
        f"status={health.get('status')}, tables={len(health.get('tables', []))}",
        checks,
    )

    if ingest:
        ingest_resp = http_json("POST", f"{base_url}/api/ingest/load", payload={})
        ok = bool(ingest_resp.get("ok"))
        rows_loaded = ingest_resp.get("report", {}).get("rows_loaded", 0)
        check("ingest", ok and rows_loaded > 0, f"ok={ok}, rows_loaded={rows_loaded}", checks)

    graph = http_json("GET", f"{base_url}/api/graph?limit_per_table={graph_limit}")
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    check("graph_nodes", len(nodes) > 0, f"nodes={len(nodes)}", checks)
    check("graph_edges", len(edges) > 0, f"edges={len(edges)}", checks)

    q1 = http_json(
        "POST",
        f"{base_url}/api/chat/query",
        payload={"question": "Which products have the highest number of billing documents?"},
    )
    q1_sql = (q1.get("sql") or "").lower()
    q1_not_fallback = "could not confidently map" not in q1_sql
    check(
        "query_top_products",
        bool(q1.get("ok")) and len(q1.get("rows", [])) > 0 and q1_not_fallback,
        f"ok={q1.get('ok')}, rows={len(q1.get('rows', []))}, fallback={not q1_not_fallback}",
        checks,
    )

    q2 = http_json(
        "POST",
        f"{base_url}/api/chat/query",
        payload={"question": "Show me the full O2C flow trace"},
    )
    q2_sql = (q2.get("sql") or "").lower()
    q2_not_fallback = "could not confidently map" not in q2_sql
    check(
        "query_o2c_trace",
        bool(q2.get("ok")) and len(q2.get("rows", [])) > 0 and q2_not_fallback,
        f"ok={q2.get('ok')}, rows={len(q2.get('rows', []))}, fallback={not q2_not_fallback}",
        checks,
    )

    q3 = http_json(
        "POST",
        f"{base_url}/api/chat/query",
        payload={"question": "Which sales orders are delivered but not billed?"},
    )
    q3_sql = (q3.get("sql") or "").lower()
    q3_not_fallback = "could not confidently map" not in q3_sql
    check(
        "query_broken_flow",
        bool(q3.get("ok")) and len(q3.get("rows", [])) > 0 and q3_not_fallback,
        f"ok={q3.get('ok')}, rows={len(q3.get('rows', []))}, fallback={not q3_not_fallback}",
        checks,
    )

    blocked = http_json(
        "POST",
        f"{base_url}/api/chat/query",
        payload={"question": "Write a poem about mountains"},
    )
    blocked_ok = (blocked.get("ok") is False) and "dataset" in (blocked.get("error") or "").lower()
    check("guardrail_off_domain", blocked_ok, f"ok={blocked.get('ok')}, error={blocked.get('error')}", checks)

    passed = sum(1 for c in checks if c["ok"])
    total = len(checks)

    return {
        "base_url": base_url,
        "timestamp": int(time.time()),
        "summary": {"passed": passed, "failed": total - passed, "total": total},
        "checks": checks,
        "samples": {
            "q1_sql": q1.get("sql", ""),
            "q2_sql": q2.get("sql", ""),
            "q3_sql": q3.get("sql", ""),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="End-to-end smoke tests for Dodge AI API")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--ingest", action="store_true", help="Trigger ingest before tests")
    parser.add_argument("--graph-limit", type=int, default=15, help="limit_per_table for graph endpoint")
    parser.add_argument(
        "--out",
        default="smoke_reports/e2e_smoke_report.json",
        help="Path to write JSON report",
    )
    args = parser.parse_args()

    try:
        report = run(base_url=args.base_url.rstrip("/"), ingest=args.ingest, graph_limit=max(1, args.graph_limit))
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] Smoke test crashed: {exc}")
        return 1

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=True), encoding="utf-8")

    print("Smoke Test Summary")
    print(f"- base_url: {report['base_url']}")
    print(f"- passed: {report['summary']['passed']}/{report['summary']['total']}")

    for item in report["checks"]:
        status = "PASS" if item["ok"] else "FAIL"
        print(f"- [{status}] {item['name']} :: {item['details']}")

    print(f"- report: {out_path}")

    return 0 if report["summary"]["failed"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
