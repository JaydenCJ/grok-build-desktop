#!/usr/bin/env python3
"""Install the local Chrome Native Messaging manifest for Grok Desktop."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
from pathlib import Path


HOST_NAME = "com.grok.desktop.native"
CHROME_HOST_DIR = Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "NativeMessagingHosts"
EXTENSION_ID_RE = re.compile(r"^[a-p]{32}$")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--extension-id",
        required=True,
        help="Chrome extension ID from chrome://extensions.",
    )
    parser.add_argument(
        "--target-dir",
        type=Path,
        default=CHROME_HOST_DIR,
        help="NativeMessagingHosts directory. Defaults to Google Chrome on macOS.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    extension_id = args.extension_id.strip()
    if not EXTENSION_ID_RE.match(extension_id):
        raise SystemExit(
            "Invalid Chrome extension ID. Open chrome://extensions, copy the 32-character ID, "
            "and run this command again."
        )

    host_path = repo_root() / "scripts" / "grok_desktop_native_host.py"
    host_path.chmod(host_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    args.target_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.target_dir / f"{HOST_NAME}.json"
    manifest = {
        "name": HOST_NAME,
        "description": "Grok Desktop local bridge for Chrome tab monitoring.",
        "path": str(host_path),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/"],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "ok": True,
                "host": HOST_NAME,
                "manifest_path": str(manifest_path),
                "host_path": str(host_path),
                "extension_id": extension_id,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
