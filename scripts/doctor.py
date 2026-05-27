#!/usr/bin/env python3
"""Check whether Grok Desktop's optional local backends are available."""

from __future__ import annotations

import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class Check:
    name: str
    ok: bool
    command: str
    detail: str


def command_check(name: str, command: list[str]) -> Check:
    executable = shutil.which(command[0])
    if not executable:
        return Check(name=name, ok=False, command=" ".join(command), detail="not found on PATH")

    try:
        result = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
    except Exception as exc:
        return Check(name=name, ok=False, command=" ".join(command), detail=str(exc))

    detail = (result.stdout or result.stderr).strip()
    return Check(
        name=name,
        ok=result.returncode == 0,
        command=" ".join(command),
        detail=detail or f"exit {result.returncode}",
    )


def python_package_check(name: str, package: str, module: str) -> Check:
    command = f"{Path(sys.executable).name} -c 'import {module}'"
    try:
        __import__(module)
        version = importlib.metadata.version(package)
        return Check(name=name, ok=True, command=command, detail=version)
    except Exception as exc:
        return Check(name=name, ok=False, command=command, detail=str(exc))


def grok_auth_check() -> Check:
    if os.environ.get("XAI_API_KEY") or os.environ.get("GROK_CODE_XAI_API_KEY"):
        return Check(
            name="grok-auth",
            ok=True,
            command="XAI_API_KEY / GROK_CODE_XAI_API_KEY",
            detail="API key found in environment",
        )

    auth_json = Path.home() / ".grok" / "auth.json"
    auth_dir = Path.home() / ".grok" / "auth"
    if auth_json.exists() or auth_dir.exists():
        return Check(
            name="grok-auth",
            ok=True,
            command=str(auth_json if auth_json.exists() else auth_dir),
            detail="cached Grok login found",
        )

    return Check(
        name="grok-auth",
        ok=False,
        command="grok login",
        detail="not logged in; open Grok Desktop Coding Mode and click Connect Grok",
    )


def chrome_native_host_check() -> Check:
    manifest = (
        Path.home()
        / "Library"
        / "Application Support"
        / "Google"
        / "Chrome"
        / "NativeMessagingHosts"
        / "com.grok.desktop.native.json"
    )
    if manifest.exists():
        return Check(
            name="chrome-native-host",
            ok=True,
            command=str(manifest),
            detail="installed",
        )

    return Check(
        name="chrome-native-host",
        ok=False,
        command=str(manifest),
        detail="not installed; run python3 scripts/install_chrome_native_host.py --extension-id <id>",
    )


def main() -> int:
    checks = [
        command_check("grok", ["grok", "--version"]),
        grok_auth_check(),
        python_package_check("browser-use", "browser-use", "browser_use"),
        chrome_native_host_check(),
        command_check("scrcpy", ["scrcpy", "--version"]),
        command_check("scrcpy-mcp", ["scrcpy-mcp", "--version"]),
        command_check("git", ["git", "--version"]),
        command_check("node", ["node", "--version"]),
        command_check("cargo", ["cargo", "--version"]),
    ]

    print(json.dumps([asdict(check) for check in checks], indent=2))
    return 0 if all(check.ok for check in checks if check.name in {"git", "node", "cargo"}) else 1


if __name__ == "__main__":
    sys.exit(main())
