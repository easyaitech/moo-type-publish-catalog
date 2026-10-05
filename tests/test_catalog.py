#!/usr/bin/env python3
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from catalog_lib import (  # noqa: E402
    assert_unique_video,
    drive_download_url,
    load_catalog,
    merge_overlay,
    normalize_video,
    parse_publish_copy_en,
    recompute,
    summarize,
)

# Live children of Drive folder 待手动发布 (1gttIluYMAMknEcc6O9xicqrh4oYyrcF2).
DRIVE_TITLES = [
    "sleep-types-r0002",
    "毛毡风格01- ISFP",
    "毛毡风格2-ENFJ",
    "潮玩方向1-ENTP",
    "潮玩方向2-INFP",
    "软萌贴纸1-ESFP",
]

PRESERVED = [
    {
        "title": "sleep-types-r0002",
        "label": "sleep-types",
        "job_id": "job-10Olj6lPLOHT92OJXC95Uup5EIingkhCc",
        "drive_video": "https://drive.google.com/file/d/1V5oTyvRH-SvZ7n8ZOr3FOCu_ntbh6nNV/view?usp=drivesdk",
    },
    {
        "title": "毛毡风格01- ISFP",
        "label": "ISFP",
        "job_id": "job-1gqgaL8LA7CrEDPMfb8gSxWpaNFmzepD6",
        "drive_video": "https://drive.google.com/file/d/1oyf7Jo7vngDqIgf1BN2TG6JsVwR1ujf0/view?usp=drivesdk",
    },
]


def catalog_size() -> int:
    return len(load_catalog(ROOT / "catalog.json")["videos"])


class PreserveExistingTests(unittest.TestCase):
    def test_six_live_drive_folders_use_display_titles(self):
        catalog = load_catalog(ROOT / "catalog.json")
        all_videos = catalog["videos"]
        self.assertGreaterEqual(len(all_videos), 6)
        videos = all_videos[:6]
        self.assertEqual([video["title"] for video in videos], DRIVE_TITLES)
        self.assertEqual(catalog["batch_folder_id"], "1gttIluYMAMknEcc6O9xicqrh4oYyrcF2")
        job_id_re = re.compile(r"^job-[a-zA-Z0-9]{8,64}$")
        for video, title in zip(videos, DRIVE_TITLES):
            self.assertEqual(video["title"], title)
            self.assertEqual(video["folder_title"], title)
            self.assertNotEqual(video["title"], video["label"])
            folder_id = "".join(ch for ch in video["drive_folder_id"] if ch.isalnum())
            self.assertEqual(video["job_id"], f"job-{folder_id}")
            self.assertRegex(video["job_id"], job_id_re)
            self.assertEqual(video["stage"], "WAITING_MANUAL_PUBLISH")
            self.assertEqual(video["publish_link"], "")
            self.assertEqual(video["platform"], "TikTok")
            self.assertTrue(video["drive_folder"])
            self.assertTrue(video["drive_video"])
        summary = catalog["summary"]
        self.assertEqual(summary["total"], len(all_videos))
        self.assertEqual(summary, summarize(all_videos))


class CatalogToolTests(unittest.TestCase):
    def test_download_url_from_drive_view_link(self):
        self.assertEqual(
            drive_download_url("https://drive.google.com/file/d/abc123/view?usp=drivesdk"),
            "https://drive.google.com/uc?id=abc123&export=download",
        )

    def test_add_entry_appends_copy_and_download_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog_path = Path(tmp) / "catalog.json"
            catalog_path.write_text((ROOT / "catalog.json").read_text(encoding="utf-8"), encoding="utf-8")
            copy_path = Path(tmp) / "copy.txt"
            copy_path.write_text("第一行\n#标签", encoding="utf-8")
            video_url = "https://drive.google.com/file/d/NEWVIDEO123/view"
            cover_url = "https://example.com/cover.jpg"
            proc = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "add_entry.py"),
                    "--catalog",
                    str(catalog_path),
                    "--label",
                    "INTJ",
                    "--video-url",
                    video_url,
                    "--cover-url",
                    cover_url,
                    "--copy-file",
                    str(copy_path),
                    "--revision",
                    "r0003",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            added = json.loads(proc.stdout)
            saved = json.loads(catalog_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["summary"]["total"], catalog_size() + 1)
            self.assertEqual(
                saved["summary"]["waiting_manual_publish"],
                load_catalog(ROOT / "catalog.json")["summary"]["waiting_manual_publish"] + 1,
            )
            self.assertNotIn("instagram_en", saved["videos"][-1])
            video = saved["videos"][-1]
            self.assertEqual(video["job_id"], added["added"])
            self.assertEqual(video["label"], "INTJ")
            self.assertEqual(video["publish_copy"], "第一行\n#标签")
            self.assertEqual(video["stage"], "WAITING_MANUAL_PUBLISH")
            self.assertEqual(
                video["drive_video_download"],
                "https://drive.google.com/uc?id=NEWVIDEO123&export=download",
            )
            self.assertEqual(video["drive_cover_download"], cover_url)
            self.assertEqual(video["subfolder_name"], "INTJ-r0003")
            self.assertNotIn("title", video)
            self.assertNotIn("folder_title", video)
            self.assertEqual(saved["videos"][0]["job_id"], PRESERVED[0]["job_id"])

    def test_add_entry_stores_folder_display_name_not_technical_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog_path = Path(tmp) / "catalog.json"
            catalog_path.write_text((ROOT / "catalog.json").read_text(encoding="utf-8"), encoding="utf-8")
            proc = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "add_entry.py"),
                    "--catalog",
                    str(catalog_path),
                    "--label",
                    "ISFP",
                    "--folder-title",
                    "毛毡风格01- ISFP",
                    "--title",
                    "潮玩方向1-ENTP",
                    "--video-url",
                    "https://drive.google.com/file/d/FOLDERNAME123/view",
                    "--revision",
                    "r0009",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            saved = json.loads(catalog_path.read_text(encoding="utf-8"))
            video = saved["videos"][-1]
            added = json.loads(proc.stdout)
            self.assertEqual(video["job_id"], added["added"])
            self.assertEqual(video["label"], "ISFP")
            self.assertEqual(video["title"], "潮玩方向1-ENTP")
            self.assertEqual(video["folder_title"], "毛毡风格01- ISFP")
            self.assertEqual(video["subfolder_name"], "ISFP-r0009")
            self.assertEqual(added["title"], "潮玩方向1-ENTP")
            self.assertEqual(added["folder_title"], "毛毡风格01- ISFP")
            self.assertEqual(saved["videos"][0]["title"], DRIVE_TITLES[0])
            self.assertEqual(len(saved["videos"]), catalog_size() + 1)

    def test_add_entry_rejects_duplicate_drive_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog_path = Path(tmp) / "catalog.json"
            catalog_path.write_text((ROOT / "catalog.json").read_text(encoding="utf-8"), encoding="utf-8")
            proc = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "add_entry.py"),
                    "--catalog",
                    str(catalog_path),
                    "--label",
                    "ENFP-again",
                    "--video-url",
                    PRESERVED[0]["drive_video"],
                    "--copy-text",
                    "dup",
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 2)
            self.assertIn("already cataloged", proc.stderr)

    def test_update_stats_keeps_waiting_without_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog_path = Path(tmp) / "catalog.json"
            catalog_path.write_text((ROOT / "catalog.json").read_text(encoding="utf-8"), encoding="utf-8")
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "update_stats.py"),
                    "--catalog",
                    str(catalog_path),
                    "--job-id",
                    PRESERVED[1]["job_id"],
                    "--views",
                    "1200",
                    "--likes",
                    "34",
                    "--comments",
                    "0",
                    "--shares",
                    "2",
                    "--saves",
                    "5",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            saved = json.loads(catalog_path.read_text(encoding="utf-8"))
            video = next(item for item in saved["videos"] if item["job_id"] == PRESERVED[1]["job_id"])
            self.assertEqual(video["stats"]["views"], 1200)
            self.assertEqual(video["stats"]["likes"], 34)
            self.assertEqual(video["stats"]["comments"], 0)
            self.assertEqual(video["stats"]["saves"], 5)
            self.assertEqual(video["stage"], "WAITING_MANUAL_PUBLISH")
            self.assertEqual(saved["summary"]["views"], 1200)
            self.assertEqual(
                saved["summary"]["waiting_manual_publish"],
                load_catalog(ROOT / "catalog.json")["summary"]["waiting_manual_publish"],
            )

    def test_newer_overlay_wins_and_older_overlay_does_not(self):
        video = {
            "label": "ENFP",
            "job_id": PRESERVED[0]["job_id"],
            "revision": "r0004",
            "stage": "WAITING_MANUAL_PUBLISH",
            "platform": "TikTok",
            "publish_link": "",
            "published_at": "",
            "publish_copy": "",
            "stats": {
                "views": 10,
                "likes": None,
                "comments": None,
                "shares": None,
                "saves": None,
                "updated_at": "2026-09-10T00:00:00Z",
                "source": "catalog",
            },
            "drive_video": PRESERVED[0]["drive_video"],
            "drive_cover": "",
            "drive_folder": "",
            "drive_publish_copy": "",
        }
        filled = merge_overlay(
            video,
            {
                "publish_link": "https://www.tiktok.com/@moo/video/1",
                "published_at": "2026-09-09T00:00:00Z",
                "stats": {"views": 1, "updated_at": "2026-09-09T00:00:00Z", "source": "old"},
            },
        )
        self.assertEqual(filled["publish_link"], "https://www.tiktok.com/@moo/video/1")
        self.assertEqual(filled["stats"]["views"], 10)
        already = dict(video)
        already["publish_link"] = "https://www.tiktok.com/@moo/video/catalog"
        already["published_at"] = "2026-09-12T00:00:00Z"
        already["stage"] = "PUBLISHED"
        stale = merge_overlay(
            already,
            {
                "publish_link": "https://www.tiktok.com/@moo/video/1",
                "published_at": "2026-09-09T00:00:00Z",
                "stats": {"views": 1, "updated_at": "2026-09-09T00:00:00Z", "source": "old"},
            },
        )
        self.assertEqual(stale["publish_link"], "https://www.tiktok.com/@moo/video/catalog")
        self.assertEqual(stale["stats"]["views"], 10)
        newer = merge_overlay(
            video,
            {
                "publish_link": "https://www.tiktok.com/@moo/video/1",
                "published_at": "2026-09-11T00:00:00Z",
                "stats": {
                    "views": 99,
                    "likes": 7,
                    "comments": 1,
                    "shares": 0,
                    "saves": 3,
                    "updated_at": "2026-09-11T00:00:00Z",
                    "source": "api",
                },
            },
        )
        self.assertEqual(newer["stage"], "PUBLISHED")
        self.assertEqual(newer["publish_link"], "https://www.tiktok.com/@moo/video/1")
        self.assertEqual(newer["stats"]["views"], 99)
        self.assertEqual(summarize([newer])["published_with_link"], 1)
        self.assertEqual(summarize([newer])["waiting_manual_publish"], 0)

    def test_recompute_is_stable_on_real_catalog(self):
        original = load_catalog(ROOT / "catalog.json")
        again = recompute(original, now=original["updated_at"])
        self.assertEqual(original["videos"], again["videos"])
        self.assertEqual(original["summary"], again["summary"])


EN_COPY_MD = """# Instagram publish copy (en) — r0002

## Caption

Line one

Line two

## Hashtags

#ENFP #MBTI
#feltart

## Alt text

ignored
"""


class InstagramEnTests(unittest.TestCase):
    def _copy_catalog(self, tmp):
        catalog_path = Path(tmp) / "catalog.json"
        catalog_path.write_text((ROOT / "catalog.json").read_text(encoding="utf-8"), encoding="utf-8")
        return catalog_path

    def test_parse_publish_copy_en_sections(self):
        caption, tags = parse_publish_copy_en(EN_COPY_MD)
        self.assertEqual(caption, "Line one\n\nLine two")
        self.assertEqual(tags, "#ENFP #MBTI #feltart")

    def test_add_entry_with_instagram_en_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog_path = self._copy_catalog(tmp)
            en_copy = Path(tmp) / "publish-copy-en.md"
            en_copy.write_text(EN_COPY_MD, encoding="utf-8")
            proc = subprocess.run(
                [
                    sys.executable, str(ROOT / "scripts" / "add_entry.py"),
                    "--catalog", str(catalog_path),
                    "--label", "ENFP",
                    "--job-id", "job-TESTDUAL0001",
                    "--video-url", "https://drive.google.com/file/d/THVIDEO001/view",
                    "--cover-url", "https://drive.google.com/file/d/THCOVER001/view",
                    "--copy-text", "ไทย",
                    "--revision", "r0002",
                    "--en-video-url", "https://drive.google.com/file/d/ENVIDEO001/view",
                    "--en-cover-url", "https://drive.google.com/file/d/ENCOVER001/view",
                    "--en-copy-file", str(en_copy),
                    "--en-copy-drive-url", "https://drive.google.com/file/d/ENCOPY001/view",
                ],
                check=True, capture_output=True, text=True,
            )
            self.assertTrue(json.loads(proc.stdout)["instagram_en"])
            saved = json.loads(catalog_path.read_text(encoding="utf-8"))
            video = saved["videos"][-1]
            en = video["instagram_en"]
            self.assertEqual(en["platform"], "Instagram")
            self.assertEqual(en["language"], "en")
            self.assertEqual(en["revision"], "r0002")
            self.assertEqual(en["caption"], "Line one\n\nLine two")
            self.assertEqual(en["hashtags"], "#ENFP #MBTI #feltart")
            self.assertEqual(en["drive_video_download"], "https://drive.google.com/uc?id=ENVIDEO001&export=download")
            self.assertEqual(en["drive_cover_download"], "https://drive.google.com/uc?id=ENCOVER001&export=download")
            self.assertEqual(video["drive_video_download"], "https://drive.google.com/uc?id=THVIDEO001&export=download")
            self.assertEqual(recompute(saved, now=saved["updated_at"])["videos"], saved["videos"])

    def test_dedupe_considers_both_variants(self):
        catalog = {"videos": [normalize_video({
            "label": "A", "job_id": "job-AAAAAAAA01",
            "drive_video": "https://drive.google.com/file/d/TH1/view",
            "instagram_en": {"drive_video": "https://drive.google.com/file/d/EN1/view"},
        })]}
        reuse_en_as_th = {"label": "B", "job_id": "job-BBBBBBBB01",
                          "drive_video": "https://drive.google.com/file/d/EN1/view"}
        with self.assertRaises(ValueError):
            assert_unique_video(catalog, reuse_en_as_th)
        reuse_th_as_en = {"label": "C", "job_id": "job-CCCCCCCC01",
                          "drive_video": "https://drive.google.com/file/d/TH9/view",
                          "instagram_en": {"drive_video": "https://drive.google.com/file/d/TH1/view"}}
        with self.assertRaises(ValueError):
            assert_unique_video(catalog, reuse_th_as_en)
        same_file_twice = {"label": "D", "job_id": "job-DDDDDDDD01",
                           "drive_video": "https://drive.google.com/file/d/X1/view",
                           "instagram_en": {"drive_video": "https://drive.google.com/file/d/X1/view"}}
        with self.assertRaises(ValueError):
            assert_unique_video(catalog, same_file_twice)
        assert_unique_video(catalog, {"label": "E", "job_id": "job-EEEEEEEE01",
                                      "drive_video": "https://drive.google.com/file/d/NEW1/view"})

    def test_set_instagram_en_backfills_existing_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog_path = self._copy_catalog(tmp)
            target = PRESERVED[1]["job_id"]
            subprocess.run(
                [
                    sys.executable, str(ROOT / "scripts" / "set_instagram_en.py"),
                    "--catalog", str(catalog_path), "--job-id", target,
                    "--en-video-url", "https://drive.google.com/file/d/BACKFILLEN1/view",
                    "--en-caption", "Hello", "--en-hashtags", "#MBTI",
                ],
                check=True, capture_output=True, text=True,
            )
            saved = json.loads(catalog_path.read_text(encoding="utf-8"))
            self.assertEqual(len(saved["videos"]), catalog_size())
            video = next(v for v in saved["videos"] if v["job_id"] == target)
            self.assertEqual(video["instagram_en"]["caption"], "Hello")
            dup = subprocess.run(
                [
                    sys.executable, str(ROOT / "scripts" / "set_instagram_en.py"),
                    "--catalog", str(catalog_path), "--job-id", PRESERVED[0]["job_id"],
                    "--en-video-url", "https://drive.google.com/file/d/BACKFILLEN1/view",
                ],
                capture_output=True, text=True,
            )
            self.assertEqual(dup.returncode, 2)
            self.assertIn("already cataloged", dup.stderr)

    def test_thai_only_entries_stay_valid(self):
        catalog = load_catalog(ROOT / "catalog.json")
        for video in catalog["videos"]:
            normalized = normalize_video(video)
            self.assertEqual("instagram_en" in normalized, bool(video.get("instagram_en")))


if __name__ == "__main__":
    unittest.main()
