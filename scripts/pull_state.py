#!/usr/bin/env python3
"""Copy live publish links and metrics from the Worker into catalog.json.

The page already shows the live overlay without this step. Run it when you
want git to remember what the friend submitted.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from catalog_lib import DEFAULT_CATALOG, load_catalog, merge_overlay, recompute, save_catalog


def fetch_overlays(api_base: str, job_ids: list[str]) -> dict:
    query = urllib.parse.urlencode({"ids": ",".join(job_ids)})
    url = api_base.rstrip("/") + "/v1/state?" + query
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    overlays = payload.get("overlays") or {}
    if not isinstance(overlays, dict):
        raise ValueError("state response missing overlays object")
    return overlays


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge Worker overlays into catalog.json.")
    parser.add_argument("--api", default=os.environ.get("MOO_API_BASE", ""))
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.api:
        print("pass --api or set MOO_API_BASE", file=sys.stderr)
        sys.exit(2)

    catalog = load_catalog(args.catalog)
    videos = catalog.get("videos") or []
    job_ids = [video["job_id"] for video in videos if video.get("job_id")]
    overlays = fetch_overlays(args.api, job_ids)
    merged = []
    changed = []
    for video in videos:
        overlay = overlays.get(video.get("job_id"))
        next_video = merge_overlay(video, overlay if isinstance(overlay, dict) else None)
        if next_video.get("publish_link") != (video.get("publish_link") or "") or next_video.get(
            "stats"
        ) != video.get("stats"):
            changed.append(video.get("job_id"))
        merged.append(next_video)
    catalog["videos"] = merged
    catalog = recompute(catalog)
    if not args.dry_run:
        save_catalog(catalog, args.catalog)
    print(
        json.dumps(
            {"changed": changed, "dry_run": args.dry_run, "summary": catalog["summary"]},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
