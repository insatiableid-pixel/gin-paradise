#!/usr/bin/env python3
"""
Export the research Match Equity Table to the shared product + data paths.

Source of truth:
  docs/archive/research/gin_rummy/match_equity_cache.json

Outputs:
  data/match_equity_table.json
  gin-galaxy/src/lib/data/match_equity_table.json
"""

from __future__ import annotations

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(
    REPO_ROOT, "docs", "archive", "research", "gin_rummy", "match_equity_cache.json"
)
OUTS = [
    os.path.join(REPO_ROOT, "data", "match_equity_table.json"),
    os.path.join(REPO_ROOT, "gin-galaxy", "src", "lib", "data", "match_equity_table.json"),
]


def main() -> None:
    if not os.path.isfile(SRC):
        print(f"Missing MET source: {SRC}", file=sys.stderr)
        raise SystemExit(1)

    with open(SRC, encoding="utf-8") as f:
        raw = json.load(f)

    out = {
        "table": raw["table"],
        "target_score": raw.get("target_score", 100),
        "bucket_size": raw.get("bucket_size", 10),
        "sims_per_bucket": raw.get("sims_per_bucket", 50),
        "source": raw.get("source", "unknown"),
        "exported_for": "gin-galaxy product Apex + research baseline parity",
    }

    for path in OUTS:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
            f.write("\n")
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
