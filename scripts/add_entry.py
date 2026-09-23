#!/usr/bin/env python3
"""Append one waiting publish item from download URLs and caption text.

The card title is the folder name a person uses, stored as folder_title
(or title if that field is set). It is not subfolder_name, which stays a
technical id such as ENFP-r0004.

Example:
  python3 scripts/add_entry.py \\
    --label "ESFP" \\
    --folder-title "软萌贴纸1-ESFP" \\
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
    parser.add_argument(
        "--label",
        required=True,
        help="Short name, e.g. ENFP. Used as the card title only when title and folder_title are empty.",
    )
    parser.add_argument("--video-url", required=True, help="https link to the mp4 (Drive view or direct)")
    parser.add_argument("--cover-url", default="", help="https link to the cover image")
    parser.add_argument("--copy-text", default="", help="Publish caption. Shown inline on the page.")
    parser.add_argument("--copy-file", default="", help="UTF-8 text file used as the caption")
    parser.add_argument("--revision", default="r0001")
    parser.add_argument(
        "--folder-title",
        default="",
        help=(
            "Folder display name shown as the card title, e.g. '软萌贴纸1-ESFP' or "
            "'sleep-types-r0002'. Not the technical subfolder id (ENFP-r0004)."
        ),
    )
    parser.add_argument(
        "--title",
        default="",
        help="Optional card title. Overrides --folder-title when both are set.",
    )
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
        folder_title=args.folder_title,
        title=args.title,
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
                "title": video.get("title") or "",
                "folder_title": video.get("folder_title") or "",
                "drive_video_download": video["drive_video_download"],
                "drive_cover_download": video["drive_cover_download"],
                "summary": catalog["summary"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
