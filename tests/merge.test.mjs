import assert from "node:assert/strict";
import test from "node:test";
import { cardMeta, cardTitle, downloadUrl, isTikTokUrl, mergeVideo, summarize } from "../merge.js";

test("drive download link is derived when the catalog field is empty", () => {
  assert.equal(
    downloadUrl("", "https://drive.google.com/file/d/abcDEF_123/view?usp=drivesdk"),
    "https://drive.google.com/uc?id=abcDEF_123&export=download",
  );
  assert.equal(downloadUrl("https://cdn.example/v.mp4", "https://cdn.example/v.mp4"), "https://cdn.example/v.mp4");
});

test("tiktok urls accepted, other https urls rejected", () => {
  assert.equal(isTikTokUrl("https://www.tiktok.com/@moo/video/123"), true);
  assert.equal(isTikTokUrl("https://vm.tiktok.com/Zabc/"), true);
  assert.equal(isTikTokUrl("https://vt.tiktok.com/Zabc/"), true);
  assert.equal(isTikTokUrl("https://evil.com/tiktok.com"), false);
  assert.equal(isTikTokUrl("http://www.tiktok.com/@moo/video/1"), false);
  assert.equal(isTikTokUrl("https://tiktok.com"), false);
});

test("card title prefers folder display name over the technical subfolder id", () => {
  const unlabeled = {
    label: "ENFP",
    subfolder_name: "ENFP-r0004",
    revision: "r0004",
    platform: "TikTok",
  };
  assert.equal(cardTitle(unlabeled), "ENFP");
  assert.equal(cardMeta(unlabeled), "r0004 · ENFP-r0004 · TikTok");

  const folderTitle = {
    label: "ESFP",
    folder_title: "软萌贴纸1-ESFP",
    subfolder_name: "ESFP-r0001",
    revision: "r0001",
    platform: "TikTok",
  };
  assert.equal(cardTitle(folderTitle), "软萌贴纸1-ESFP");
  assert.equal(cardMeta(folderTitle), "ESFP · r0001 · ESFP-r0001 · TikTok");

  const titled = {
    label: "INFP",
    title: "潮玩方向2-INFP",
    folder_title: "毛毡风格2-ENFJ",
    subfolder_name: "INFP-r0002",
    revision: "r0002",
    platform: "TikTok",
  };
  assert.equal(cardTitle(titled), "潮玩方向2-INFP");
  assert.equal(cardMeta(titled), "INFP · r0002 · INFP-r0002 · TikTok");

  const sameAsSubfolder = {
    label: "sleep-types",
    folder_title: "sleep-types-r0002",
    subfolder_name: "sleep-types-r0002",
    revision: "r0002",
    platform: "TikTok",
  };
  assert.equal(cardTitle(sameAsSubfolder), "sleep-types-r0002");
  assert.equal(cardMeta(sameAsSubfolder), "sleep-types · r0002 · TikTok");

  const blankDisplay = { label: "INTJ", title: "  ", folder_title: "", revision: "r0001", platform: "" };
  assert.equal(cardTitle(blankDisplay), "INTJ");
  assert.equal(cardMeta(blankDisplay), "r0001 · TikTok");
});

test("newer overlay flips waiting item to published and keeps older catalog stats", () => {
  const video = {
    label: "ENFP",
    job_id: "job-fb280b25dd784502b4e4d6ec790fc9a9",
    stage: "WAITING_MANUAL_PUBLISH",
    publish_link: "",
    published_at: "",
    publish_copy: "caption",
    stats: { views: 5, likes: null, comments: null, shares: null, saves: null, updated_at: "2026-09-12T00:00:00Z", source: "catalog" },
  };
  const merged = mergeVideo(video, {
    publish_link: "https://www.tiktok.com/@moo/video/9",
    published_at: "2026-09-13T00:00:00Z",
    stats: { views: 1, updated_at: "2026-09-01T00:00:00Z", source: "stale" },
  });
  assert.equal(merged.stage, "PUBLISHED");
  assert.equal(merged.publish_link, "https://www.tiktok.com/@moo/video/9");
  assert.equal(merged.publish_copy, "caption");
  assert.equal(merged.stats.views, 5);
  const summary = summarize([merged, video]);
  assert.equal(summary.published_with_link, 1);
  assert.equal(summary.waiting_manual_publish, 1);
  assert.equal(summary.views, 10);
});
