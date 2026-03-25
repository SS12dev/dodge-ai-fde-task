from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import time
from pathlib import Path
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv


DEFAULT_PROMPTS = [
    "Give 3 practical SAP O2C data quality checks.",
    "Write a SQLite query idea for delivered but not billed sales orders.",
    "List 4 failure points in order-to-cash document flow.",
]

PREFERRED_MODELS = [
    "models/gemini-2.5-flash",
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-lite",
    "models/gemini-1.5-flash",
    "models/gemini-1.5-pro",
]


def _load_env() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv()


def _extract_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if text:
        return str(text)

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        if not content:
            continue
        parts = getattr(content, "parts", None) or []
        chunks = [getattr(p, "text", "") for p in parts if getattr(p, "text", "")]
        if chunks:
            return "\n".join(chunks)
    return ""


def _safe_int(v: Any) -> int:
    try:
        return int(v)
    except Exception:  # noqa: BLE001
        return 0


def _extract_usage(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage_metadata", None)
    if not usage:
        return {"prompt_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    prompt = _safe_int(
        getattr(usage, "prompt_token_count", None)
        or getattr(usage, "input_token_count", None)
    )
    output = _safe_int(
        getattr(usage, "candidates_token_count", None)
        or getattr(usage, "output_token_count", None)
        or getattr(usage, "response_token_count", None)
    )
    total = _safe_int(getattr(usage, "total_token_count", None) or (prompt + output))
    return {"prompt_tokens": prompt, "output_tokens": output, "total_tokens": total}


def list_models() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for m in genai.list_models():
        rows.append(
            {
                "name": m.name,
                "display_name": getattr(m, "display_name", ""),
                "methods": sorted(getattr(m, "supported_generation_methods", []) or []),
                "input_token_limit": getattr(m, "input_token_limit", None),
                "output_token_limit": getattr(m, "output_token_limit", None),
            }
        )
    return sorted(rows, key=lambda x: x["name"])


def choose_models(model_rows: list[dict[str, Any]], max_models: int, explicit: list[str] | None) -> list[str]:
    available = {
        m["name"]
        for m in model_rows
        if "generateContent" in m["methods"] and "gemini" in m["name"].lower()
    }

    if explicit:
        return [m for m in explicit if m in available][: max(max_models, 1)]

    preferred = [m for m in PREFERRED_MODELS if m in available]
    if preferred:
        return preferred[: max(max_models, 1)]

    return sorted(available)[: max(max_models, 1)]


def run_text_probe(model_name: str, prompt: str) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        latency_ms = int((time.perf_counter() - started) * 1000)
        text = _extract_text(response)
        usage = _extract_usage(response)
        return {
            "model": model_name,
            "ok": bool(text),
            "latency_ms": latency_ms,
            "preview": text[:300],
            **usage,
            "error": "",
        }
    except Exception as exc:  # noqa: BLE001
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "model": model_name,
            "ok": False,
            "latency_ms": latency_ms,
            "preview": "",
            "prompt_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "error": str(exc),
        }


def upload_and_wait(path: Path, timeout_s: int = 120) -> Any:
    uploaded = genai.upload_file(path=str(path))
    started = time.time()
    while True:
        state = getattr(getattr(uploaded, "state", None), "name", "")
        if state and state != "PROCESSING":
            if state != "ACTIVE":
                raise RuntimeError(f"Uploaded file state is {state}, expected ACTIVE")
            return uploaded
        if time.time() - started > timeout_s:
            raise TimeoutError(f"File processing timed out: {path}")
        time.sleep(2)
        uploaded = genai.get_file(uploaded.name)


def run_multimodal_probe(model_name: str, mode: str, file_path: str) -> dict[str, Any]:
    p = Path(file_path)
    if not p.exists():
        return {
            "model": model_name,
            "mode": mode,
            "path": file_path,
            "ok": False,
            "preview": "",
            "error": "Path does not exist",
        }

    prompt_map = {
        "image": "Describe this image in 5 concise bullet points.",
        "audio": "Summarize this audio and identify main topic and language.",
        "file": "Summarize this file and list 3 key takeaways.",
    }

    try:
        uploaded = upload_and_wait(p)
        model = genai.GenerativeModel(model_name)
        response = model.generate_content([prompt_map[mode], uploaded])
        text = _extract_text(response)
        return {
            "model": model_name,
            "mode": mode,
            "path": str(p),
            "ok": bool(text),
            "preview": text[:300],
            "error": "",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "model": model_name,
            "mode": mode,
            "path": str(p),
            "ok": False,
            "preview": "",
            "error": str(exc),
        }


def benchmark_models(models: list[str], prompts: list[str], iterations: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for model_name in models:
        for iteration in range(max(iterations, 1)):
            for idx, prompt in enumerate(prompts):
                probe = run_text_probe(model_name, prompt)
                rows.append(
                    {
                        "model": model_name,
                        "iteration": iteration,
                        "prompt_index": idx,
                        **probe,
                    }
                )
    return rows


def summarize_benchmark(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["model"], []).append(row)

    summary: list[dict[str, Any]] = []
    for model_name, model_rows in grouped.items():
        attempts = len(model_rows)
        success_rows = [r for r in model_rows if r["ok"]]
        latencies = [r["latency_ms"] for r in success_rows] or [r["latency_ms"] for r in model_rows]
        latencies_sorted = sorted(latencies)

        p50 = int(statistics.median(latencies_sorted)) if latencies_sorted else 0
        p95_index = min(len(latencies_sorted) - 1, int(len(latencies_sorted) * 0.95)) if latencies_sorted else 0
        p95 = int(latencies_sorted[p95_index]) if latencies_sorted else 0
        avg = int(statistics.mean(latencies_sorted)) if latencies_sorted else 0

        summary.append(
            {
                "model": model_name,
                "attempts": attempts,
                "success": len(success_rows),
                "fail": attempts - len(success_rows),
                "success_rate": round((len(success_rows) / attempts) * 100.0, 2) if attempts else 0.0,
                "p50_latency_ms": p50,
                "p95_latency_ms": p95,
                "avg_latency_ms": avg,
                "avg_prompt_tokens": round(statistics.mean([r["prompt_tokens"] for r in success_rows]), 2)
                if success_rows
                else 0.0,
                "avg_output_tokens": round(statistics.mean([r["output_tokens"] for r in success_rows]), 2)
                if success_rows
                else 0.0,
                "avg_total_tokens": round(statistics.mean([r["total_tokens"] for r in success_rows]), 2)
                if success_rows
                else 0.0,
            }
        )

    return sorted(summary, key=lambda r: (-r["success_rate"], r["avg_latency_ms"], r["model"]))


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Unified Gemini model discovery + capability probes + benchmark report"
    )
    parser.add_argument("--api-key", help="Optional API key override; defaults to GEMINI_API_KEY")
    parser.add_argument("--models", nargs="*", help="Optional explicit model list")
    parser.add_argument("--max-models", type=int, default=3, help="Maximum models to benchmark")
    parser.add_argument("--iterations", type=int, default=1, help="Iterations per prompt/model")
    parser.add_argument("--prompts-file", help="Optional prompts file (one prompt per line)")
    parser.add_argument("--image-path", help="Optional image path for multimodal probe")
    parser.add_argument("--audio-path", help="Optional audio path for multimodal probe")
    parser.add_argument("--file-path", help="Optional file path for multimodal probe")
    parser.add_argument("--out-dir", default="benchmark_results", help="Output directory")
    args = parser.parse_args()

    _load_env()
    api_key = (args.api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not api_key:
        print("ERROR: Missing GEMINI_API_KEY. Set .env or pass --api-key")
        return 1

    genai.configure(api_key=api_key)

    try:
        model_rows = list_models()
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: Could not list models: {exc}")
        return 1

    models = choose_models(model_rows, args.max_models, args.models)
    if not models:
        print("ERROR: No generateContent-capable Gemini models available for this key")
        return 1

    prompts = DEFAULT_PROMPTS
    if args.prompts_file:
        p = Path(args.prompts_file)
        if not p.exists():
            print(f"ERROR: prompts file not found: {p}")
            return 1
        prompts = [line.strip() for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not prompts:
            print(f"ERROR: prompts file is empty: {p}")
            return 1

    print(f"Discovered models: {len(model_rows)}")
    print(f"Benchmarking models: {models}")

    capability_text: list[dict[str, Any]] = []
    for m in models:
        probe = run_text_probe(m, "Give one line proving text generation is working.")
        capability_text.append(probe)
        status = "PASS" if probe["ok"] else "FAIL"
        print(f"- text capability [{status}] {m}")

    multimodal: list[dict[str, Any]] = []
    mm_model = models[0]
    if args.image_path:
        multimodal.append(run_multimodal_probe(mm_model, "image", args.image_path))
    if args.audio_path:
        multimodal.append(run_multimodal_probe(mm_model, "audio", args.audio_path))
    if args.file_path:
        multimodal.append(run_multimodal_probe(mm_model, "file", args.file_path))

    for row in multimodal:
        status = "PASS" if row["ok"] else "FAIL"
        print(f"- {row['mode']} capability [{status}] {row['model']}")

    detailed = benchmark_models(models, prompts, args.iterations)
    summary = summarize_benchmark(detailed)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = int(time.time())

    detailed_csv = out_dir / f"gemini_unified_detailed_{ts}.csv"
    summary_csv = out_dir / f"gemini_unified_summary_{ts}.csv"
    report_json = out_dir / f"gemini_unified_report_{ts}.json"

    _write_csv(detailed_csv, detailed)
    _write_csv(summary_csv, summary)

    report = {
        "timestamp": ts,
        "model_inventory": model_rows,
        "selected_models": models,
        "capability_text": capability_text,
        "capability_multimodal": multimodal,
        "benchmark_config": {
            "iterations": args.iterations,
            "prompt_count": len(prompts),
            "prompts": prompts,
        },
        "benchmark_detailed": detailed,
        "benchmark_summary": summary,
        "artifacts": {
            "detailed_csv": str(detailed_csv),
            "summary_csv": str(summary_csv),
            "report_json": str(report_json),
        },
    }

    report_json.write_text(json.dumps(report, indent=2, ensure_ascii=True), encoding="utf-8")

    print("\nTop summary rows:")
    for row in summary[:3]:
        print(
            f"- {row['model']}: success={row['success']}/{row['attempts']} "
            f"({row['success_rate']}%), p50={row['p50_latency_ms']}ms"
        )

    print("\nArtifacts:")
    print(f"- {detailed_csv}")
    print(f"- {summary_csv}")
    print(f"- {report_json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
