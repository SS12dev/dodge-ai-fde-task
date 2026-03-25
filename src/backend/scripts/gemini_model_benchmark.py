from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv


DEFAULT_PROMPTS = [
    "Summarize 3 data-quality checks for SAP order-to-cash in 60 words.",
    "Write a SQLite query pattern to find delivered but not billed orders.",
    "List 4 risks when linking sales, delivery, billing, and payment documents.",
]

PREFERRED_MODELS = [
    "models/gemini-2.5-flash",
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-lite",
    "models/gemini-1.5-flash",
    "models/gemini-1.5-pro",
]


@dataclass
class ProbeResult:
    model: str
    prompt_index: int
    iteration: int
    ok: bool
    latency_ms: int
    prompt_tokens: int
    output_tokens: int
    total_tokens: int
    chars: int
    error: str


@dataclass
class ModelSummary:
    model: str
    attempts: int
    success: int
    fail: int
    success_rate: float
    p50_latency_ms: int
    p95_latency_ms: int
    avg_latency_ms: int
    avg_prompt_tokens: float
    avg_output_tokens: float
    avg_total_tokens: float


def _load_env() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv()


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except Exception:  # noqa: BLE001
        return 0


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
        chunks = [getattr(part, "text", "") for part in parts if getattr(part, "text", "")]
        if chunks:
            return "\n".join(chunks)
    return ""


def _extract_usage(response: Any) -> tuple[int, int, int]:
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return 0, 0, 0

    # SDK fields can vary by model/version; handle common names.
    prompt_tokens = _safe_int(
        getattr(usage, "prompt_token_count", None)
        or getattr(usage, "input_token_count", None)
    )
    output_tokens = _safe_int(
        getattr(usage, "candidates_token_count", None)
        or getattr(usage, "output_token_count", None)
        or getattr(usage, "response_token_count", None)
    )
    total_tokens = _safe_int(
        getattr(usage, "total_token_count", None)
        or (prompt_tokens + output_tokens)
    )
    return prompt_tokens, output_tokens, total_tokens


def list_generation_models() -> list[str]:
    model_rows = list(genai.list_models())
    names = [
        m.name
        for m in model_rows
        if "generateContent" in (getattr(m, "supported_generation_methods", []) or [])
        and "gemini" in m.name.lower()
    ]
    return sorted(set(names))


def choose_models(limit: int, explicit: list[str] | None) -> list[str]:
    available = set(list_generation_models())

    if explicit:
        chosen = [m for m in explicit if m in available]
        return chosen[:limit]

    preferred = [m for m in PREFERRED_MODELS if m in available]
    if preferred:
        return preferred[:limit]

    return sorted(available)[:limit]


def run_probe(model_name: str, prompt: str, prompt_index: int, iteration: int) -> ProbeResult:
    started = time.perf_counter()
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        latency = int((time.perf_counter() - started) * 1000)
        text = _extract_text(response)
        p, o, t = _extract_usage(response)
        return ProbeResult(
            model=model_name,
            prompt_index=prompt_index,
            iteration=iteration,
            ok=bool(text),
            latency_ms=latency,
            prompt_tokens=p,
            output_tokens=o,
            total_tokens=t,
            chars=len(text),
            error="",
        )
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - started) * 1000)
        return ProbeResult(
            model=model_name,
            prompt_index=prompt_index,
            iteration=iteration,
            ok=False,
            latency_ms=latency,
            prompt_tokens=0,
            output_tokens=0,
            total_tokens=0,
            chars=0,
            error=str(exc),
        )


def summarize(results: list[ProbeResult]) -> list[ModelSummary]:
    grouped: dict[str, list[ProbeResult]] = {}
    for row in results:
        grouped.setdefault(row.model, []).append(row)

    summaries: list[ModelSummary] = []
    for model, rows in grouped.items():
        attempts = len(rows)
        success_rows = [r for r in rows if r.ok]
        success = len(success_rows)
        fail = attempts - success

        latencies = [r.latency_ms for r in success_rows] if success_rows else [r.latency_ms for r in rows]
        latencies_sorted = sorted(latencies)

        p50 = int(statistics.median(latencies_sorted)) if latencies_sorted else 0
        p95 = latencies_sorted[min(len(latencies_sorted) - 1, int(len(latencies_sorted) * 0.95))] if latencies_sorted else 0
        avg_latency = int(statistics.mean(latencies_sorted)) if latencies_sorted else 0

        avg_prompt = statistics.mean([r.prompt_tokens for r in success_rows]) if success_rows else 0.0
        avg_output = statistics.mean([r.output_tokens for r in success_rows]) if success_rows else 0.0
        avg_total = statistics.mean([r.total_tokens for r in success_rows]) if success_rows else 0.0

        summaries.append(
            ModelSummary(
                model=model,
                attempts=attempts,
                success=success,
                fail=fail,
                success_rate=round((success / attempts) * 100.0, 2) if attempts else 0.0,
                p50_latency_ms=p50,
                p95_latency_ms=int(p95),
                avg_latency_ms=avg_latency,
                avg_prompt_tokens=round(avg_prompt, 2),
                avg_output_tokens=round(avg_output, 2),
                avg_total_tokens=round(avg_total, 2),
            )
        )

    return sorted(summaries, key=lambda s: (-s.success_rate, s.avg_latency_ms, s.model))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Benchmark Gemini models for latency/success/token usage and export CSV/JSON."
    )
    parser.add_argument("--api-key", help="Optional API key override; otherwise GEMINI_API_KEY from .env")
    parser.add_argument("--models", nargs="*", help="Optional explicit model names to benchmark")
    parser.add_argument("--max-models", type=int, default=4, help="Number of models to benchmark")
    parser.add_argument("--iterations", type=int, default=2, help="Iterations per prompt per model")
    parser.add_argument("--prompts-file", help="Optional text file with one prompt per line")
    parser.add_argument(
        "--out-dir",
        default="benchmark_results",
        help="Output directory for CSV/JSON files (relative to current working directory)",
    )
    args = parser.parse_args()

    _load_env()
    api_key = (args.api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not api_key:
        print("ERROR: Missing GEMINI_API_KEY. Put it in .env or pass --api-key.")
        return 1

    genai.configure(api_key=api_key)

    prompts = DEFAULT_PROMPTS
    if args.prompts_file:
        prompt_path = Path(args.prompts_file)
        if not prompt_path.exists():
            print(f"ERROR: prompts file not found: {prompt_path}")
            return 1
        prompts = [line.strip() for line in prompt_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not prompts:
            print(f"ERROR: prompts file has no non-empty lines: {prompt_path}")
            return 1

    try:
        models = choose_models(limit=max(args.max_models, 1), explicit=args.models)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: failed to list models: {exc}")
        return 1

    if not models:
        print("ERROR: no benchmarkable Gemini models found for this key.")
        return 1

    print("Benchmark configuration:")
    print(f"- models: {models}")
    print(f"- prompts: {len(prompts)}")
    print(f"- iterations per prompt: {args.iterations}")

    all_results: list[ProbeResult] = []

    for model in models:
        print(f"\nModel: {model}")
        for i in range(max(args.iterations, 1)):
            for prompt_index, prompt in enumerate(prompts):
                probe = run_probe(model, prompt, prompt_index, i)
                all_results.append(probe)
                state = "PASS" if probe.ok else "FAIL"
                print(
                    f"  [{state}] iter={i} prompt={prompt_index} latency={probe.latency_ms}ms "
                    f"tokens={probe.total_tokens} chars={probe.chars}"
                )
                if probe.error:
                    print(f"    error: {probe.error}")

    summaries = summarize(all_results)

    print("\nSummary:")
    for s in summaries:
        print(
            f"- {s.model}: success={s.success}/{s.attempts} ({s.success_rate}%), "
            f"p50={s.p50_latency_ms}ms p95={s.p95_latency_ms}ms avg={s.avg_latency_ms}ms"
        )

    out_dir = Path(args.out_dir)
    ts = int(time.time())

    detailed_rows = [asdict(r) for r in all_results]
    summary_rows = [asdict(s) for s in summaries]

    detailed_csv = out_dir / f"gemini_benchmark_detailed_{ts}.csv"
    summary_csv = out_dir / f"gemini_benchmark_summary_{ts}.csv"
    json_path = out_dir / f"gemini_benchmark_{ts}.json"

    write_csv(detailed_csv, detailed_rows)
    write_csv(summary_csv, summary_rows)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps(
            {
                "models": models,
                "prompts": prompts,
                "iterations": args.iterations,
                "detailed": detailed_rows,
                "summary": summary_rows,
            },
            indent=2,
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )

    print("\nArtifacts:")
    print(f"- {detailed_csv}")
    print(f"- {summary_csv}")
    print(f"- {json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
