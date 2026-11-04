"""GitHub activity for every repo referenced by data/projects/*.yaml and data/products/*.yaml.

Per repo it records stars, forks, open issues, licence, archived flag, last push, latest
release and the weekly commit counts for the past year (for sparklines). If a request
fails, the previous values are kept, so a flaky API call never wipes data. Renamed
repositories are reported so the YAML can be updated.

Needs GITHUB_TOKEN (or GH_TOKEN) for a sensible rate limit.

Output: data/generated/github-stats.json
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import GENERATED, ROOT, github_api, github_token, log, write_json  # noqa: E402

REPO_LINE = re.compile(r"""^repo:\s*["']?([\w.-]+/[\w.-]+)["']?\s*$""", re.M)


def referenced_repos() -> dict[str, str]:
    """repo → the data file that references it."""
    repos: dict[str, str] = {}
    for folder in ("projects", "products"):
        for path in sorted((ROOT / "data" / folder).glob("*.yaml")):
            m = REPO_LINE.search(path.read_text(encoding="utf-8"))
            if m:
                repos[m.group(1)] = path.relative_to(ROOT).as_posix()
    return repos


def participation(repo: str) -> list[int] | None:
    # GitHub computes repository statistics lazily and answers 202 until they're ready.
    for attempt in range(4):
        status, data = github_api(f"repos/{repo}/stats/participation")
        if status == 200 and data and "all" in data:
            return data["all"]
        if status != 202:
            return None
        time.sleep(2 + attempt * 2)
    return None


def fetch(repo: str) -> dict | None:
    status, info = github_api(f"repos/{repo}")
    if status != 200 or not info:
        log(f"  ! {repo}: HTTP {status}")
        return None
    entry = {
        "fullName": info["full_name"],
        "url": info["html_url"],
        "description": info.get("description"),
        "stars": info["stargazers_count"],
        "forks": info["forks_count"],
        "openIssues": info["open_issues_count"],
        "license": (info.get("license") or {}).get("spdx_id"),
        "language": info.get("language"),
        "topics": info.get("topics", []),
        "archived": info["archived"],
        "createdAt": info["created_at"][:10],
        "pushedAt": info["pushed_at"][:10] if info.get("pushed_at") else None,
    }
    status, release = github_api(f"repos/{repo}/releases/latest")
    entry["latestRelease"] = (
        {"tag": release["tag_name"], "date": (release.get("published_at") or release["created_at"])[:10]}
        if status == 200 and release
        else None
    )
    entry["weeklyCommits"] = participation(info["full_name"])
    return entry


def main() -> None:
    if not github_token():
        log("note: no GITHUB_TOKEN/GH_TOKEN set; unauthenticated requests are limited to 60/hour")
    previous_path = GENERATED / "github-stats.json"
    previous = json.loads(previous_path.read_text(encoding="utf-8"))["repos"] if previous_path.exists() else {}

    repos = referenced_repos()
    log(f"fetching GitHub stats for {len(repos)} repos")
    out: dict[str, dict] = {}
    renamed = []
    for repo, source in repos.items():
        entry = fetch(repo)
        if entry is None:
            if repo in previous:
                out[repo] = previous[repo]
            continue
        if entry["weeklyCommits"] is None and repo in previous:
            entry["weeklyCommits"] = previous[repo].get("weeklyCommits")
        if entry["fullName"].lower() != repo.lower():
            renamed.append(f"{repo} → {entry['fullName']} (update {source})")
        out[repo] = entry

    for line in renamed:
        log(f"  ! renamed: {line}")
    write_json(
        "github-stats.json",
        {"fetched": dt.date.today().isoformat(), "repos": dict(sorted(out.items(), key=lambda kv: kv[0].lower()))},
    )


if __name__ == "__main__":
    main()
