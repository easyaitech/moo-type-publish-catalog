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

async function readJson(request, { allowEmpty = false } = {}) {
  if (!request.body) return allowEmpty ? { value: {} } : { error: "bad_json" };
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
  if (!text.trim()) return allowEmpty ? { value: {} } : { error: "bad_json" };
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

const REHYDRATION_ID = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
const DETAIL_KEYS = ["webapp.video-detail", "webapp.reflow.video.detail"];
const COUNT_FIELDS = [
  ["playCount", "views"],
  ["diggCount", "likes"],
  ["commentCount", "comments"],
  ["shareCount", "shares"],
  ["collectCount", "saves"],
];
const TIKTOK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2_000_000;
const REFRESH_CONCURRENCY = 3;
const SCRIPT_RE = new RegExp(
  `<script\\b[^>]*\\bid=["']${REHYDRATION_ID}["'][^>]*>([\\s\\S]*?)<\\/script>`,
  "i",
);
const SAFE_ERRORS = new Set([
  "timeout",
  "stats_missing",
  "html_too_large",
  "too_many_redirects",
  "bad_redirect",
  "invalid_url",
  "fetch_failed",
  "not_found",
  "no_publish_link",
  "link_changed",
  "invalid_id",
]);

function briefError(err) {
  const message = err && typeof err.message === "string" ? err.message : "";
  if (SAFE_ERRORS.has(message) || /^http_\d{3}$/.test(message)) return message;
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) return "timeout";
  return "fetch_failed";
}

function coerceCount(value) {
  if (typeof value === "boolean" || value == null) return null;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return null;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 0 || number > 1e15) return null;
  return number;
}

function countsFromItem(item) {
  if (!item || typeof item !== "object") return null;
  const sources = [item.stats, item.statsV2].filter((source) => source && typeof source === "object");
  if (!sources.length) return null;
  const counts = {};
  for (const [from, to] of COUNT_FIELDS) {
    let picked = null;
    for (const source of sources) {
      if (source[from] === undefined) continue;
      const coerced = coerceCount(source[from]);
      if (coerced === null) continue;
      picked = coerced;
      break;
    }
    if (picked === null) return null;
    counts[to] = picked;
  }
  return counts;
}

function resolveItemStruct(data) {
  const scope = data && typeof data === "object" ? data.__DEFAULT_SCOPE__ : null;
  if (scope && typeof scope === "object") {
    for (const key of DETAIL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(scope, key)) continue;
      const item = scope[key] && scope[key].itemInfo && scope[key].itemInfo.itemStruct;
      return item && typeof item === "object" ? item : null;
    }
  }
  return findFirstItemStruct(data);
}

function findFirstItemStruct(root) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    seen += 1;
    if (seen > 100000) return null;
    const itemInfo = node.itemInfo;
    if (itemInfo && typeof itemInfo === "object" && itemInfo.itemStruct && typeof itemInfo.itemStruct === "object") {
      return itemInfo.itemStruct;
    }
    const values = Array.isArray(node) ? node : Object.values(node);
    for (let i = values.length - 1; i >= 0; i -= 1) {
      if (values[i] && typeof values[i] === "object") stack.push(values[i]);
    }
  }
  return null;
}

export function parseTikTokPublicStats(html) {
  if (typeof html !== "string" || !html) return null;
  const match = html.match(SCRIPT_RE);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  const item = resolveItemStruct(data);
  if (!item) return null;
  return countsFromItem(item);
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Already closed.
  }
}

async function readHtmlSnippet(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) throw new Error("html_too_large");
      html += decoder.decode(value, { stream: true });
      const idAt = html.indexOf(REHYDRATION_ID);
      if (idAt !== -1 && html.indexOf("</script>", idAt) !== -1) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed.
    }
  }
  html += decoder.decode();
  return html;
}

async function fetchTikTokHtml(startUrl) {
  if (!isTikTokUrl(startUrl)) throw new Error("invalid_url");
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isTikTokUrl(current)) throw new Error("invalid_url");
    let response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal,
        cache: "no-store",
        headers: {
          "user-agent": TIKTOK_UA,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
        },
      });
    } catch (err) {
      if (err && (err.name === "TimeoutError" || err.name === "AbortError")) throw new Error("timeout");
      throw new Error("fetch_failed");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await cancelBody(response);
      if (!location) throw new Error("bad_redirect");
      if (hop === MAX_REDIRECTS) throw new Error("too_many_redirects");
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) {
      const status = response.status;
      await cancelBody(response);
      if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("fetch_failed");
      throw new Error(`http_${status}`);
    }
    return readHtmlSnippet(response);
  }
  throw new Error("too_many_redirects");
}

async function listOverlayIds(env) {
  const ids = [];
  let cursor;
  for (;;) {
    const page = await env.MOO_STATE.list(
      cursor ? { prefix: "overlay:", cursor } : { prefix: "overlay:" },
    );
    for (const key of page.keys) {
      const id = key.name.slice("overlay:".length);
      if (validId(id)) ids.push(id);
    }
    if (page.list_complete || !page.cursor || page.cursor === cursor) break;
    cursor = page.cursor;
  }
  return ids;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

async function refreshOne(env, id, explicit) {
  try {
    if (!validId(id)) return { id, status: "failed", error: "invalid_id" };
    const overlay = await readOverlay(env, id);
    if (!overlay) return explicit ? { id, status: "failed", error: "not_found" } : { id, status: "skipped" };
    const publishLink = String(overlay.publish_link || "").trim();
    if (!publishLink) {
      return explicit ? { id, status: "failed", error: "no_publish_link" } : { id, status: "skipped" };
    }
    if (!isTikTokUrl(publishLink)) return { id, status: "failed", error: "invalid_url" };
    let counts;
    try {
      counts = parseTikTokPublicStats(await fetchTikTokHtml(publishLink));
    } catch (err) {
      return { id, status: "failed", error: briefError(err) };
    }
    if (!counts) return { id, status: "failed", error: "stats_missing" };
    const latest = await readOverlay(env, id);
    if (!latest || String(latest.publish_link || "").trim() !== publishLink) {
      return { id, status: "failed", error: "link_changed" };
    }
    const stamp = nowIso();
    const stats = {
      ...emptyStats(),
      ...(latest.stats || {}),
      ...counts,
      updated_at: stamp,
      source: "tiktok-public",
    };
    await writeOverlay(env, id, {
      publish_link: latest.publish_link,
      published_at: latest.published_at || "",
      stats,
      updated_at: stamp,
    });
    return { id, status: "refreshed" };
  } catch (err) {
    return { id, status: "failed", error: briefError(err) };
  }
}

async function refreshPublicStats(env, options = {}) {
  const onlyId = options.id;
  const ids = onlyId ? [onlyId] : await listOverlayIds(env);
  const outcomes = await mapLimit(ids, REFRESH_CONCURRENCY, (id) => refreshOne(env, id, Boolean(onlyId)));
  const refreshed = [];
  const failed = [];
  for (const outcome of outcomes) {
    if (!outcome || outcome.status === "skipped") continue;
    if (outcome.status === "refreshed") refreshed.push(outcome.id);
    else failed.push({ id: outcome.id, error: outcome.error || "fetch_failed" });
  }
  const result = { ok: failed.length === 0, refreshed, failed };
  console.log(JSON.stringify({
    event: "refresh_stats",
    cron: options.cron || "",
    ok: result.ok,
    refreshed: result.refreshed,
    failed: result.failed,
  }));
  return result;
}

async function postRefreshStats(request, env) {
  if (!tokenReady(env.ADMIN_TOKEN)) return json({ error: "stats_disabled" }, 503);
  const who = actor(request, env);
  if (who !== "admin") return json({ error: who ? "forbidden" : "unauthorized" }, who ? 403 : 401);
  const body = await readJson(request, { allowEmpty: true });
  if (body.error) return json({ error: body.error }, 400);
  if (body.value.id !== undefined) {
    if (!validId(body.value.id)) return json({ error: "invalid_id" }, 400);
    return json(await refreshPublicStats(env, { id: body.value.id }));
  }
  return json(await refreshPublicStats(env, {}));
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
    if (path === "/v1/refresh-stats" && request.method === "POST") return postRefreshStats(request, env);
    return json({ error: "not_found" }, 404);
  },
  async scheduled(controller, env) {
    if (!env || !env.MOO_STATE) {
      console.log(JSON.stringify({ event: "refresh_stats", ok: false, error: "kv_missing" }));
      return;
    }
    await refreshPublicStats(env, { cron: controller && controller.cron ? controller.cron : "" });
  },
};
