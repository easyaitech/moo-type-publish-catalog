#!/usr/bin/env python3
"""Attach (or replace) the English Instagram cut on an existing catalog entry.

Use this to backfill instagram_en for an entry that already has its Thai
TikTok cut. Only do it when an accepted English cut really exists.

Example:
  python3 scripts/set_instagram_en.py \\
    --job-id job-1RQQKIyEqdah3u3CiJVPJWIpjdyAjCN9a \\
    --en-video-url "https://drive.google.com/file/d/EN_FILE_ID/view" \\
    --en-cover-url "https://drive.google.com/file/d/EN_COVER_ID/view" \\
    --en-copy-file ./publish-copy-en.md --en-revision r0007
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from add_entry import add_instagram_args, instagram_from_args
from catalog_lib import DEFAULT_CATALOG, load_catalog, recompute, save_catalog, set_instagram_en


def main() -> None:
    parser = argparse.ArgumentParser(description="Attach an English Instagram cut to an entry.")
    parser.add_argument("--job-id", required=True)
    add_instagram_args(parser)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    args = parser.parse_args()
    if not args.en_video_url:
        parser.error("--en-video-url is required")
    catalog = load_catalog(args.catalog)
    try:
        current = next(v for v in catalog.get("videos") or [] if v.get("job_id") == args.job_id)
    except StopIteration:
        print(f"job_id not found: {args.job_id}", file=sys.stderr)
        sys.exit(2)
    try:
        block = instagram_from_args(parser, args, default_revision=current.get("revision") or "")
        set_instagram_en(catalog, args.job_id, block)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
    catalog = recompute(catalog)
    save_catalog(catalog, args.catalog)
    updated = next(v for v in catalog["videos"] if v["job_id"] == args.job_id)
    print(json.dumps({"updated": args.job_id, "instagram_en": updated["instagram_en"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
