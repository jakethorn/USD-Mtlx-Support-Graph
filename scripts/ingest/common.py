"""Shared helpers for the ingestion scripts (Python stdlib only).

Upstream repositories are partially cloned (no blobs, sparse) into .cache/repos/ and
only the files we parse are checked out per tag, so a full history scan stays small.
Everything written goes to data/generated/ as deterministic, pretty-printed JSON so the
weekly refresh only produces a diff when upstream actually changed.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable

# Windows consoles and pipes default to cp1252; log lines use arrows and box-drawing characters.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache" / "repos"
GENERATED = ROOT / "data" / "generated"


def log(msg: str) -> None:
    print(msg, flush=True)


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout


def sparse_repo(url: str, name: str, patterns: list[str]) -> Path:
    """Blobless, sparse clone of `url` in .cache/repos/<name>, limited to `patterns`."""
    repo = CACHE / name
    if not (repo / ".git").exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        log(f"cloning {url} (blobless, sparse)…")
        subprocess.run(
            ["git", "clone", "-q", "--filter=blob:none", "--no-checkout", "--sparse", url, str(repo)], check=True
        )
    else:
        git(repo, "fetch", "-q", "--tags", "--force", "origin")
    git(repo, "sparse-checkout", "set", "--no-cone", *patterns)
    return repo


def checkout(repo: Path, tag: str) -> None:
    git(repo, "checkout", "-q", "--force", tag)


def tags(repo: Path) -> list[str]:
    return git(repo, "tag", "--list").split()


def tag_dates(repo: Path) -> dict[str, str]:
    """tag → ISO date (tagger date for annotated tags, else commit date)."""
    out = git(repo, "for-each-ref", "--format=%(refname:short) %(creatordate:short)", "refs/tags")
    return dict(line.split(" ", 1) for line in out.splitlines() if " " in line)


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(p) for p in re.findall(r"\d+", version))


def write_json(name: str, data: Any) -> Path:
    GENERATED.mkdir(parents=True, exist_ok=True)
    path = GENERATED / name
    text = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        log(f"unchanged {path.relative_to(ROOT).as_posix()}")
    else:
        path.write_text(text, encoding="utf-8", newline="\n")
        log(f"wrote {path.relative_to(ROOT).as_posix()} ({len(text) // 1024} KB)")
    return path


# --------------------------------------------------------------------------- GitHub API


def github_token() -> str | None:
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")


def github_api(path: str, params: dict[str, Any] | None = None) -> tuple[int, Any]:
    """GET https://api.github.com/<path>. Returns (status, parsed JSON or None)."""
    query = "?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else ""
    req = urllib.request.Request(f"https://api.github.com/{path.lstrip('/')}{query}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "usd-mtlx-support-graph-ingest")
    token = github_token()
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        return e.code, None


def github_paginate(path: str, params: dict[str, Any] | None = None, limit_pages: int = 20) -> Iterable[Any]:
    params = {"per_page": 100, **(params or {})}
    for page in range(1, limit_pages + 1):
        status, data = github_api(path, {**params, "page": page})
        if status != 200:
            raise RuntimeError(f"GitHub API {path} → HTTP {status}")
        if not data:
            return
        yield from data
        if len(data) < params["per_page"]:
            return
