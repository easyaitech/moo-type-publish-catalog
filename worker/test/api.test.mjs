import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "../src/index.js");
const FRIEND = "friend-token-ok";
const ADMIN = "admin-token-okkk";
const JOB = "job-fb280b25dd784502b4e4d6ec790fc9a9";
const LINK = "https://www.tiktok.com/@mootype/video/1234567890";

function workerOptions(dir, bindings, extra = {}) {
  return {
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["MOO_STATE"],
    kvPersist: dir,
    bindings,
    ...extra,
  };
}

async function withWorker(bindings, fn, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moo-kv-"));
  const mf = new Miniflare(workerOptions(dir, bindings, extra));
  try {
    return await fn(mf, dir);
  } finally {
    await mf.dispose();
  }
}

async function readJson(response) {
  return { status: response.status, body: await response.json(), cors: response.headers.get("access-control-allow-origin") };
}

test("health, publish, reload, and stats stay on the job id", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moo-kv-"));
  const bindings = { FRIEND_TOKEN: FRIEND, ADMIN_TOKEN: ADMIN };
  const first = new Miniflare(workerOptions(dir, bindings));
  try {
    const health = await readJson(await first.dispatchFetch("http://example.com/v1/health"));
    assert.equal(health.status, 200);
    assert.equal(health.body.write, true);
    assert.equal(health.body.stats, true);
    assert.equal(health.cors, "*");

    const denied = await readJson(
      await first.dispatchFetch("http://example.com/v1/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: JOB, publish_link: LINK }),
      }),
    );
    assert.equal(denied.status, 401);

    const bad = await readJson(
      await first.dispatchFetch("http://example.com/v1/publish", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": FRIEND },
        body: JSON.stringify({ id: JOB, publish_link: "https://example.com/not-tiktok" }),
      }),
    );
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "invalid_publish_link");

    const published = await readJson(
      await first.dispatchFetch("http://example.com/v1/publish", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": FRIEND },
        body: JSON.stringify({ id: JOB, publish_link: LINK }),
      }),
    );
    assert.equal(published.status, 200);
    assert.equal(published.body.overlay.publish_link, LINK);

    const forbidden = await readJson(
      await first.dispatchFetch("http://example.com/v1/stats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": FRIEND },
        body: JSON.stringify({ id: JOB, views: 10 }),
      }),
    );
    assert.equal(forbidden.status, 403);

    const stats = await readJson(
      await first.dispatchFetch("http://example.com/v1/stats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": ADMIN },
        body: JSON.stringify({ id: JOB, views: 1200, likes: 30, comments: 0, shares: 2, saves: 4, source: "manual" }),
      }),
    );
    assert.equal(stats.status, 200);
    assert.equal(stats.body.overlay.publish_link, LINK);
    assert.equal(stats.body.overlay.stats.views, 1200);
    assert.equal(stats.body.overlay.stats.saves, 4);
  } finally {
    await first.dispose();
  }

  const second = new Miniflare(workerOptions(dir, bindings));
  try {
    const state = await readJson(
      await second.dispatchFetch(`http://example.com/v1/state?ids=${JOB}`),
    );
    assert.equal(state.status, 200);
    assert.equal(state.body.overlays[JOB].publish_link, LINK);
    assert.equal(state.body.overlays[JOB].stats.views, 1200);
    assert.equal(state.body.overlays[JOB].stats.likes, 30);
  } finally {
    await second.dispose();
  }
});

const FIXTURE = fs.readFileSync(path.join(HERE, "fixtures/tiktok-rehydration.html"), "utf8");
const JOB_OK = "job-aaaaaaaaaaaaaaaa";
const JOB_FAIL = "job-bbbbbbbbbbbbbbbb";
const JOB_WALL = "job-cccccccccccccccc";
const JOB_EMPTY = "job-dddddddddddddddd";
const JOB_EVIL = "job-eeeeeeeeeeeeeeee";

function tiktokOutbound(seen) {
  return async (request) => {
    const url = new URL(request.url);
    seen.push({ href: url.href, ua: request.headers.get("user-agent") || "" });
    if (url.hostname === "vt.tiktok.com" && url.pathname.includes("ZSbJ5ndpA")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://www.tiktok.com/@mootype/video/111222333" },
      });
    }
    if (url.hostname === "vt.tiktok.com" && url.pathname.includes("EvilRedirect")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.com/phish" },
      });
    }
    if (url.hostname === "www.tiktok.com" && url.pathname.endsWith("/111222333")) {
      return new Response(FIXTURE, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.hostname === "www.tiktok.com" && url.pathname.endsWith("/404404404")) {
      return new Response("<html><body>log in</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.hostname === "www.tiktok.com" && url.pathname.endsWith("/999000111")) {
      return new Response("no", { status: 500 });
    }
    return new Response("blocked", { status: 599 });
  };
}

async function publish(mf, id, link) {
  return readJson(
    await mf.dispatchFetch("http://example.com/v1/publish", {
      method: "POST",
      headers: { "content-type": "application/json", "x-moo-token": FRIEND },
      body: JSON.stringify({ id, publish_link: link }),
    }),
  );
}

test("refresh-stats and the cron scrape public pages without wiping failures", async () => {
  const seen = [];
  await withWorker({ FRIEND_TOKEN: FRIEND, ADMIN_TOKEN: ADMIN }, async (mf) => {
    const published = await publish(mf, JOB_OK, "https://vt.tiktok.com/ZSbJ5ndpA/");
    assert.equal(published.status, 200);
    const publishedAt = published.body.overlay.published_at;
    assert.equal((await publish(mf, JOB_FAIL, "https://www.tiktok.com/@mootype/video/999000111")).status, 200);
    assert.equal((await publish(mf, JOB_WALL, "https://www.tiktok.com/@mootype/video/404404404")).status, 200);
    assert.equal((await publish(mf, JOB_EVIL, "https://vt.tiktok.com/EvilRedirect/")).status, 200);

    const kv = await mf.getBindings();
    await kv.MOO_STATE.put(
      `overlay:${JOB_EMPTY}`,
      JSON.stringify({
        publish_link: "",
        published_at: "",
        stats: { views: null, likes: null, comments: null, shares: null, saves: null, updated_at: "", source: "" },
        updated_at: "",
      }),
    );

    async function setViews(id, views) {
      const response = await readJson(
        await mf.dispatchFetch("http://example.com/v1/stats", {
          method: "POST",
          headers: { "content-type": "application/json", "x-moo-token": ADMIN },
          body: JSON.stringify({ id, views, source: "manual" }),
        }),
      );
      assert.equal(response.status, 200);
    }
    await setViews(JOB_FAIL, 77);
    await setViews(JOB_WALL, 8);
    await setViews(JOB_EVIL, 3);

    const denied = await readJson(
      await mf.dispatchFetch("http://example.com/v1/refresh-stats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": FRIEND },
        body: "{}",
      }),
    );
    assert.equal(denied.status, 403);
    const anonymous = await readJson(
      await mf.dispatchFetch("http://example.com/v1/refresh-stats", { method: "POST", body: "{}" }),
    );
    assert.equal(anonymous.status, 401);

    const refreshed = await readJson(
      await mf.dispatchFetch("http://example.com/v1/refresh-stats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": ADMIN },
        body: "{}",
      }),
    );
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.ok, false);
    assert.deepEqual(refreshed.body.refreshed, [JOB_OK]);
    assert.deepEqual(refreshed.body.failed, [
      { id: JOB_FAIL, error: "http_500" },
      { id: JOB_WALL, error: "stats_missing" },
      { id: JOB_EVIL, error: "invalid_url" },
    ]);
    assert.equal(JSON.stringify(refreshed.body).includes(ADMIN), false);
    assert.ok(seen.some((hit) => hit.href.includes("vt.tiktok.com/ZSbJ5ndpA")));
    assert.ok(seen.some((hit) => hit.href.includes("/video/111222333") && hit.ua.includes("Chrome")));
    assert.equal(seen.some((hit) => hit.href.includes("example.com")), false);

    const state = await readJson(
      await mf.dispatchFetch(
        `http://example.com/v1/state?ids=${JOB_OK},${JOB_FAIL},${JOB_WALL},${JOB_EMPTY},${JOB_EVIL}`,
      ),
    );
    const ok = state.body.overlays[JOB_OK];
    assert.equal(ok.publish_link, "https://vt.tiktok.com/ZSbJ5ndpA/");
    assert.equal(ok.published_at, publishedAt);
    assert.equal(ok.stats.views, 345);
    assert.equal(ok.stats.likes, 9);
    assert.equal(ok.stats.comments, 0);
    assert.equal(ok.stats.shares, 1);
    assert.equal(ok.stats.saves, 0);
    assert.equal(ok.stats.source, "tiktok-public");
    assert.ok(ok.stats.updated_at.endsWith("Z"));
    assert.equal(state.body.overlays[JOB_FAIL].stats.views, 77);
    assert.equal(state.body.overlays[JOB_FAIL].stats.source, "manual");
    assert.equal(state.body.overlays[JOB_WALL].stats.views, 8);
    assert.equal(state.body.overlays[JOB_EVIL].stats.views, 3);
    assert.equal(state.body.overlays[JOB_EMPTY].stats.views, null);

    await setViews(JOB_OK, 1);
    const one = await readJson(
      await mf.dispatchFetch("http://example.com/v1/refresh-stats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": ADMIN },
        body: JSON.stringify({ id: JOB_OK }),
      }),
    );
    assert.equal(one.body.ok, true);
    assert.deepEqual(one.body.refreshed, [JOB_OK]);
    assert.deepEqual(one.body.failed, []);
    const afterOne = await readJson(await mf.dispatchFetch(`http://example.com/v1/state?ids=${JOB_OK},${JOB_FAIL}`));
    assert.equal(afterOne.body.overlays[JOB_OK].stats.views, 345);
    assert.equal(afterOne.body.overlays[JOB_OK].stats.source, "tiktok-public");
    assert.equal(afterOne.body.overlays[JOB_FAIL].stats.views, 77);

    await setViews(JOB_OK, 2);
    const cron = await mf.dispatchFetch("http://example.com/cdn-cgi/handler/scheduled?cron=0+*/3+*+*+*");
    assert.equal(cron.status, 200);
    const afterCron = await readJson(await mf.dispatchFetch(`http://example.com/v1/state?ids=${JOB_OK}`));
    assert.equal(afterCron.body.overlays[JOB_OK].stats.views, 345);
    assert.equal(afterCron.body.overlays[JOB_OK].stats.source, "tiktok-public");
    assert.equal(afterCron.body.overlays[JOB_OK].published_at, publishedAt);

    const missing = await readJson(
      await mf.dispatchFetch("http://example.com/v1/refresh-stats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": ADMIN },
        body: JSON.stringify({ id: "job-0123456789abcdef" }),
      }),
    );
    assert.equal(missing.body.ok, false);
    assert.deepEqual(missing.body.failed, [{ id: "job-0123456789abcdef", error: "not_found" }]);
    const badId = await readJson(
      await mf.dispatchFetch("http://example.com/v1/refresh-stats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": ADMIN },
        body: JSON.stringify({ id: "nope" }),
      }),
    );
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error, "invalid_id");
  }, { outboundService: tiktokOutbound(seen), unsafeTriggerHandlers: true });
});

test("short tokens disable writes", async () => {
  await withWorker({ FRIEND_TOKEN: "short", ADMIN_TOKEN: "also-short" }, async (mf) => {
    const health = await readJson(await mf.dispatchFetch("http://example.com/v1/health"));
    assert.equal(health.body.write, false);
    assert.equal(health.body.stats, false);
    const publish = await readJson(
      await mf.dispatchFetch("http://example.com/v1/publish", {
        method: "POST",
        headers: { "content-type": "application/json", "x-moo-token": "short" },
        body: JSON.stringify({ id: JOB, publish_link: LINK }),
      }),
    );
    assert.equal(publish.status, 503);
  });
});
