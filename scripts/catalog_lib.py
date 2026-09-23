#!/usr/bin/env python3
"""Shared catalog helpers for the MOO TYPE publish workbench.

catalog.json is the content source (labels, copy, Drive links).
Publish links and metrics that the friend/assistant write through the API
live in the Worker overlay and are merged back with pull_state.py.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "catalog.json"

STAT_KEYS = ("views", "likes", "comments", "shares", "saves")

FIELD_ORDER = (
    "label",
    "job_id",
    "revision",
    "stage",
    "platform",
    "publish_link",
    "published_at",
    "publish_copy",
    "stats",
    "drive_folder",
    "drive_video",
    "drive_video_download",
    "drive_cover",
    "drive_cover_download",
    "drive_publish_copy",
    "subfolder_name",
    "local_release",
)

STATS_ORDER = STAT_KEYS + ("updated_at", "source")

DRIVE_FILE_RE = re.compile(r"/file/d/([^/?#]+)")
DRIVE_ID_RE = re.compile(r"[?&]id=([^&#]+)")
JOB_ID_RE = re.compile(r"^job-[a-zA-Z0-9]{8,64}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_catalog(path: Path | None = None) -> dict:
    catalog_path = Path(path) if path else DEFAULT_CATALOG
    data = json.loads(catalog_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("catalog root must be an object")
    return data


def save_catalog(catalog: dict, path: Path | None = None) -> None:
    catalog_path = Path(path) if path else DEFAULT_CATALOG
    text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    catalog_path.write_text(text, encoding="utf-8")


def drive_file_id(url: str) -> str:
    if not url:
        return ""
    match = DRIVE_FILE_RE.search(url) or DRIVE_ID_RE.search(url)
    return match.group(1) if match else ""


def drive_download_url(url: str) -> str:
    """Prefer an explicit URL. Derive a Drive download link from a file view URL."""
    file_id = drive_file_id(url)
    if file_id:
        return f"https://drive.google.com/uc?id={file_id}&export=download"
    return url or ""


def empty_stats() -> dict:
    return {
        "views": None,
        "likes": None,
        "comments": None,
        "shares": None,
        "saves": None,
        "updated_at": "",
        "source": "",
    }


def _order_dict(data: dict, order: tuple[str, ...]) -> dict:
    ordered = {}
    for key in order:
        if key in data:
            ordered[key] = data[key]
    for key, value in data.items():
        if key not in ordered:
            ordered[key] = value
    return ordered


def normalize_stats(stats: object) -> dict:
    raw = stats if isinstance(stats, dict) else {}
    out = empty_stats()
    for key in STAT_KEYS:
        value = raw.get(key)
        if value is None or value == "":
            out[key] = None
        elif isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"stat {key} must be a number or null")
        elif int(value) != value or value < 0:
            raise ValueError(f"stat {key} must be a non-negative integer")
        else:
            out[key] = int(value)
    out["updated_at"] = str(raw.get("updated_at") or "")
    out["source"] = str(raw.get("source") or "")
    return _order_dict(out, STATS_ORDER)


def normalize_video(video: dict) -> dict:
    if not isinstance(video, dict):
        raise ValueError("video entry must be an object")
    label = str(video.get("label") or "").strip()
    job_id = str(video.get("job_id") or "").strip()
    if not label:
        raise ValueError("video is missing label")
    if not JOB_ID_RE.match(job_id):
        raise ValueError(f"invalid job_id: {job_id}")
    out = dict(video)
    out["label"] = label
    out["job_id"] = job_id
    out["revision"] = str(video.get("revision") or "r0001")
    out["stage"] = str(video.get("stage") or "WAITING_MANUAL_PUBLISH")
    out["platform"] = str(video.get("platform") or "TikTok")
    out["publish_link"] = str(video.get("publish_link") or "")
    out["published_at"] = str(video.get("published_at") or "")
    out["publish_copy"] = str(video.get("publish_copy") or "")
    out["stats"] = normalize_stats(video.get("stats"))
    out["drive_folder"] = str(video.get("drive_folder") or "")
    out["drive_video"] = str(video.get("drive_video") or "")
    out["drive_cover"] = str(video.get("drive_cover") or "")
    out["drive_publish_copy"] = str(video.get("drive_publish_copy") or "")
    out["subfolder_name"] = str(video.get("subfolder_name") or f"{label}-{out['revision']}")
    out["local_release"] = str(video.get("local_release") or "")
    explicit_video_dl = str(video.get("drive_video_download") or "")
    explicit_cover_dl = str(video.get("drive_cover_download") or "")
    out["drive_video_download"] = explicit_video_dl or drive_download_url(out["drive_video"])
    out["drive_cover_download"] = explicit_cover_dl or drive_download_url(out["drive_cover"])
    if out["publish_link"] and out["stage"] == "WAITING_MANUAL_PUBLISH":
        out["stage"] = "PUBLISHED"
    return _order_dict(out, FIELD_ORDER)


def summarize(videos: list[dict]) -> dict:
    def num(value: object) -> int | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return int(value)

    def total(key: str) -> int | None:
        values = [num((video.get("stats") or {}).get(key)) for video in videos]
        present = [value for value in values if value is not None]
        return sum(present) if present else None

    return {
        "total": len(videos),
        "waiting_manual_publish": sum(
            1
            for video in videos
            if not video.get("publish_link") and video.get("stage") == "WAITING_MANUAL_PUBLISH"
        ),
        "published_with_link": sum(1 for video in videos if video.get("publish_link")),
        "views": total("views"),
        "likes": total("likes"),
        "comments": total("comments"),
        "shares": total("shares"),
        "saves": total("saves"),
    }


def recompute(catalog: dict, now: str | None = None) -> dict:
    videos_in = catalog.get("videos") or []
    if not isinstance(videos_in, list):
        raise ValueError("videos must be a list")
    videos = [normalize_video(video) for video in videos_in]
    out = dict(catalog)
    out["updated_at"] = now or utc_now()
    out["title"] = catalog.get("title") or "MOO TYPE 发布与数据看板"
    out["summary"] = summarize(videos)
    out["videos"] = videos
    out["notes_zh"] = catalog.get("notes_zh") or (
        "发布链接由朋友在页面提交；播放/点赞等数据由助理回填。Bot 不登录 TikTok 自动抓取。"
    )
    return out


def newer(left: str, right: str) -> bool:
    """True when left is a strictly newer UTC timestamp string than right."""
    if not left:
        return False
    if not right:
        return True
    return left > right


def merge_overlay(video: dict, overlay: dict | None) -> dict:
    """Overlay wins per field only when its timestamp is newer."""
    merged = normalize_video(video)
    if not overlay:
        return merged
    overlay_stats = overlay.get("stats") if isinstance(overlay.get("stats"), dict) else {}
    catalog_stats_at = (merged.get("stats") or {}).get("updated_at") or ""
    overlay_stats_at = str(overlay_stats.get("updated_at") or "")
    if newer(overlay_stats_at, catalog_stats_at):
        stats = dict(merged["stats"])
        for key in STAT_KEYS:
            if overlay_stats.get(key) is not None:
                stats[key] = int(overlay_stats[key])
        stats["updated_at"] = overlay_stats_at
        if overlay_stats.get("source"):
            stats["source"] = str(overlay_stats["source"])
        merged["stats"] = _order_dict(stats, STATS_ORDER)
    overlay_link = str(overlay.get("publish_link") or "")
    overlay_published_at = str(overlay.get("published_at") or "")
    if overlay_link and newer(overlay_published_at, merged.get("published_at") or ""):
        merged["publish_link"] = overlay_link
        merged["published_at"] = overlay_published_at
        merged["stage"] = "PUBLISHED"
    elif merged.get("publish_link") and merged.get("stage") == "WAITING_MANUAL_PUBLISH":
        merged["stage"] = "PUBLISHED"
    return _order_dict(merged, FIELD_ORDER)


def new_job_id() -> str:
    return "job-" + uuid.uuid4().hex


def build_video(
    *,
    label: str,
    video_url: str,
    cover_url: str = "",
    publish_copy: str = "",
    revision: str = "r0001",
    subfolder_name: str = "",
    job_id: str = "",
    folder_url: str = "",
    copy_drive_url: str = "",
    platform: str = "TikTok",
) -> dict:
    label = label.strip()
    if not label:
        raise ValueError("label is required")
    video_url = video_url.strip()
    if not video_url.startswith("https://"):
        raise ValueError("video-url must be an https URL")
    cover_url = cover_url.strip()
    if cover_url and not cover_url.startswith("https://"):
        raise ValueError("cover-url must be an https URL")
    folder_url = folder_url.strip()
    if folder_url and not folder_url.startswith("https://"):
        raise ValueError("folder-url must be an https URL")
    copy_drive_url = copy_drive_url.strip()
    if copy_drive_url and not copy_drive_url.startswith("https://"):
        raise ValueError("copy drive url must be an https URL")
    job_id = job_id.strip() or new_job_id()
    if not JOB_ID_RE.match(job_id):
        raise ValueError("job-id must look like job- followed by 8-64 letters or digits")
    revision = revision.strip() or "r0001"
    folder_name = subfolder_name.strip() or f"{label}-{revision}"
    return normalize_video(
        {
            "label": label,
            "job_id": job_id,
            "revision": revision,
            "stage": "WAITING_MANUAL_PUBLISH",
            "platform": platform or "TikTok",
            "publish_link": "",
            "published_at": "",
            "publish_copy": publish_copy,
            "stats": empty_stats(),
            "drive_folder": folder_url,
            "drive_video": video_url,
            "drive_video_download": drive_download_url(video_url),
            "drive_cover": cover_url,
            "drive_cover_download": drive_download_url(cover_url) if cover_url else "",
            "drive_publish_copy": copy_drive_url,
            "subfolder_name": folder_name,
            "local_release": "",
        }
    )


def find_video(catalog: dict, job_id: str) -> dict:
    for video in catalog.get("videos") or []:
        if video.get("job_id") == job_id:
            return video
    raise KeyError(job_id)


def assert_unique_video(catalog: dict, video: dict) -> None:
    file_id = drive_file_id(video.get("drive_video") or "")
    for existing in catalog.get("videos") or []:
        if existing.get("job_id") == video["job_id"]:
            raise ValueError(f"job_id already exists: {video['job_id']}")
        existing_id = drive_file_id(existing.get("drive_video") or "")
        if file_id and existing_id and file_id == existing_id:
            raise ValueError(
                f"video file already cataloged as {existing.get('label')} ({existing.get('job_id')})"
            )
