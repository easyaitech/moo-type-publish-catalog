import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseTikTokPublicStats } from "../src/index.js";

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
