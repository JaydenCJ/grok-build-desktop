#!/usr/bin/env python3
"""Clone or inspect a repository and write a compact Grok Desktop manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_EXCLUDES = {
    ".codex",
    ".git",
    ".hg",
    ".mypy_cache",
    ".next",
    ".nuxt",
    ".pnpm-store",
    ".pytest_cache",
    ".ruff_cache",
    ".svn",
    ".turbo",
    ".venv",
    "__pycache__",
    "absorbed",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "vendor",
}

TEXT_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".css",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".kt",
    ".lock",
    ".md",
    ".mjs",
    ".php",
    ".plist",
    ".py",
    ".rb",
    ".rs",
    ".sh",
    ".sql",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
}

LANG_BY_SUFFIX = {
    ".css": "CSS",
    ".go": "Go",
    ".html": "HTML",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".kt": "Kotlin",
    ".md": "Markdown",
    ".mjs": "JavaScript",
    ".php": "PHP",
    ".py": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".sh": "Shell",
    ".sql": "SQL",
    ".swift": "Swift",
    ".toml": "TOML",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".vue": "Vue",
    ".yaml": "YAML",
    ".yml": "YAML",
}

IMPORTANT_FILES = {
    "AGENTS.md",
    "Cargo.toml",
    "Dockerfile",
    "Makefile",
    "README.md",
    "deno.json",
    "package.json",
    "pnpm-workspace.yaml",
    "pyproject.toml",
    "requirements.txt",
    "tauri.conf.json",
    "tsconfig.json",
}

COMMAND_FILE_HINTS = {
    "package.json": ["npm install", "npm run build", "npm test"],
    "pnpm-lock.yaml": ["pnpm install", "pnpm build"],
    "yarn.lock": ["yarn install", "yarn build"],
    "Cargo.toml": ["cargo check", "cargo test"],
    "pyproject.toml": ["python3 -m venv .venv", "pip install -e ."],
    "requirements.txt": ["pip install -r requirements.txt"],
    "Makefile": ["make"],
    "Dockerfile": ["docker build ."],
}


@dataclass
class AbsorbedFile:
    path: str
    bytes: int
    sha256: str
    language: str
    lines: int
    copied: bool
    skipped_reason: str | None = None


def run_git(args: list[str], cwd: Path | None = None, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_remote_repo(value: str) -> bool:
    return bool(re.match(r"^(https?://|ssh://|git@)", value))


def repo_name_from_source(value: str) -> str:
    if is_remote_repo(value):
        parsed = urlparse(value)
        name = Path(parsed.path.rstrip("/")).name
    else:
        name = Path(value).expanduser().name

    return re.sub(r"\.git$", "", name) or "repo"


def should_skip(path: Path, root: Path) -> bool:
    rel_parts = path.relative_to(root).parts
    return any(part in DEFAULT_EXCLUDES for part in rel_parts)


def is_text_file(path: Path) -> bool:
    return path.suffix.lower() in TEXT_SUFFIXES or path.name in IMPORTANT_FILES


def language_for(path: Path) -> str:
    if path.name in {"Dockerfile", "Makefile"}:
        return path.name
    return LANG_BY_SUFFIX.get(path.suffix.lower(), "Other")


def count_lines(path: Path, max_file_bytes: int) -> int:
    if path.stat().st_size > max_file_bytes or not is_text_file(path):
        return 0
    try:
        return len(path.read_text(encoding="utf-8", errors="ignore").splitlines())
    except OSError:
        return 0


def prepare_source(
    repo: str,
    output_root: Path,
    branch: str | None,
    depth: int,
    force: bool,
) -> tuple[Path, dict[str, object]]:
    if not is_remote_repo(repo):
        source = Path(repo).expanduser().resolve()
        if not source.exists() or not source.is_dir():
            raise ValueError(f"Repository path does not exist: {source}")
        return source, {"source_type": "local", "source": str(source)}

    clone_dir = output_root / "_clones" / repo_name_from_source(repo)
    if clone_dir.exists() and force:
        shutil.rmtree(clone_dir)

    clone_dir.parent.mkdir(parents=True, exist_ok=True)
    if not clone_dir.exists():
        clone_args = ["clone", "--depth", str(depth)]
        if branch:
            clone_args.extend(["--branch", branch])
        clone_args.extend([repo, str(clone_dir)])
        run_git(clone_args, check=True)
    else:
        run_git(["fetch", "--depth", str(depth), "--all", "--prune"], cwd=clone_dir)
        if branch:
            run_git(["checkout", branch], cwd=clone_dir)
        run_git(["pull", "--ff-only"], cwd=clone_dir)

    return clone_dir.resolve(), {
        "source_type": "remote",
        "source": repo,
        "clone_dir": str(clone_dir.resolve()),
        "branch_requested": branch,
        "depth": depth,
    }


def git_metadata(source: Path) -> dict[str, str | bool | None]:
    if not (source / ".git").exists():
        return {"is_git": False}

    def read(args: list[str]) -> str | None:
        result = run_git(args, cwd=source)
        value = result.stdout.strip()
        return value or None

    dirty = run_git(["status", "--porcelain"], cwd=source).stdout.strip()
    return {
        "is_git": True,
        "branch": read(["rev-parse", "--abbrev-ref", "HEAD"]),
        "commit": read(["rev-parse", "HEAD"]),
        "remote": read(["config", "--get", "remote.origin.url"]),
        "dirty": bool(dirty),
    }


def write_summary(
    output_dir: Path,
    manifest: dict[str, object],
    languages: Counter[str],
    important_files: list[str],
    command_hints: list[str],
) -> Path:
    git_info = manifest.get("git", {})
    lines = [
        f"# {manifest['name']}",
        "",
        f"- Source: `{manifest['source']}`",
        f"- Files: {manifest['file_count']}",
        f"- Total bytes: {manifest['total_bytes']}",
        f"- Text lines: {manifest['text_lines']}",
        f"- Git branch: `{git_info.get('branch') or 'n/a'}`",
        f"- Git commit: `{git_info.get('commit') or 'n/a'}`",
        "",
        "## Languages",
        "",
    ]
    for language, count in languages.most_common(12):
        lines.append(f"- {language}: {count}")

    lines.extend(["", "## Important Files", ""])
    if important_files:
        lines.extend(f"- `{path}`" for path in important_files)
    else:
        lines.append("- None detected")

    lines.extend(["", "## Command Hints", ""])
    if command_hints:
        lines.extend(f"- `{command}`" for command in command_hints)
    else:
        lines.append("- None detected")

    summary_path = output_dir / "summary.md"
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return summary_path


def detect_command_hints(important_files: list[str]) -> list[str]:
    commands: list[str] = []
    for path in important_files:
        name = Path(path).name
        for command in COMMAND_FILE_HINTS.get(name, []):
            if command not in commands:
                commands.append(command)
    return commands


def absorb_repo(
    repo: str,
    output_root: Path,
    copy_text: bool,
    max_file_bytes: int,
    branch: str | None,
    depth: int,
    force: bool,
) -> tuple[Path, Path]:
    output_root = output_root.expanduser().resolve()
    source, source_info = prepare_source(repo, output_root, branch, depth, force)

    output_dir = output_root / repo_name_from_source(str(source))
    files_dir = output_dir / "files"
    if output_dir.exists() and force:
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if copy_text:
        files_dir.mkdir(parents=True, exist_ok=True)

    absorbed_files: list[AbsorbedFile] = []
    languages: Counter[str] = Counter()
    important_files: list[str] = []

    for path in sorted(source.rglob("*")):
        if not path.is_file() or should_skip(path, source):
            continue

        rel_path = path.relative_to(source)
        file_size = path.stat().st_size
        language = language_for(path)
        languages[language] += 1
        if path.name in IMPORTANT_FILES:
            important_files.append(rel_path.as_posix())

        copied = False
        skipped_reason = None
        if copy_text and is_text_file(path):
            if file_size <= max_file_bytes:
                destination = files_dir / rel_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)
                copied = True
            else:
                skipped_reason = f"larger than max_file_bytes={max_file_bytes}"
        elif copy_text:
            skipped_reason = "not a recognized text file"

        absorbed_files.append(
            AbsorbedFile(
                path=rel_path.as_posix(),
                bytes=file_size,
                sha256=hash_file(path),
                language=language,
                lines=count_lines(path, max_file_bytes),
                copied=copied,
                skipped_reason=skipped_reason,
            )
        )

    command_hints = detect_command_hints(important_files)

    manifest = {
        "name": source.name,
        "source": str(source),
        "source_info": source_info,
        "git": git_metadata(source),
        "file_count": len(absorbed_files),
        "total_bytes": sum(item.bytes for item in absorbed_files),
        "text_lines": sum(item.lines for item in absorbed_files),
        "copy_text": copy_text,
        "max_file_bytes": max_file_bytes,
        "languages": dict(languages.most_common()),
        "important_files": important_files,
        "command_hints": command_hints,
        "files": [asdict(item) for item in absorbed_files],
    }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    summary_path = write_summary(output_dir, manifest, languages, important_files, command_hints)
    return manifest_path, summary_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clone or absorb a repository into Grok Desktop.")
    parser.add_argument("repo", help="Local repository path or git URL.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("absorbed"),
        help="Output directory for manifests, clones, and copied text files.",
    )
    parser.add_argument("--branch", help="Branch to checkout when cloning a remote repository.")
    parser.add_argument("--depth", type=int, default=1, help="Git clone/fetch depth.")
    parser.add_argument(
        "--copy-text",
        action="store_true",
        help="Copy recognized text/code files into the absorbed module folder.",
    )
    parser.add_argument(
        "--max-file-bytes",
        type=int,
        default=2_000_000,
        help="Maximum text file size to copy and line-count.",
    )
    parser.add_argument("--force", action="store_true", help="Replace existing absorbed output.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path, summary_path = absorb_repo(
        repo=args.repo,
        output_root=args.output,
        copy_text=args.copy_text,
        max_file_bytes=args.max_file_bytes,
        branch=args.branch,
        depth=args.depth,
        force=args.force,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "manifest": str(manifest_path),
                "summary": str(summary_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
