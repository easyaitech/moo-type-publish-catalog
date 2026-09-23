#!/usr/bin/env python3
"""Append one waiting publish item from download URLs and caption text.

Example:
  python3 scripts/add_entry.py \\
    --label "INTJ" \\
    --video-url "https://drive.google.com/file/d/FILE_ID/view" \\
    --cover-url "https://drive.google.com/file/d/COVER_ID/view" \\
    --copy-text "第一行标题
第二行正文"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from catalog_lib import (
    DEFAULT_CATALOG,
    assert_unique_video,
    build_video,
    load_catalog,
    recompute,
    save_catalog,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Add a catalog entry from URLs and publish copy.")
    parser.add_argument("--label", required=True, help="Short name shown on the board, e.g. ENFP")
    parser.add_argument("--video-url", required=True, help="https link to the mp4 (Drive view or direct)")
    parser.add_argument("--cover-url", default="", help="https link to the cover image")
    parser.add_argument("--copy-text", default="", help="Publish caption. Shown inline on the page.")
    parser.add_argument("--copy-file", default="", help="UTF-8 text file used as the caption")
    parser.add_argument("--revision", default="r0001")
    parser.add_argument("--job-id", default="", help="Optional. Default is job- plus a random id.")
    parser.add_argument("--folder-url", default="", help="Drive folder for this cut")
    parser.add_argument("--copy-drive-url", default="", help="Optional Drive file link for the caption")
    parser.add_argument("--platform", default="TikTok")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    args = parser.parse_args()

    if args.copy_text and args.copy_file:
        parser.error("pass only one of --copy-text or --copy-file")
    publish_copy = args.copy_text
    if args.copy_file:
        publish_copy = Path(args.copy_file).read_text(encoding="utf-8")

    video = build_video(
        label=args.label,
        video_url=args.video_url,
        cover_url=args.cover_url,
        publish_copy=publish_copy,
        revision=args.revision,
        job_id=args.job_id,
        folder_url=args.folder_url,
        copy_drive_url=args.copy_drive_url,
        platform=args.platform,
    )
    catalog = load_catalog(args.catalog)
    try:
        assert_unique_video(catalog, video)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
    catalog.setdefault("videos", []).append(video)
    catalog = recompute(catalog)
    save_catalog(catalog, args.catalog)
    print(
        json.dumps(
            {
                "added": video["job_id"],
                "label": video["label"],
                "drive_video_download": video["drive_video_download"],
                "drive_cover_download": video["drive_cover_download"],
                "summary": catalog["summary"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
