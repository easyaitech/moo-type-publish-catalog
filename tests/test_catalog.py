#!/usr/bin/env python3
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from catalog_lib import (  # noqa: E402
    drive_download_url,
    load_catalog,
    merge_overlay,
    recompute,
    summarize,
)

# View links and non-empty download links from the original static catalog.
PRESERVED = [
    {
        "label": "ENFP",
        "job_id": "job-fb280b25dd784502b4e4d6ec790fc9a9",
        "revision": "r0004",
        "drive_folder": "https://drive.google.com/drive/folders/1kOr5bpK7Nn8OjerqP7kgwFc9w01_9SeB",
        "drive_video": "https://drive.google.com/file/d/1U8nwtikuV_D3Q2i77VdEpdChsWSN2Ftq/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=1U8nwtikuV_D3Q2i77VdEpdChsWSN2Ftq&export=download",
        "drive_cover": "https://drive.google.com/file/d/1DzXtR77oFOsf7l0ezymzA-BQzPcaJCGk/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/18LSI4sCD9OA7aXBMzaltaf4Lklu7VyzT/view?usp=drivesdk",
        "download_was_empty": True,
    },
    {
        "label": "sleep-types",
        "job_id": "job-02a0798db16a41159107387f7f1c32c1",
        "revision": "r0002",
        "drive_folder": "https://drive.google.com/drive/folders/10Olj6lPLOHT92OJXC95Uup5EIingkhCc",
        "drive_video": "https://drive.google.com/file/d/1V5oTyvRH-SvZ7n8ZOr3FOCu_ntbh6nNV/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=1V5oTyvRH-SvZ7n8ZOr3FOCu_ntbh6nNV&export=download",
        "drive_cover": "https://drive.google.com/file/d/1kglJ8ylZCkJc6JS_L71po0ekVCMO-qS2/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/1MZt3JqGZmSSdQYuSt8c4fJxzaBr7Y9pk/view?usp=drivesdk",
    },
    {
        "label": "ENFJ",
        "job_id": "job-0775e29ddecd4fc88eb26a0610ecc893",
        "revision": "r0002",
        "drive_folder": "https://drive.google.com/drive/folders/1dLfeUjIKXZ28t3x-n5INvZ1PxxA4iLof",
        "drive_video": "https://drive.google.com/file/d/1qw_nWx9txAO-ZQYjTHil-b6lslOKV9DZ/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=1qw_nWx9txAO-ZQYjTHil-b6lslOKV9DZ&export=download",
        "drive_cover": "https://drive.google.com/file/d/1Oe56D8afjWHJEmi_rY8oyVc6OSxr5Jb3/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/1V9c_id5O5g8tANZUNoBhhhwRc9J5p-yW/view?usp=drivesdk",
    },
    {
        "label": "INFJ",
        "job_id": "job-c7d143ac19d14f589242d0f50d054465",
        "revision": "r0001",
        "drive_folder": "https://drive.google.com/drive/folders/1dZrwoxXts2iSbq9D5pbdeFvCMiYGmrkg",
        "drive_video": "https://drive.google.com/file/d/1TFcJvFJMaCH4wEkEPc4wTsosPNq4HRhL/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=1TFcJvFJMaCH4wEkEPc4wTsosPNq4HRhL&export=download",
        "drive_cover": "https://drive.google.com/file/d/1EpyuQm6pCGCH2zbkboAegMrCKB8NuznG/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/1RtFowLZVBcpGPSxX2MdRXhSVqraEvcDv/view?usp=drivesdk",
    },
    {
        "label": "ISFP宅",
        "job_id": "job-3f055f32d34b4745b6562258617dfab1",
        "revision": "r0002",
        "drive_folder": "https://drive.google.com/drive/folders/1KT5yw-kfoMNRtLgLDBvxBvZso29zIBWr",
        "drive_video": "https://drive.google.com/file/d/101dLOUizrWP5GbutBddZBP3DrQVAvDBr/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=101dLOUizrWP5GbutBddZBP3DrQVAvDBr&export=download",
        "drive_cover": "https://drive.google.com/file/d/1baa5BPzvd6yaw-xpGs4u_cFRGbjpfBGx/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/1ox3VsF1sXriOAvqGhosz8B4OveCAzcJd/view?usp=drivesdk",
    },
    {
        "label": "ISFP摆烂",
        "job_id": "job-fc09d5b33c244ff686f91fd9276fea8b",
        "revision": "r0002",
        "drive_folder": "https://drive.google.com/drive/folders/1EmdivXkmglnIJdSa4M-gHP2D0d0hw_cf",
        "drive_video": "https://drive.google.com/file/d/1t3XOk1ZInaN7TcXDOc6ZMcEmUErH9y6z/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=1t3XOk1ZInaN7TcXDOc6ZMcEmUErH9y6z&export=download",
        "drive_cover": "https://drive.google.com/file/d/197-QXRyYvNu-bwM5thnMDKwkupV1rnvr/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/1E0Hsw6lIdZ3U-Gkru2xYRPz01MGcRgMx/view?usp=drivesdk",
    },
    {
        "label": "ENFP-warm",
        "job_id": "job-86d07ea01d1546fb8b3e5ed2949cb4a5",
        "revision": "r0002",
        "drive_folder": "https://drive.google.com/drive/folders/1_jbFOLA2lqTpmltFCR0OqkOM1-tyf8w7",
        "drive_video": "https://drive.google.com/file/d/1W42c2qmJHnjwWE-9_srTn7lO4b7x_mIv/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=1W42c2qmJHnjwWE-9_srTn7lO4b7x_mIv&export=download",
        "drive_cover": "https://drive.google.com/file/d/1JDgRe242HcaHENetgl2LtBsYNSmoKGfp/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/1EGXtzDovCapfd20zti0uYt8Aytz-HR2c/view?usp=drivesdk",
    },
    {
        "label": "INTP-solo",
        "job_id": "job-6952e0b3b5134c37abca7199e27b498b",
        "revision": "r0002",
        "drive_folder": "https://drive.google.com/drive/folders/17eUEToPxjHhzPi1Ol0sGeK7YZ_FvOUCq",
        "drive_video": "https://drive.google.com/file/d/1mEzyFaHijSNpRGUx25HNfZE2nLDgS-Xi/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=1mEzyFaHijSNpRGUx25HNfZE2nLDgS-Xi&export=download",
        "drive_cover": "https://drive.google.com/file/d/17V4mJ1FSDV9EjbuYyMimjnb8PJOUaJay/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/1vVD2tYGUrSh16qyUpKFSnuPIHGomplWz/view?usp=drivesdk",
    },
    {
        "label": "ENFP-romance",
        "job_id": "job-9dcdafb8c38c4f0b937677733f87fd37",
        "revision": "r0002",
        "drive_folder": "https://drive.google.com/drive/folders/1IbYJMXPbHF2pwdcHCDncCXJeHQallpXm",
        "drive_video": "https://drive.google.com/file/d/12bRx9JA5uoX65uYBzwE5in0D8dFMFWhE/view?usp=drivesdk",
        "drive_video_download": "https://drive.google.com/uc?id=12bRx9JA5uoX65uYBzwE5in0D8dFMFWhE&export=download",
        "drive_cover": "https://drive.google.com/file/d/1nfeW3owqOboJDORgb4o7lwvl9mYILqvA/view?usp=drivesdk",
        "drive_publish_copy": "https://drive.google.com/file/d/1e62MpIdVt8s7ve4iBIonRy8V1rmKSdWy/view?usp=drivesdk",
    },
]


class PreserveExistingTests(unittest.TestCase):
    def test_nine_original_entries_keep_drive_links_and_waiting_status(self):
        catalog = load_catalog(ROOT / "catalog.json")
        self.assertEqual([row["job_id"] for row in PRESERVED], [video["job_id"] for video in catalog["videos"][:9]])
        self.assertGreaterEqual(len(catalog["videos"]), 9)
        for expected, video in zip(PRESERVED, catalog["videos"]):
            for key in (
                "label",
                "job_id",
                "revision",
                "drive_folder",
                "drive_video",
                "drive_video_download",
                "drive_cover",
                "drive_publish_copy",
            ):
                self.assertEqual(expected[key], video[key], f"{expected['label']} {key}")
            self.assertEqual(video["stage"], "WAITING_MANUAL_PUBLISH")
            self.assertEqual(video["publish_link"], "")
            self.assertEqual(video["platform"], "TikTok")
            self.assertIn("publish_copy", video)
        summary = catalog["summary"]
        self.assertEqual(summary["total"], len(catalog["videos"]))
        self.assertEqual(summary["waiting_manual_publish"], 9)
        self.assertEqual(summary["published_with_link"], 0)


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
            self.assertEqual(saved["summary"]["total"], 10)
            self.assertEqual(saved["summary"]["waiting_manual_publish"], 10)
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
            self.assertEqual(saved["videos"][0]["job_id"], PRESERVED[0]["job_id"])

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
            self.assertEqual(saved["summary"]["waiting_manual_publish"], 9)

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


if __name__ == "__main__":
    unittest.main()
