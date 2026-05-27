#!/usr/bin/env python3
"""Grok Desktop browser-use bridge."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys


async def run_browser_use(task: str, max_steps: int, model: str | None) -> dict[str, object]:
    try:
        from browser_use import Agent, ChatBrowserUse
    except Exception as exc:
        return {
            "ok": False,
            "error": "browser-use is not available in this Python environment.",
            "detail": str(exc),
            "install": "pip install -e .",
        }

    if not os.environ.get("BROWSER_USE_API_KEY"):
        return {
            "ok": False,
            "error": "BROWSER_USE_API_KEY is not set.",
            "detail": "Set BROWSER_USE_API_KEY or replace ChatBrowserUse with another supported browser-use LLM.",
        }

    try:
        llm = ChatBrowserUse(model=model) if model else ChatBrowserUse()
        agent = Agent(task=task, llm=llm)
        history = await agent.run(max_steps=max_steps)
        return {
            "ok": True,
            "task": task,
            "max_steps": max_steps,
            "result": str(history),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": "browser-use run failed.",
            "detail": str(exc),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a browser-use task.")
    parser.add_argument("--task", required=True, help="Browser automation task.")
    parser.add_argument("--max-steps", type=int, default=10)
    parser.add_argument("--model", help="Optional Browser Use hosted model name.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = asyncio.run(run_browser_use(args.task, args.max_steps, args.model))
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
