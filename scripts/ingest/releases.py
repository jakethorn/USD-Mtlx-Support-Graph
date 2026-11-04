"""Release history of OpenUSD and MaterialX.

Dates come from the GitHub release when there is one (its publish date), otherwise from
the git tag. Release candidates and side-branch tags (e.g. v1.38.10-OpenPBR) are skipped.

Output: data/generated/releases.json
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import github_paginate, github_token, log, sparse_repo, tag_dates, version_key, write_json  # noqa: E402
from materialx_nodes import SPARSE as MTLX_SPARSE  # noqa: E402
from usd_schemas import SPARSE as USD_SPARSE  # noqa: E402

# Share the clones with the catalogue scripts (same sparse patterns, so no re-checkout churn).

PROJECTS = {
    "usd": {
        "name": "OpenUSD",
        "repo": "PixarAnimationStudios/OpenUSD",
        "cache": "OpenUSD",
        "sparse": USD_SPARSE,
        # v0.7.0 … v0.8.5a (pre-2018 numbering), then YY.MM, YY.MM.patch and hotfix letters (v22.05a).
        "tag": re.compile(r"^v(\d+\.\d+(?:\.\d+)?[a-z]?)$"),
    },
    "materialx": {
        "name": "MaterialX",
        "repo": "AcademySoftwareFoundation/MaterialX",
        "cache": "MaterialX",
        "sparse": MTLX_SPARSE,
        "tag": re.compile(r"^v(\d+\.\d+\.\d+)$"),
    },
}


def classify_usd(version: str) -> str:
    """'major' for scheduled releases (0.7.0, 24.08, 26.11.0), 'patch' for hotfixes (0.7.1, 22.05a, 25.05.01, 26.11.1)."""
    if re.fullmatch(r"0\.\d+\.0", version) or re.fullmatch(r"\d{2}\.\d{2}(\.0)?", version):
        return "major"
    return "patch"


def classify_mtlx(version: str) -> str:
    return "major" if version.endswith(".0") else "patch"


def main() -> None:
    if not github_token():
        log("note: no GITHUB_TOKEN/GH_TOKEN set; using unauthenticated GitHub API (60 requests/hour)")

    out = {}
    for key, cfg in PROJECTS.items():
        repo = sparse_repo(f"https://github.com/{cfg['repo']}.git", cfg["cache"], cfg["sparse"])
        dates = tag_dates(repo)
        published = {
            r["tag_name"]: r
            for r in github_paginate(f"repos/{cfg['repo']}/releases")
            if not r.get("draft")
        }
        releases = []
        for tag, tag_date in dates.items():
            m = cfg["tag"].match(tag)
            if not m:
                continue
            gh = published.get(tag)
            if gh and gh.get("prerelease"):
                continue
            version = m.group(1)
            releases.append(
                {
                    "version": version,
                    "tag": tag,
                    "date": (gh["published_at"][:10] if gh else tag_date),
                    "kind": classify_usd(version) if key == "usd" else classify_mtlx(version),
                    "url": gh["html_url"] if gh else f"https://github.com/{cfg['repo']}/tree/{tag}",
                }
            )
        releases.sort(key=lambda r: version_key(r["version"]) + (ord(r["version"][-1]) if r["version"][-1].isalpha() else 0,))
        log(f"{cfg['name']}: {len(releases)} releases, latest {releases[-1]['version']} ({releases[-1]['date']})")
        out[key] = {"name": cfg["name"], "repo": cfg["repo"], "releases": releases}

    write_json("releases.json", out)


if __name__ == "__main__":
    main()
