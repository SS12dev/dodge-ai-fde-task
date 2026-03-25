from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv


def _load_env() -> None:
    # Load root .env if present (repo root is three levels above this file)
    repo_root = Path(__file__).resolve().parents[3]
    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv()


def _ensure_api_key(explicit_key: str | None) -> str:
    key = explicit_key or os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "Missing GEMINI_API_KEY. Set it in .env or pass --api-key."
        )
    return key


def _safe_response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if text:
        return str(text).strip()

    # Fallback for structured responses where .text may be absent.
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        if not content:
            continue
        parts = getattr(content, "parts", None) or []
        chunks = [getattr(p, "text", "") for p in parts if getattr(p, "text", "")]
        if chunks:
            return "\n".join(chunks).strip()
    return ""


def list_models() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for m in genai.list_models():
        rows.append(
            {
                "name": m.name,
                "display_name": getattr(m, "display_name", ""),
                "description": (getattr(m, "description", "") or "")[:180],
                "methods": sorted(getattr(m, "supported_generation_methods", []) or []),
                "input_token_limit": getattr(m, "input_token_limit", None),
                "output_token_limit": getattr(m, "output_token_limit", None),
            }
        )
    return sorted(rows, key=lambda x: x["name"])


def choose_generation_models(models: list[dict[str, Any]]) -> list[str]:
    preferred = [
        "models/gemini-2.0-flash",
        "models/gemini-1.5-pro",
        "models/gemini-1.5-flash",
        "models/gemini-1.5-flash-8b",
    ]
    available = {m["name"] for m in models if "generateContent" in m["methods"]}

    picks: list[str] = [m for m in preferred if m in available]
    if picks:
        return picks

    return [
        m["name"]
        for m in models
        if "generateContent" in m["methods"] and "gemini" in m["name"].lower()
    ]


def run_text_probe(model_name: str, prompt: str) -> dict[str, Any]:
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        text = _safe_response_text(response)
        return {
            "model": model_name,
            "ok": bool(text),
            "preview": (text[:300] + "...") if len(text) > 300 else text,
            "error": "",
        }
    except Exception as exc:  # noqa: BLE001
        return {"model": model_name, "ok": False, "preview": "", "error": str(exc)}


def upload_and_wait(path: Path, timeout_s: int = 120) -> Any:
    uploaded = genai.upload_file(path=str(path))
    started = time.time()

    while True:
        state_obj = getattr(uploaded, "state", None)
        state_name = getattr(state_obj, "name", "") if state_obj else ""

        if state_name and state_name != "PROCESSING":
            if state_name != "ACTIVE":
                raise RuntimeError(f"Uploaded file state is {state_name}, expected ACTIVE.")
            return uploaded

        if time.time() - started > timeout_s:
            raise TimeoutError(f"File processing timed out after {timeout_s}s: {path}")

        time.sleep(2)
        uploaded = genai.get_file(uploaded.name)


def run_file_probe(model_name: str, path: Path, mode: str) -> dict[str, Any]:
    if not path.exists():
        return {
            "model": model_name,
            "mode": mode,
            "path": str(path),
            "ok": False,
            "preview": "",
            "error": "Path does not exist",
        }

    prompts = {
        "image": "Describe this image in 5 concise bullet points.",
        "audio": "Summarize this audio. Include language, topic, and key points.",
        "file": "Summarize this file and list 3 key insights.",
    }

    try:
        uploaded = upload_and_wait(path)
        model = genai.GenerativeModel(model_name)
        response = model.generate_content([prompts[mode], uploaded])
        text = _safe_response_text(response)
        return {
            "model": model_name,
            "mode": mode,
            "path": str(path),
            "ok": bool(text),
            "preview": (text[:300] + "...") if len(text) > 300 else text,
            "error": "",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "model": model_name,
            "mode": mode,
            "path": str(path),
            "ok": False,
            "preview": "",
            "error": str(exc),
        }


def print_model_summary(models: list[dict[str, Any]], top_n: int) -> None:
    print(f"Total models visible to this key: {len(models)}")
    print("Top models:")
    for row in models[:top_n]:
        methods = ",".join(row["methods"])
        print(f"- {row['name']} | methods=[{methods}]")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Gemini capability explorer: list models and run text/image/audio/file probes."
    )
    parser.add_argument("--api-key", help="Optional API key override; else GEMINI_API_KEY is used.")
    parser.add_argument("--top-models", type=int, default=12, help="How many models to print in console summary.")
    parser.add_argument("--text-models", type=int, default=3, help="How many generation models to text-test.")
    parser.add_argument(
        "--text-prompt",
        default="Give 3 practical checks to validate SAP O2C data quality.",
        help="Prompt used for text generation probe.",
    )
    parser.add_argument("--image-path", help="Optional image path for multimodal probe.")
    parser.add_argument("--audio-path", help="Optional audio path for multimodal probe.")
    parser.add_argument("--file-path", help="Optional generic file path for file probe.")
    parser.add_argument("--json", action="store_true", help="Print full JSON report.")
    args = parser.parse_args()

    _load_env()

    try:
        api_key = _ensure_api_key(args.api_key)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}")
        return 1

    genai.configure(api_key=api_key)

    report: dict[str, Any] = {
        "models": [],
        "text_probes": [],
        "multimodal_probes": [],
    }

    try:
        models = list_models()
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: Failed to list models: {exc}")
        return 1

    report["models"] = models
    print_model_summary(models, args.top_models)

    generation_models = choose_generation_models(models)
    if not generation_models:
        print("No generateContent-capable Gemini models found for this key.")
    else:
        print("\nText probes:")
        for model_name in generation_models[: max(args.text_models, 1)]:
            probe = run_text_probe(model_name, args.text_prompt)
            report["text_probes"].append(probe)
            status = "PASS" if probe["ok"] else "FAIL"
            print(f"- [{status}] {model_name}")
            if probe["ok"] and probe["preview"]:
                print(f"  preview: {probe['preview']}")
            if probe["error"]:
                print(f"  error: {probe['error']}")

    mm_model = generation_models[0] if generation_models else ""
    if mm_model:
        for mode, maybe_path in (
            ("image", args.image_path),
            ("audio", args.audio_path),
            ("file", args.file_path),
        ):
            if not maybe_path:
                continue
            probe = run_file_probe(mm_model, Path(maybe_path), mode)
            report["multimodal_probes"].append(probe)
            status = "PASS" if probe["ok"] else "FAIL"
            print(f"\n{mode.upper()} probe with {mm_model}: [{status}]")
            if probe["ok"] and probe["preview"]:
                print(f"preview: {probe['preview']}")
            if probe["error"]:
                print(f"error: {probe['error']}")

    if not any([args.image_path, args.audio_path, args.file_path]):
        print("\nNo --image-path/--audio-path/--file-path provided. Skipped multimodal file probes.")

    if args.json:
        print("\nFull report JSON:")
        print(json.dumps(report, indent=2, ensure_ascii=True))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
