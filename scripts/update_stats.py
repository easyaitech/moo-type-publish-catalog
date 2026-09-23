#!/usr/bin/env python3
"""Write play/like/comment/share/save counts for one video.

Updates catalog.json. With --push, also writes the live overlay
(needs MOO_API_BASE and MOO_ADMIN_TOKEN). The page prefers whichever
side has the newer stats.updated_at.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from catalog_lib import DEFAULT_CATALOG, find_video, load_catalog, recompute, save_catalog, utc_now


def push_stats(api_base: str, token: str, job_id: str, payload: dict) -> dict:
    body = {"id": job_id, **payload}
    request = urllib.request.Request(
        api_base.rstrip("/") + "/v1/stats",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-moo-token": token,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Update metrics for one catalog video.")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--views", type=int)
    parser.add_argument("--likes", type=int)
    parser.add_argument("--comments", type=int)
    parser.add_argument("--shares", type=int)
    parser.add_argument("--saves", type=int)
    parser.add_argument("--source", default="manual")
    parser.add_argument("--push", action="store_true", help="Also POST /v1/stats")
    parser.add_argument("--api", default=os.environ.get("MOO_API_BASE", ""))
    parser.add_argument("--token", default=os.environ.get("MOO_ADMIN_TOKEN", ""))
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    args = parser.parse_args()

    provided = {
        key: getattr(args, key)
        for key in ("views", "likes", "comments", "shares", "saves")
        if getattr(args, key) is not None
    }
    if not provided:
        parser.error("pass at least one of --views/--likes/--comments/--shares/--saves")
    for key, value in provided.items():
        if value < 0:
            parser.error(f"{key} must be >= 0")

    catalog = load_catalog(args.catalog)
    try:
        video = find_video(catalog, args.job_id)
    except KeyError:
        print(f"unknown job_id: {args.job_id}", file=sys.stderr)
        sys.exit(2)

    stats = dict(video.get("stats") or {})
    stats.update(provided)
    stats["updated_at"] = utc_now()
    stats["source"] = args.source
    video["stats"] = stats
    catalog = recompute(catalog)
    save_catalog(catalog, args.catalog)

    pushed = None
    if args.push:
        if not args.api or not args.token:
            print("MOO_API_BASE and MOO_ADMIN_TOKEN are required for --push", file=sys.stderr)
            sys.exit(2)
        try:
            pushed = push_stats(
                args.api,
                args.token,
                args.job_id,
                {**provided, "source": args.source},
            )
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            print(f"API {exc.code}: {detail}", file=sys.stderr)
            sys.exit(1)
    print(json.dumps({"job_id": args.job_id, "stats": video["stats"], "pushed": pushed}, ensure_ascii=False))


if __name__ == "__main__":
    main()
