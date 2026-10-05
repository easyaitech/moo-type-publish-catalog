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

Optional English Instagram cut of the same job (shown next to the Thai
TikTok block on the page):
    --en-video-url "https://drive.google.com/file/d/EN_FILE_ID/view" \\
    --en-cover-url "https://drive.google.com/file/d/EN_COVER_ID/view" \\
    --en-copy-file ./publish-copy-en.md   # '## Caption' + '## Hashtags'
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from catalog_lib import (
    DEFAULT_CATALOG,
    assert_unique_video,
    build_instagram_en,
    build_video,
    parse_publish_copy_en,
    load_catalog,
    recompute,
    save_catalog,
)


def add_instagram_args(parser: argparse.ArgumentParser) -> None:
    group = parser.add_argument_group("English Instagram cut (optional)")
    group.add_argument("--en-video-url", default="", help="https link to the English Instagram mp4")
    group.add_argument("--en-cover-url", default="", help="https link to the English cover image")
    group.add_argument("--en-caption", default="", help="English Instagram caption text")
    group.add_argument("--en-hashtags", default="", help="English hashtags, e.g. '#ENFP #MBTI'")
    group.add_argument(
        "--en-copy-file",
        default="",
        help="publish-copy-en.md; its '## Caption' and '## Hashtags' sections fill caption/hashtags",
    )
    group.add_argument("--en-copy-drive-url", default="", help="Drive link to publish-copy-en.md")
    group.add_argument("--en-revision", default="", help="Revision of the English cut (default: --revision)")


def instagram_from_args(parser, args, *, default_revision: str = "") -> dict | None:
    en_fields = (
        args.en_video_url, args.en_cover_url, args.en_caption, args.en_hashtags,
        args.en_copy_file, args.en_copy_drive_url,
    )
    if not any(en_fields):
        return None
    if not args.en_video_url:
        raise ValueError("--en-video-url is required when adding an English Instagram cut")
    caption, hashtags = args.en_caption, args.en_hashtags
    if args.en_copy_file:
        if caption:
            raise ValueError("pass only one of --en-caption or --en-copy-file")
        caption, file_tags = parse_publish_copy_en(Path(args.en_copy_file).read_text(encoding="utf-8"))
        hashtags = hashtags or file_tags
    return build_instagram_en(
        video_url=args.en_video_url,
        cover_url=args.en_cover_url,
        caption=caption,
        hashtags=hashtags,
        copy_drive_url=args.en_copy_drive_url,
        revision=args.en_revision or default_revision,
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
    add_instagram_args(parser)
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
    try:
        instagram = instagram_from_args(parser, args, default_revision=args.revision)
    except ValueError as exc:
        parser.error(str(exc))
    if instagram:
        video["instagram_en"] = instagram
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
                "instagram_en": bool(video.get("instagram_en")),
                "summary": catalog["summary"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
