#!/usr/bin/env python3
"""Native messaging bridge between the Grok Desktop Chrome extension and the Mac app."""

from __future__ import annotations

import json
import struct
import sys
import time
from pathlib import Path
from typing import Any


APP_DIR = Path.home() / "Library" / "Application Support" / "Grok Desktop"
STATE_PATH = APP_DIR / "chrome_state.json"


def read_message() -> dict[str, Any] | None:
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise RuntimeError("Invalid native message length header.")

    message_length = struct.unpack("<I", raw_length)[0]
    if message_length == 0:
        return {}

    payload = sys.stdin.buffer.read(message_length)
    if len(payload) != message_length:
        raise RuntimeError("Native message ended before payload was complete.")

    return json.loads(payload.decode("utf-8"))


def write_message(message: dict[str, Any]) -> None:
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {
            "connected": False,
            "extensionId": None,
            "updatedAt": None,
            "lastError": None,
            "settings": {
                "focusGuard": True,
                "visibleMotion": True,
                "controlledTabsOnly": True,
            },
            "tabs": [],
        }

    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        return {
            "connected": False,
            "extensionId": None,
            "updatedAt": None,
            "lastError": f"Could not read state: {exc}",
            "settings": {
                "focusGuard": True,
                "visibleMotion": True,
                "controlledTabsOnly": True,
            },
            "tabs": [],
        }


def save_state(state: dict[str, Any]) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = STATE_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp_path.replace(STATE_PATH)


def normalize_tabs(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        tabs = list(value.values())
    elif isinstance(value, list):
        tabs = value
    else:
        tabs = []

    normalized: list[dict[str, Any]] = []
    for tab in tabs:
        if not isinstance(tab, dict):
            continue
        normalized.append(
            {
                "id": int(tab.get("id") or 0),
                "title": str(tab.get("title") or "Untitled"),
                "url": str(tab.get("url") or ""),
                "status": str(tab.get("status") or "watching"),
                "task": str(tab.get("task") or ""),
                "updatedAt": int(tab.get("updatedAt") or tab.get("updated_at") or time.time() * 1000),
                "snapshot": tab.get("snapshot") if isinstance(tab.get("snapshot"), dict) else None,
            }
        )

    return sorted(normalized, key=lambda item: item.get("updatedAt", 0), reverse=True)


def update_state(message: dict[str, Any]) -> dict[str, Any]:
    now = int(time.time() * 1000)
    state = load_state()
    message_type = str(message.get("type") or "state")

    state["connected"] = True
    state["extensionId"] = message.get("extensionId") or state.get("extensionId")
    state["updatedAt"] = now
    state["lastError"] = None

    if message_type in {"hello", "heartbeat"}:
        state["hostName"] = "com.grok.desktop.native"
    elif message_type == "state":
        state["tabs"] = normalize_tabs(message.get("tabs"))
        if isinstance(message.get("settings"), dict):
            state["settings"] = {
                "focusGuard": message["settings"].get("focusGuard", True) is not False,
                "visibleMotion": message["settings"].get("visibleMotion", True) is not False,
                "controlledTabsOnly": message["settings"].get("controlledTabsOnly", True)
                is not False,
            }
    elif message_type == "snapshot":
        tab_id = int(message.get("tabId") or 0)
        snapshot = message.get("snapshot")
        tabs = normalize_tabs(state.get("tabs"))
        for tab in tabs:
            if tab.get("id") == tab_id and isinstance(snapshot, dict):
                tab["snapshot"] = snapshot
                tab["updatedAt"] = now
                break
        state["tabs"] = tabs
    elif message_type == "error":
        state["lastError"] = str(message.get("error") or "Unknown extension error")

    save_state(state)
    return state


def main() -> int:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    save_state({**load_state(), "connected": True, "updatedAt": int(time.time() * 1000)})

    while True:
        message = read_message()
        if message is None:
            break

        try:
            state = update_state(message)
            write_message(
                {
                    "ok": True,
                    "hostName": "com.grok.desktop.native",
                    "updatedAt": state.get("updatedAt"),
                    "tabCount": len(state.get("tabs") or []),
                }
            )
        except Exception as exc:
            error_state = {
                **load_state(),
                "connected": False,
                "lastError": str(exc),
                "updatedAt": int(time.time() * 1000),
            }
            save_state(error_state)
            write_message({"ok": False, "error": str(exc)})

    save_state({**load_state(), "connected": False, "updatedAt": int(time.time() * 1000)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
