"""Run every ingestion script in order. Used by `npm run ingest` and the weekly refresh workflow."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import github_stats  # noqa: E402
import materialx_nodes  # noqa: E402
import releases  # noqa: E402
import usd_schemas  # noqa: E402
from common import log  # noqa: E402

STEPS = [
    ("releases", releases.main),
    ("MaterialX nodes", materialx_nodes.main),
    ("USD schemas", usd_schemas.main),
    ("GitHub stats", github_stats.main),
]


def main() -> int:
    failed = []
    for name, step in STEPS:
        log(f"\n── {name} ──")
        try:
            step()
        except Exception as e:  # keep going: one upstream hiccup shouldn't block the others
            log(f"! {name} failed: {e!r}")
            failed.append(name)
    if failed:
        log(f"\nfailed: {', '.join(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
