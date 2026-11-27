/**
 * Fetch public TikTok counts on this machine and write them to the Worker.
 * Everything that touches the network goes through `deps` so tests can replace it.
 */

import { DEFINITIVE_REASONS, STAT_KEYS, embedUrl, linkTarget, parseEmbedPage, parseVideoPage } from "./tiktok.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 3_000_000;
const RETRYABLE = /^(timeout|network_error|http_429|http_5\d\d|empty_page)$/;
const SOURCE_PAGE = "box-tiktok-public";
const SOURCE_EMBED = "box-tiktok-embed";

export const DEFAULTS = {
  timeoutMs: 15000,
  retries: 2,
  retryDelayMs: 4000,
  delayMs: 1500,
  jitterMs: 1000,
  maxDropRatio: 0.2,
  maxDropAbs: 10,
  embedFallback: true,
};

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.username || url.password) return undefined;
    return `${url.origin}${url.pathname}`.slice(0, 200);
  } catch {
    return undefined;
  }
}

function tiktokHost(url) {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (host === "tiktok.com" || host.endsWith(".tiktok.com"));
}

class FetchError extends Error {
  constructor(reason, diag = {}) {
    super(reason);
    this.reason = reason;
    this.diag = diag;
  }
}

async function readCapped(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) throw new FetchError("html_too_large", { html_bytes: total });
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Stream already closed.
    }
  }
  return html + decoder.decode();
}

/** GET a TikTok page, following redirects only while they stay on tiktok.com. */
export async function fetchPage(startUrl, deps, options) {
  let current = startUrl;
  const signal = AbortSignal.timeout(options.timeoutMs);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let url;
    try {
      url = new URL(current);
    } catch {
      throw new FetchError("bad_redirect");
    }
    if (!tiktokHost(url)) throw new FetchError("redirect_off_tiktok", { final_url: safeUrl(current) });
    let response;
    try {
      response = await deps.fetch(url.href, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });
    } catch (err) {
      const timeout = err && (err.name === "TimeoutError" || err.name === "AbortError");
      const diag = { final_url: safeUrl(current) };
      const code = err && err.cause && typeof err.cause.code === "string" ? err.cause.code : "";
      if (/^[A-Z_]{3,40}$/.test(code)) diag.net_code = code;
      throw new FetchError(timeout ? "timeout" : "network_error", diag);
    }
    const where = { final_url: safeUrl(url.href), http_status: response.status };
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      try {
        await response.body?.cancel();
      } catch {
        // Nothing to drain.
      }
      if (!location) throw new FetchError("bad_redirect", where);
      current = new URL(location, url.href).href;
      continue;
    }
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Nothing to drain.
      }
      throw new FetchError(`http_${response.status}`, where);
    }
    let html;
    try {
      html = await readCapped(response);
    } catch (err) {
      if (err instanceof FetchError) throw new FetchError(err.reason, { ...where, ...err.diag });
      const timeout = err && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new FetchError(timeout ? "timeout" : "network_error", where);
    }
    return { html, finalUrl: url.href, diag: { ...where, html_bytes: Buffer.byteLength(html) } };
  }
  throw new FetchError("too_many_redirects", { final_url: safeUrl(current) });
}

async function attemptPage(kind, url, expected, deps, options, onHtml) {
  let last;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    // TikTok's 429 window is longer than a normal blip, so back off harder for it.
    if (attempt > 0) await deps.sleep(options.retryDelayMs * attempt * (last && last.reason === "http_429" ? 3 : 1));
    let fetched;
    try {
      fetched = await fetchPage(url, deps, options);
    } catch (err) {
      const reason = err instanceof FetchError ? err.reason : "network_error";
      last = { ok: false, reason, page: kind, attempts: attempt + 1, ...(err && err.diag) };
      if (!RETRYABLE.test(reason)) return last;
      continue;
    }
    const target = expected.videoId ? expected : { ...expected, ...pickIds(fetched.finalUrl) };
    const parse = kind === "embed" ? parseEmbedPage : parseVideoPage;
    const result = parse(fetched.html, target, fetched.finalUrl);
    const out = { ...result, page: kind, attempts: attempt + 1, ...fetched.diag };
    if (result.ok) {
      delete out.html_bytes;
      return out;
    }
    if (onHtml) await onHtml(kind, fetched.html);
    last = out;
    if (!RETRYABLE.test(result.reason)) return last;
  }
  return last;
}

function pickIds(finalUrl) {
  const target = linkTarget(finalUrl);
  return target ? { videoId: target.videoId, handle: target.handle } : {};
}

/** Which fields would move backwards by more than the allowed drop. */
export function suspiciousDrops(previous, counts, options) {
  const drops = [];
  for (const key of STAT_KEYS) {
    const before = previous && previous[key];
    const after = counts[key];
    if (typeof before !== "number" || typeof after !== "number") continue;
    const fall = before - after;
    if (fall > options.maxDropAbs && fall > before * options.maxDropRatio) drops.push(key);
  }
  return drops;
}

/** Fetch and verify one bound video. Never writes; returns what should be written. */
export async function collectOne(link, deps, options) {
  const target = linkTarget(link);
  if (!target) return { ok: false, reason: "bad_publish_link" };
  const expected = { videoId: target.videoId, handle: target.handle, account: options.account || "" };
  const tried = [];
  const main = await attemptPage("video", target.url, expected, deps, options, options.onHtml);
  if (main.ok) return main;
  tried.push(main);
  const videoId = target.videoId || (main.final_url && linkTarget(main.final_url)?.videoId) || "";
  if (options.embedFallback && videoId && !DEFINITIVE_REASONS.has(main.reason)) {
    const embed = await attemptPage("embed", embedUrl(videoId), { ...expected, videoId }, deps, options, options.onHtml);
    if (embed.ok) return { ...embed, fallback_from: main.reason };
    tried.push(embed);
  }
  return { ...main, tried: tried.length > 1 ? tried.map((step) => `${step.page}:${step.reason}`) : undefined };
}

async function postJson(deps, url, token, body) {
  const response = await deps.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-moo-token": token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return { status: response.status, payload };
}

export async function readOverlays(deps, apiBase, ids) {
  const overlays = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = `${apiBase}/v1/state?ids=${encodeURIComponent(chunk.join(","))}`;
    const response = await deps.fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new FetchError(`state_http_${response.status}`);
    const payload = await response.json();
    Object.assign(overlays, (payload && payload.overlays) || {});
  }
  return overlays;
}

/**
 * One full pass. Returns a summary plus one entry per target; no token or HTML in it.
 * deps: { fetch, sleep, now, random }
 */
export async function runRefresh({ apiBase, token, jobIds, dryRun = false, ...rest }, deps) {
  const options = { ...DEFAULTS, ...rest };
  const validIds = jobIds.filter((id) => /^job-[a-zA-Z0-9]{8,64}$/.test(id));
  const overlays = await readOverlays(deps, apiBase, validIds);
  const targets = validIds.filter((id) => String(overlays[id]?.publish_link || "").trim());
  const results = [];
  for (let index = 0; index < targets.length; index += 1) {
    const id = targets[index];
    if (index > 0) await deps.sleep(options.delayMs + Math.floor(deps.random() * options.jitterMs));
    const link = String(overlays[id].publish_link).trim();
    const collected = await collectOne(link, deps, {
      ...options,
      onHtml: options.saveHtml ? (kind, html) => options.saveHtml(id, kind, html) : undefined,
    });
    const entry = { id, link: safeUrl(link) };
    if (!collected.ok) {
      results.push({ ...entry, status: "failed", ...stripOk(collected) });
      continue;
    }
    const previous = overlays[id].stats || {};
    const drops = suspiciousDrops(previous, collected.counts, options);
    if (drops.length) {
      results.push({
        ...entry,
        status: "failed",
        reason: "suspicious_drop",
        fields: drops,
        counts: collected.counts,
        previous: Object.fromEntries(drops.map((key) => [key, previous[key]])),
      });
      continue;
    }
    const source = collected.page === "embed" ? SOURCE_EMBED : SOURCE_PAGE;
    const base = { ...entry, counts: collected.counts, page: collected.page, source };
    if (collected.fallback_from) base.fallback_from = collected.fallback_from;
    if (dryRun) {
      results.push({ ...base, status: "ok", written: false });
      continue;
    }
    const latest = (await readOverlays(deps, apiBase, [id]))[id];
    if (!latest || String(latest.publish_link || "").trim() !== link) {
      results.push({ ...entry, status: "failed", reason: "link_changed" });
      continue;
    }
    let posted;
    try {
      posted = await postJson(deps, `${apiBase}/v1/stats`, token, { id, ...collected.counts, source });
    } catch {
      results.push({ ...base, status: "failed", reason: "write_network_error" });
      continue;
    }
    if (posted.status === 200 && posted.payload && posted.payload.ok) {
      results.push({ ...base, status: "ok", written: true });
    } else {
      const reason = posted.status === 401 || posted.status === 403 ? "write_unauthorized" : "write_failed";
      const code = typeof posted.payload?.error === "string" ? posted.payload.error.slice(0, 40) : undefined;
      results.push({ ...base, status: "failed", reason, http_status: posted.status, worker_error: code });
    }
  }
  return summarize(results, validIds.length - targets.length, deps.now());
}

function stripOk(result) {
  const { ok, counts, ...rest } = result;
  return rest;
}

export function summarize(results, skipped, at) {
  const reasons = {};
  for (const entry of results) {
    if (entry.status !== "failed") continue;
    reasons[entry.reason] = (reasons[entry.reason] || 0) + 1;
  }
  const ok = results.filter((entry) => entry.status === "ok").length;
  return {
    event: "box_refresh_stats",
    at,
    targets: results.length,
    ok,
    failed: results.length - ok,
    skipped_no_link: skipped,
    reasons,
    results,
  };
}
