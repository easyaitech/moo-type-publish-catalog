import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectTikTokHtml, parseTikTokPublicStats, refreshFailureLog } from "../src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(HERE, "fixtures/tiktok-rehydration.html"), "utf8");

function page(payload) {
  return `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(payload)}</script></html>`;
}

const FULL = {
  playCount: 345,
  diggCount: 9,
  commentCount: 0,
  shareCount: 1,
  collectCount: 0,
};

test("fixture HTML maps universal data counts", () => {
  assert.deepEqual(parseTikTokPublicStats(FIXTURE), {
    views: 345,
    likes: 9,
    comments: 0,
    shares: 1,
    saves: 0,
  });
});

test("string statsV2 counts are accepted when stats is absent", () => {
  const html = page({
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        itemInfo: {
          itemStruct: {
            statsV2: {
              playCount: "345",
              diggCount: "9",
              commentCount: "0",
              shareCount: "1",
              collectCount: "0",
            },
          },
        },
      },
    },
  });
  assert.deepEqual(parseTikTokPublicStats(html), {
    views: 345,
    likes: 9,
    comments: 0,
    shares: 1,
    saves: 0,
  });
});

test("a detail payload with missing counts does not fall through to another video", () => {
  const html = page({
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": { itemInfo: { itemStruct: { stats: { playCount: 1 } } } },
      other: {
        itemInfo: {
          itemStruct: {
            stats: { playCount: 9, diggCount: 9, commentCount: 9, shareCount: 9, collectCount: 9 },
          },
        },
      },
    },
  });
  assert.equal(parseTikTokPublicStats(html), null);
});

test("nested itemInfo is used when the page has no video-detail scope", () => {
  const html = page({
    data: { itemInfo: { itemStruct: { stats: { ...FULL, playCount: 4 } } } },
  });
  assert.equal(parseTikTokPublicStats(html).views, 4);
  assert.equal(parseTikTokPublicStats(html).saves, 0);
});

test("invalid counts and missing markup do not invent numbers", () => {
  assert.equal(parseTikTokPublicStats("<html><body>log in</body></html>"), null);
  assert.equal(
    parseTikTokPublicStats('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{</script>'),
    null,
  );
  const booleans = page({
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        itemInfo: {
          itemStruct: {
            stats: { playCount: true, diggCount: 1, commentCount: 1, shareCount: 1, collectCount: 1 },
            statsV2: { playCount: "12", diggCount: "1", commentCount: "1", shareCount: "1", collectCount: "1" },
          },
        },
      },
    },
  });
  assert.equal(parseTikTokPublicStats(booleans).views, 12);
  const negative = page({
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        itemInfo: { itemStruct: { stats: { ...FULL, collectCount: -1 }, statsV2: { collectCount: "-3" } } },
      },
    },
  });
  assert.equal(parseTikTokPublicStats(negative), null);
});

test("missing stats are named by the first break in the page", () => {
  assert.deepEqual(inspectTikTokHtml("<html><body>log in</body></html>"), {
    counts: null,
    reason: "no_rehydration",
  });
  assert.equal(
    inspectTikTokHtml('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{</script>').reason,
    "json_parse",
  );
  assert.deepEqual(
    inspectTikTokHtml(page({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: 10204 } },
    })),
    { counts: null, reason: "status_code", statusCode: 10204 },
  );
  assert.deepEqual(
    inspectTikTokHtml(page({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: "10221" } },
    })),
    { counts: null, reason: "status_code", statusCode: 10221 },
  );
  assert.equal(
    inspectTikTokHtml(page({
      __DEFAULT_SCOPE__: { "webapp.reflow.video.detail": { statusCode: 7 } },
    })).statusCode,
    7,
  );
  assert.equal(
    inspectTikTokHtml(page({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: "0" } },
    })).reason,
    "no_item",
  );
  const blockedDetail = page({
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": { statusCode: 0 },
      "webapp.reflow.video.detail": {
        statusCode: 9,
        itemInfo: { itemStruct: { stats: { ...FULL } } },
      },
    },
  });
  assert.equal(parseTikTokPublicStats(blockedDetail), null);
  assert.equal(inspectTikTokHtml(blockedDetail).reason, "no_item");
  assert.equal(
    inspectTikTokHtml(page({
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": {
          statusCode: 0,
          note: "please log in and verify this captcha",
        },
      },
    })).reason,
    "no_item",
  );
  assert.equal(
    inspectTikTokHtml(page({
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": {
          itemInfo: { itemStruct: { stats: { playCount: 1 } } },
        },
      },
    })).reason,
    "no_stats",
  );
});

test("a non-zero status code does not hide counts that are already on the page", () => {
  const html = page({
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        statusCode: 10204,
        itemInfo: { itemStruct: { stats: { ...FULL } } },
      },
    },
  });
  assert.equal(parseTikTokPublicStats(html).views, 345);
  assert.equal(inspectTikTokHtml(html).reason, null);
});

test("failure log keeps the short reason and drops secrets", () => {
  const hidden = refreshFailureLog({
    id: "job-0123456789abcdef",
    error: "stats_missing",
    logError: "no_rehydration",
    diag: {
      final_url: "https://user:pass@www.tiktok.com/@a/video/1?token=SECRETQUERY&x=1#frag",
      http_status: 200,
      html_bytes: 40,
      title: "sessionid=SECRETCOOKIE please verify",
      markers: ["verify", "made-up"],
      html: "<html>SECRETCOOKIE</html>",
      cookie: "sessionid=SECRETCOOKIE",
    },
  });
  assert.deepEqual(hidden, {
    id: "job-0123456789abcdef",
    error: "no_rehydration",
    http_status: 200,
    html_bytes: 40,
    markers: ["verify"],
  });
  assert.equal(JSON.stringify(hidden).includes("SECRET"), false);

  const login = refreshFailureLog({
    id: "job-0123456789abcdef",
    error: "stats_missing",
    logError: "status_code",
    diag: {
      status_code: "10204",
      final_url: "https://www.tiktok.com/login?token=SECRETQUERY",
      http_status: 200,
      html_bytes: 12,
      title: `  ${"A".repeat(120)}\n`,
    },
  });
  assert.equal(login.error, "status_code");
  assert.equal(login.status_code, 10204);
  assert.equal(login.final_url, "https://www.tiktok.com/login");
  assert.equal(login.markers.includes("login"), true);
  assert.equal(login.title.length, 80);
  assert.equal(JSON.stringify(login).includes("SECRETQUERY"), false);
  assert.equal(Object.hasOwn(login, "html"), false);
});
