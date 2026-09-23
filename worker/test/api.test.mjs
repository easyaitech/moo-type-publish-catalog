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

function workerOptions(dir, bindings) {
  return {
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["MOO_STATE"],
    kvPersist: dir,
    bindings,
  };
}

async function withWorker(bindings, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moo-kv-"));
  const mf = new Miniflare(workerOptions(dir, bindings));
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
