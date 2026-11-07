import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { coerceCount, linkTarget, parseEmbedPage, parseVideoPage } from "../box-stats/lib/tiktok.mjs";
import { runRefresh, suspiciousDrops } from "../box-stats/lib/refresh.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(HERE, "fixtures/box-stats", name), "utf8");

const VIDEO_OK = fixture("video-ok.html");
const NOT_FOUND = fixture("video-not-found.html");
const CHALLENGE = fixture("challenge.html");
const LOGIN = fixture("login-wall.html");
const EMBED_OK = fixture("embed-ok.html");

const ACCOUNT = "businesspro6688";
const OK_ID = "7689049104483093778";
const EMBED_ID = "7705248488199572742";
const OK_LINK = `https://www.tiktok.com/@${ACCOUNT}/video/${OK_ID}`;
const EMBED_LINK = `https://www.tiktok.com/@${ACCOUNT}/video/${EMBED_ID}`;
const TOKEN = "admin-token-for-tests-0123456789";
const API = "https://worker.test";

function universal(itemStruct, extra = {}) {
  const scope = { "webapp.video-detail": { itemInfo: { itemStruct }, statusCode: 0, ...extra } };
  return `<html><head><title>TikTok - Make Your Day</title></head><body>` +
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">` +
    `${JSON.stringify({ __DEFAULT_SCOPE__: scope })}</script></body></html>`;
}

test("real page shape: counts come out as numbers, saves from a quoted string", () => {
  const result = parseVideoPage(VIDEO_OK, { videoId: OK_ID, handle: ACCOUNT, account: ACCOUNT });
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { views: 16000, likes: 2247, comments: 16, shares: 210, saves: 279 });
  assert.equal(result.videoId, OK_ID);
  assert.equal(result.author, ACCOUNT);
});

test("a missing count fails the page instead of becoming 0", () => {
  const html = universal({
    id: OK_ID,
    author: { uniqueId: ACCOUNT },
    stats: { playCount: 10, diggCount: 1, commentCount: 0, shareCount: 0 },
    statsV2: { playCount: "10", diggCount: "1", commentCount: "0", shareCount: "0", collectCount: "" },
  });
  const result = parseVideoPage(html, { videoId: OK_ID });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "layout_changed");
  assert.equal(result.detail, "no_stats");
  assert.equal(result.counts, undefined);
});

test("rounded or junk strings are not counts", () => {
  assert.equal(coerceCount("1.2K"), null);
  assert.equal(coerceCount("-3"), null);
  assert.equal(coerceCount(""), null);
  assert.equal(coerceCount(true), null);
  assert.equal(coerceCount(null), null);
  assert.equal(coerceCount("0"), 0);
  assert.equal(coerceCount(42), 42);
});

test("item doesn't exist (statusCode 10204) is video_not_found, not a generic miss", () => {
  const result = parseVideoPage(NOT_FOUND, { videoId: "7705248488199500001" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "video_not_found");
  assert.equal(result.status_code, 10204);
});

test("private and other status codes are named", () => {
  const priv = universal(null, { statusCode: 10222 });
  assert.equal(parseVideoPage(priv, { videoId: OK_ID }).reason, "video_private");
  const other = universal(null, { statusCode: 10101 });
  const result = parseVideoPage(other, { videoId: OK_ID });
  assert.equal(result.reason, "video_unavailable");
  assert.equal(result.status_code, 10101);
});

test("captcha / verify page is a challenge, with title and markers", () => {
  const result = parseVideoPage(CHALLENGE, { videoId: OK_ID });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "challenge");
  assert.equal(result.title, "Security Check");
  assert.ok(result.markers.includes("captcha"));
});

test("login page is login_wall", () => {
  const result = parseVideoPage(LOGIN, { videoId: OK_ID });
  assert.equal(result.reason, "login_wall");
});

test("page without any data script and no block words is layout_changed", () => {
  const result = parseVideoPage("<html><head><title>TikTok</title></head><body>hi</body></html>", {});
  assert.equal(result.reason, "layout_changed");
  assert.equal(result.detail, "no_data_script");
  const broken = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{</script>';
  assert.equal(parseVideoPage(broken, {}).detail, "json_parse");
});

test("bundle words like 'captcha' / 'Log in' do not turn a data page into a block", () => {
  assert.equal(parseVideoPage(VIDEO_OK, { videoId: OK_ID }).ok, true);
  const noItem = universal(null).replace("<title>", '<script src="/secsdk-captcha.js"></script><title>');
  const result = parseVideoPage(noItem, { videoId: OK_ID });
  assert.equal(result.reason, "layout_changed");
  assert.equal(result.detail, "no_item");
  assert.equal(result.markers, undefined);
});

test("a page for another video or another author is wrong_video and carries no counts", () => {
  const other = parseVideoPage(VIDEO_OK, { videoId: "7689049104483093779" });
  assert.equal(other.reason, "wrong_video");
  assert.equal(other.detail, "video_id_mismatch");
  assert.equal(other.counts, undefined);
  const author = parseVideoPage(VIDEO_OK, { videoId: OK_ID, account: "someoneelse" });
  assert.equal(author.reason, "wrong_video");
  assert.equal(author.detail, "author_mismatch");
});

test("numeric ids are rejected: they lose digits past 2^53", () => {
  const html = universal({
    id: 7689049104483093778,
    author: { uniqueId: ACCOUNT },
    stats: { playCount: 1, diggCount: 1, commentCount: 1, shareCount: 1, collectCount: 1 },
  });
  assert.equal(parseVideoPage(html, { videoId: OK_ID }).reason, "wrong_video");
});

test("legacy SIGI_STATE pages still parse", () => {
  const sigi = {
    ItemModule: {
      [OK_ID]: {
        id: OK_ID,
        author: ACCOUNT,
        stats: { playCount: 5, diggCount: 4, commentCount: 3, shareCount: 2, collectCount: 1 },
      },
    },
  };
  const html = `<script id="SIGI_STATE" type="application/json">${JSON.stringify(sigi)}</script>`;
  const result = parseVideoPage(html, { videoId: OK_ID, account: ACCOUNT });
  assert.deepEqual(result.counts, { views: 5, likes: 4, comments: 3, shares: 2, saves: 1 });
});

test("embed page gives four counts and leaves saves out", () => {
  const result = parseEmbedPage(EMBED_OK, { videoId: EMBED_ID, account: ACCOUNT });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.counts).sort(), ["comments", "likes", "shares", "views"]);
  assert.equal(result.counts.saves, undefined);
  assert.equal(parseEmbedPage(EMBED_OK, { videoId: OK_ID }).reason, "wrong_video");
  assert.equal(parseEmbedPage(CHALLENGE, { videoId: EMBED_ID }).reason, "challenge");
});

test("linkTarget keeps ids as strings and spots short links", () => {
  assert.deepEqual(
    { ...linkTarget(`${OK_LINK}?is_from_webapp=1`), url: undefined },
    { url: undefined, host: "www.tiktok.com", videoId: OK_ID, handle: ACCOUNT, short: false },
  );
  assert.equal(linkTarget("https://vm.tiktok.com/ZMabc123/").short, true);
  assert.equal(linkTarget("https://evil.example/video/123456789"), null);
  assert.equal(linkTarget("http://www.tiktok.com/@a/video/123456789"), null);
});

test("drop guard flags big falls only", () => {
  const opts = { maxDropRatio: 0.2, maxDropAbs: 10 };
  assert.deepEqual(suspiciousDrops({ views: 16000 }, { views: 15990 }, opts), []);
  assert.deepEqual(suspiciousDrops({ views: 5 }, { views: 0 }, opts), []);
  assert.deepEqual(suspiciousDrops({ views: 1000, likes: 50 }, { views: 0, likes: 49 }, opts), ["views"]);
});

// --- end to end with a fake TikTok and a fake Worker -------------------------

function fakeWorld({ pages, overlays, statsStatus = 200 }) {
  const posts = [];
  const requests = [];
  const store = structuredClone(overlays);
  const fetch = async (url, init = {}) => {
    requests.push({ url, headers: init.headers || {} });
    const parsed = new URL(url);
    if (parsed.origin === API) {
      if (parsed.pathname === "/v1/state") {
        const ids = parsed.searchParams.get("ids").split(",");
        const out = {};
        for (const id of ids) if (store[id]) out[id] = store[id];
        return Response.json({ overlays: out });
      }
      if (parsed.pathname === "/v1/stats") {
        const body = JSON.parse(init.body);
        posts.push({ body, token: init.headers["x-moo-token"] });
        if (statsStatus !== 200) return Response.json({ error: "unauthorized" }, { status: statsStatus });
        const { id, source, ...counts } = body;
        store[id].stats = { ...store[id].stats, ...counts, source };
        return Response.json({ ok: true });
      }
    }
    const page = pages[parsed.origin + parsed.pathname];
    if (!page) return new Response("missing", { status: 404 });
    if (typeof page === "function") return page();
    if (page.status && page.status !== 200) return new Response("", { status: page.status, headers: page.headers });
    return new Response(page.html ?? page, { status: 200, headers: { "content-type": "text/html" } });
  };
  const deps = { fetch, sleep: async () => {}, now: () => "2026-11-07T00:00:00Z", random: () => 0 };
  return { deps, posts, requests, store };
}

function overlay(link, stats = {}) {
  return {
    publish_link: link,
    published_at: "2026-10-01T00:00:00Z",
    stats: { views: null, likes: null, comments: null, shares: null, saves: null, updated_at: "", source: "", ...stats },
  };
}

const JOB_OK = "job-okokokokokok01";
const JOB_GONE = "job-gonegonegone02";
const JOB_BLOCK = "job-blockblockbl03";
const JOB_EMPTY = "job-nolinknolink04";

test("normal + missing + challenge: only verified counts are written, failures keep history", async () => {
  const goneLink = `https://www.tiktok.com/@${ACCOUNT}/video/7705248488199500001`;
  const world = fakeWorld({
    overlays: {
      [JOB_OK]: overlay(OK_LINK, { views: 15000, saves: 270 }),
      [JOB_GONE]: overlay(goneLink, { views: 99, likes: 9 }),
      [JOB_BLOCK]: overlay(EMBED_LINK, { views: 300, saves: 4 }),
      [JOB_EMPTY]: overlay(""),
    },
    pages: {
      [OK_LINK]: VIDEO_OK,
      [goneLink]: NOT_FOUND,
      [EMBED_LINK]: CHALLENGE,
      [`https://www.tiktok.com/embed/v2/${EMBED_ID}`]: EMBED_OK,
    },
  });
  const summary = await runRefresh(
    { apiBase: API, token: TOKEN, jobIds: [JOB_OK, JOB_GONE, JOB_BLOCK, JOB_EMPTY], account: ACCOUNT },
    world.deps,
  );
  assert.equal(summary.targets, 3);
  assert.equal(summary.ok, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped_no_link, 1);
  assert.deepEqual(summary.reasons, { video_not_found: 1 });

  assert.deepEqual(world.posts.map((post) => post.body.id), [JOB_OK, JOB_BLOCK]);
  assert.ok(world.posts.every((post) => post.token === TOKEN));
  const okPost = world.posts[0].body;
  assert.deepEqual(okPost, { id: JOB_OK, views: 16000, likes: 2247, comments: 16, shares: 210, saves: 279, source: "box-tiktok-public" });

  const embedPost = world.posts[1].body;
  assert.equal(embedPost.source, "box-tiktok-embed");
  assert.equal("saves" in embedPost, false);
  assert.equal(world.store[JOB_BLOCK].stats.saves, 4);

  assert.deepEqual(world.store[JOB_GONE].stats.views, 99);
  const gone = summary.results.find((entry) => entry.id === JOB_GONE);
  assert.equal(gone.status_code, 10204);
  const blocked = summary.results.find((entry) => entry.id === JOB_BLOCK);
  assert.equal(blocked.fallback_from, "challenge");

  const text = JSON.stringify(summary);
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes("<html"));
  assert.ok(!world.requests.some((req) => !String(req.url).startsWith(API) && req.headers["x-moo-token"]));
});

test("challenge on both pages fails with both reasons and writes nothing", async () => {
  const world = fakeWorld({
    overlays: { [JOB_BLOCK]: overlay(EMBED_LINK, { views: 300 }) },
    pages: { [EMBED_LINK]: CHALLENGE, [`https://www.tiktok.com/embed/v2/${EMBED_ID}`]: { status: 400 } },
  });
  const summary = await runRefresh({ apiBase: API, token: TOKEN, jobIds: [JOB_BLOCK] }, world.deps);
  assert.equal(world.posts.length, 0);
  const entry = summary.results[0];
  assert.equal(entry.reason, "challenge");
  assert.deepEqual(entry.tried, ["video:challenge", "embed:http_400"]);
  assert.equal(world.store[JOB_BLOCK].stats.views, 300);
});

test("wrong video is not written and does not fall back", async () => {
  const otherLink = `https://www.tiktok.com/@${ACCOUNT}/video/7689049104483093779`;
  const world = fakeWorld({
    overlays: { [JOB_OK]: overlay(otherLink) },
    pages: { [otherLink]: VIDEO_OK },
  });
  const summary = await runRefresh({ apiBase: API, token: TOKEN, jobIds: [JOB_OK] }, world.deps);
  assert.equal(summary.results[0].reason, "wrong_video");
  assert.equal(world.posts.length, 0);
  assert.ok(!world.requests.some((req) => String(req.url).includes("/embed/")));
});

test("transient errors are retried, then succeed", async () => {
  let calls = 0;
  const world = fakeWorld({
    overlays: { [JOB_OK]: overlay(OK_LINK) },
    pages: {
      [OK_LINK]: () => {
        calls += 1;
        return calls === 1 ? new Response("", { status: 503 }) : new Response(VIDEO_OK, { status: 200 });
      },
    },
  });
  const summary = await runRefresh({ apiBase: API, token: TOKEN, jobIds: [JOB_OK] }, world.deps);
  assert.equal(summary.ok, 1);
  assert.equal(calls, 2);
});

test("redirects off tiktok.com are refused", async () => {
  const world = fakeWorld({
    overlays: { [JOB_OK]: overlay(OK_LINK) },
    pages: { [OK_LINK]: { status: 302, headers: { location: "https://evil.example/x" } } },
  });
  const summary = await runRefresh(
    { apiBase: API, token: TOKEN, jobIds: [JOB_OK], embedFallback: false },
    world.deps,
  );
  assert.equal(summary.results[0].reason, "redirect_off_tiktok");
  assert.ok(!world.requests.some((req) => String(req.url).includes("evil.example")));
});

test("short link is followed and the final video id is checked", async () => {
  const short = "https://vm.tiktok.com/ZMshort01/";
  const world = fakeWorld({
    overlays: { [JOB_OK]: overlay(short) },
    pages: {
      [short]: { status: 301, headers: { location: `${OK_LINK}?_r=1` } },
      [OK_LINK]: VIDEO_OK,
    },
  });
  const summary = await runRefresh({ apiBase: API, token: TOKEN, jobIds: [JOB_OK], account: ACCOUNT }, world.deps);
  assert.equal(summary.ok, 1);
  assert.equal(world.posts[0].body.views, 16000);
});

test("a big drop is held back instead of overwriting history", async () => {
  const world = fakeWorld({
    overlays: { [JOB_OK]: overlay(OK_LINK, { views: 90000 }) },
    pages: { [OK_LINK]: VIDEO_OK },
  });
  const summary = await runRefresh({ apiBase: API, token: TOKEN, jobIds: [JOB_OK] }, world.deps);
  assert.equal(summary.results[0].reason, "suspicious_drop");
  assert.deepEqual(summary.results[0].fields, ["views"]);
  assert.equal(world.posts.length, 0);
  assert.equal(world.store[JOB_OK].stats.views, 90000);
});

test("rejected token is reported as write_unauthorized", async () => {
  const world = fakeWorld({
    overlays: { [JOB_OK]: overlay(OK_LINK) },
    pages: { [OK_LINK]: VIDEO_OK },
    statsStatus: 401,
  });
  const summary = await runRefresh({ apiBase: API, token: TOKEN, jobIds: [JOB_OK] }, world.deps);
  assert.equal(summary.results[0].reason, "write_unauthorized");
  assert.equal(summary.results[0].http_status, 401);
  assert.ok(!JSON.stringify(summary).includes(TOKEN));
});

test("dry run reads but never posts", async () => {
  const world = fakeWorld({ overlays: { [JOB_OK]: overlay(OK_LINK) }, pages: { [OK_LINK]: VIDEO_OK } });
  const summary = await runRefresh({ apiBase: API, token: "", jobIds: [JOB_OK], dryRun: true }, world.deps);
  assert.equal(summary.ok, 1);
  assert.equal(summary.results[0].written, false);
  assert.equal(world.posts.length, 0);
});

test("link changed between read and write is not written", async () => {
  let reads = 0;
  const world = fakeWorld({ overlays: { [JOB_OK]: overlay(OK_LINK) }, pages: { [OK_LINK]: VIDEO_OK } });
  const base = world.deps.fetch;
  world.deps.fetch = async (url, init) => {
    if (String(url).startsWith(`${API}/v1/state`)) {
      reads += 1;
      if (reads === 2) return Response.json({ overlays: { [JOB_OK]: overlay(EMBED_LINK) } });
    }
    return base(url, init);
  };
  const summary = await runRefresh({ apiBase: API, token: TOKEN, jobIds: [JOB_OK] }, world.deps);
  assert.equal(summary.results[0].reason, "link_changed");
  assert.equal(world.posts.length, 0);
});
