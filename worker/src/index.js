/**
 * Write-back API for the MOO TYPE publish board.
 * Content stays in catalog.json on GitHub Pages. This Worker stores only
 * the friend's publish URL and assistant metrics, one KV key per job id.
 */

const STAT_KEYS = ["views", "likes", "comments", "shares", "saves"];
const MAX_BODY = 8000;
const MIN_TOKEN = 12;

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-moo-token",
      "cache-control": "no-store",
    },
  });
}

function emptyCors() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-moo-token",
      "access-control-max-age": "86400",
    },
  });
}

function emptyStats() {
  return {
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    updated_at: "",
    source: "",
  };
}

function tokenOk(expected, got) {
  if (typeof expected !== "string" || typeof got !== "string") return false;
  if (expected.length < MIN_TOKEN || got.length !== expected.length) return false;
  const left = new TextEncoder().encode(expected);
  const right = new TextEncoder().encode(got);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function actor(request, env) {
  const got = request.headers.get("x-moo-token") || "";
  if (tokenOk(env.ADMIN_TOKEN, got)) return "admin";
  if (tokenOk(env.FRIEND_TOKEN, got)) return "friend";
  return "";
}

function validId(id) {
  return typeof id === "string" && /^job-[a-zA-Z0-9]{8,64}$/.test(id);
}

function isTikTokUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return false;
    return url.pathname.length > 1;
  } catch {
    return false;
  }
}

async function readJson(request) {
  if (!request.body) return { error: "bad_json" };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel();
      return { error: "too_large" };
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  if (!text) return { error: "bad_json" };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "bad_json" };
    return { value };
  } catch {
    return { error: "bad_json" };
  }
}

function overlayKey(id) {
  return `overlay:${id}`;
}

async function readOverlay(env, id) {
  const raw = await env.MOO_STATE.get(overlayKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeOverlay(env, id, overlay) {
  await env.MOO_STATE.put(overlayKey(id), JSON.stringify(overlay));
}

function tokenReady(value) {
  return typeof value === "string" && value.length >= MIN_TOKEN;
}

function writeReady(env) {
  return tokenReady(env.FRIEND_TOKEN);
}

async function getState(url, env) {
  const ids = (url.searchParams.get("ids") || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (ids.length > 200) return json({ error: "too_many_ids" }, 400);
  if (ids.some((id) => !validId(id))) return json({ error: "invalid_id" }, 400);
  const pairs = await Promise.all(
    ids.map(async (id) => {
      const overlay = await readOverlay(env, id);
      return [id, overlay];
    }),
  );
  const overlays = {};
  for (const [id, overlay] of pairs) {
    if (overlay) overlays[id] = overlay;
  }
  return json({ overlays });
}

async function postPublish(request, env) {
  const who = actor(request, env);
  if (!who) return json({ error: "unauthorized" }, 401);
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, 400);
  const id = body.value.id;
  const publishLink = String(body.value.publish_link || "").trim();
  if (!validId(id)) return json({ error: "invalid_id" }, 400);
  if (!isTikTokUrl(publishLink)) return json({ error: "invalid_publish_link" }, 400);
  const existing = (await readOverlay(env, id)) || { stats: emptyStats() };
  const stamp = nowIso();
  const overlay = {
    publish_link: publishLink,
    published_at: stamp,
    stats: existing.stats || emptyStats(),
    updated_at: stamp,
  };
  await writeOverlay(env, id, overlay);
  console.log(JSON.stringify({ event: "publish", id, ok: true }));
  return json({ ok: true, overlay });
}

function parseStat(value) {
  if (typeof value === "boolean") return { error: true };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 1e15) return { error: true };
  return { value: number };
}

async function postStats(request, env) {
  if (!tokenReady(env.ADMIN_TOKEN)) return json({ error: "stats_disabled" }, 503);
  const who = actor(request, env);
  if (who !== "admin") return json({ error: who ? "forbidden" : "unauthorized" }, who ? 403 : 401);
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, 400);
  const id = body.value.id;
  if (!validId(id)) return json({ error: "invalid_id" }, 400);
  const provided = STAT_KEYS.filter((key) => body.value[key] !== undefined && body.value[key] !== null);
  if (!provided.length) return json({ error: "no_stats" }, 400);
  const parsed = {};
  for (const key of provided) {
    const stat = parseStat(body.value[key]);
    if (stat.error) return json({ error: "invalid_stat", field: key }, 400);
    parsed[key] = stat.value;
  }
  const source = String(body.value.source || "manual").slice(0, 40);
  const existing = (await readOverlay(env, id)) || {
    publish_link: "",
    published_at: "",
    stats: emptyStats(),
  };
  const stats = { ...emptyStats(), ...(existing.stats || {}), ...parsed };
  const stamp = nowIso();
  stats.updated_at = stamp;
  stats.source = source;
  const overlay = {
    publish_link: existing.publish_link || "",
    published_at: existing.published_at || "",
    stats,
    updated_at: stamp,
  };
  await writeOverlay(env, id, overlay);
  console.log(JSON.stringify({ event: "stats", id, ok: true }));
  return json({ ok: true, overlay });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (request.method === "OPTIONS") return emptyCors();
    if (path === "/v1/health" && request.method === "GET") {
      return json({ ok: true, write: writeReady(env), stats: tokenReady(env.ADMIN_TOKEN) });
    }
    if (!env.MOO_STATE) return json({ error: "kv_missing" }, 500);
    if (path === "/v1/state" && request.method === "GET") return getState(url, env);
    if (!writeReady(env)) return json({ error: "write_disabled" }, 503);
    if (path === "/v1/publish" && request.method === "POST") return postPublish(request, env);
    if (path === "/v1/stats" && request.method === "POST") return postStats(request, env);
    return json({ error: "not_found" }, 404);
  },
};
