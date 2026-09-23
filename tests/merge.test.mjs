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

test("card title is the drive folder name and meta skips that name", () => {
  const enfp = { label: "ENFP", subfolder_name: "ENFP-r0004", revision: "r0004", platform: "TikTok" };
  assert.equal(cardTitle(enfp), "ENFP-r0004");
  assert.equal(cardMeta(enfp), "ENFP · r0004 · TikTok");

  const home = { label: "ISFP宅", subfolder_name: "ISFP-home-r0002", revision: "r0002", platform: "TikTok" };
  assert.equal(cardTitle(home), "ISFP-home-r0002");
  assert.equal(cardMeta(home), "ISFP宅 · r0002 · TikTok");

  const fallback = { label: "INTJ", revision: "r0001", platform: "" };
  assert.equal(cardTitle(fallback), "INTJ");
  assert.equal(cardMeta(fallback), "r0001 · TikTok");

  const same = { label: "ENFP-r0004", subfolder_name: "ENFP-r0004", revision: "r0004", platform: "TikTok" };
  assert.equal(cardTitle(same), "ENFP-r0004");
  assert.equal(cardMeta(same), "r0004 · TikTok");
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
