/**
 * Parse public TikTok pages into verified counts, or a named reason why not.
 * Pure functions: no network, no secrets. Shared by refresh.mjs and tests.
 */

export const STAT_KEYS = ["views", "likes", "comments", "shares", "saves"];

const COUNT_FIELDS = [
  ["playCount", "views"],
  ["diggCount", "likes"],
  ["commentCount", "comments"],
  ["shareCount", "shares"],
  ["collectCount", "saves"],
];
const EMBED_FIELDS = COUNT_FIELDS.filter(([, to]) => to !== "saves");
const DETAIL_KEYS = ["webapp.video-detail", "webapp.reflow.video.detail"];
const REHYDRATION_RE =
  /<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i;
const SIGI_RE = /<script\b[^>]*\bid=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i;
const FRONTITY_RE = /<script\b[^>]*\bid=["']__FRONTITY_CONNECT_STATE__["'][^>]*>([\s\S]*?)<\/script>/i;
const MAX_TITLE_CHARS = 80;
const MARKER_SAMPLE_CHARS = 12000;

// TikTok item-detail status codes seen on public pages.
const NOT_FOUND_CODES = new Set([10204]);
const PRIVATE_CODES = new Set([10216, 10222]);

/** Reasons that describe the video itself, so a second page will not help. */
export const DEFINITIVE_REASONS = new Set(["video_not_found", "video_private", "wrong_video"]);

export function coerceCount(value) {
  if (typeof value === "boolean" || value == null) return null;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "" || (typeof raw === "string" && !/^\d+$/.test(raw))) return null;
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return number;
}

/**
 * Where a publish link points: video id and @handle when the URL carries them.
 * Short links (vm./vt.tiktok.com) have neither until redirects are followed.
 */
export function linkTarget(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return null;
  const path = decodeURIComponent(url.pathname);
  const video = path.match(/\/(?:video|photo)\/(\d{8,25})(?:\/|$)/);
  const handle = path.match(/^\/@([^/]+)/);
  return {
    url: url.href,
    host,
    videoId: video ? video[1] : "",
    handle: handle ? handle[1].toLowerCase() : "",
    short: !video && (host === "vm.tiktok.com" || host === "vt.tiktok.com" || /^\/t\//.test(path)),
  };
}

export function embedUrl(videoId) {
  return `https://www.tiktok.com/embed/v2/${videoId}`;
}

function cleanText(text) {
  return String(text || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksSensitive(text) {
  return /cookie|sessionid|\btoken\b|password|\bsecret\b|authorization/i.test(text);
}

export function pageTitle(html) {
  const match = String(html || "").slice(0, 8000).match(/<title\b[^>]*>([^<]{0,300})/i);
  const text = match ? cleanText(match[1]) : "";
  if (!text || looksSensitive(text)) return "";
  return text.slice(0, MAX_TITLE_CHARS);
}

/** Words that hint at a block page. Data scripts are stripped first so bundle strings do not count. */
export function pageMarkers(html, finalUrl = "") {
  const body = String(html || "")
    .replace(REHYDRATION_RE, " ")
    .replace(SIGI_RE, " ")
    .replace(FRONTITY_RE, " ")
    .slice(0, MARKER_SAMPLE_CHARS);
  const sample = `${finalUrl}\n${pageTitle(html)}\n${body}`;
  const markers = [];
  if (/captcha|wafchallenge|_wafchallengeid|secsdk-captcha/i.test(sample)) markers.push("captcha");
  if (/\bverify\b|verification|x-tt-verify/i.test(sample)) markers.push("verify");
  if (/log\s*in|sign\s*in|\/login\b/i.test(sample)) markers.push("login");
  if (/not available in your (?:region|country)|region.?restricted|unavailable in your/i.test(sample)) {
    markers.push("region");
  }
  return markers;
}

function readJsonScript(html, re) {
  const match = String(html || "").match(re);
  if (!match) return { found: false };
  try {
    return { found: true, data: JSON.parse(match[1].trim()) };
  } catch {
    return { found: true, error: "json_parse" };
  }
}

function countsFrom(sources, fields) {
  const usable = sources.filter((source) => source && typeof source === "object");
  if (!usable.length) return null;
  const counts = {};
  for (const [from, to] of fields) {
    let picked = null;
    for (const source of usable) {
      if (source[from] === undefined) continue;
      picked = coerceCount(source[from]);
      if (picked !== null) break;
    }
    if (picked === null) return null;
    counts[to] = picked;
  }
  return counts;
}

function normalizeCode(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d{1,7}$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function statusReason(code) {
  if (NOT_FOUND_CODES.has(code)) return "video_not_found";
  if (PRIVATE_CODES.has(code)) return "video_private";
  return "video_unavailable";
}

function detailEntry(data) {
  const scope = data && typeof data === "object" ? data.__DEFAULT_SCOPE__ : null;
  if (!scope || typeof scope !== "object") return null;
  for (const key of DETAIL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(scope, key)) {
      const entry = scope[key];
      return entry && typeof entry === "object" ? entry : {};
    }
  }
  return null;
}

function sigiItem(data, expectedId) {
  const modules = data && typeof data === "object" ? data.ItemModule : null;
  if (!modules || typeof modules !== "object") return null;
  if (expectedId && modules[expectedId]) return modules[expectedId];
  const values = Object.values(modules).filter((value) => value && typeof value === "object");
  return values.length === 1 ? values[0] : null;
}

function itemAuthor(item) {
  if (!item || typeof item !== "object") return "";
  const author = item.author;
  if (author && typeof author === "object") return String(author.uniqueId || "").toLowerCase();
  if (typeof author === "string") return author.toLowerCase();
  return "";
}

/**
 * Checks the page is about the bound video. Ids are compared as strings: TikTok ids
 * exceed Number.MAX_SAFE_INTEGER, so a numeric id cannot be trusted.
 */
function bindingProblem(item, expected) {
  const gotId = typeof item.id === "string" ? item.id : "";
  if (expected.videoId && gotId !== expected.videoId) {
    return { detail: gotId ? "video_id_mismatch" : "video_id_missing", page_video_id: gotId || undefined };
  }
  const gotAuthor = itemAuthor(item);
  for (const handle of [expected.handle, expected.account]) {
    if (!handle) continue;
    if (gotAuthor !== String(handle).toLowerCase()) {
      return { detail: gotAuthor ? "author_mismatch" : "author_missing", page_author: gotAuthor || undefined };
    }
  }
  return null;
}

function blockReason(markers) {
  if (markers.includes("captcha") || markers.includes("verify")) return "challenge";
  if (markers.includes("login")) return "login_wall";
  if (markers.includes("region")) return "region_blocked";
  return "";
}

/**
 * Normal TikTok pages also contain "captcha" and "log in" in their bundles, so markers
 * are only reported (and only decide the reason) when the page has no data script.
 */
function failure(reason, extra, html, finalUrl, withMarkers = false) {
  const out = { ok: false, reason, ...extra };
  const title = pageTitle(html);
  if (title) out.title = title;
  if (withMarkers) {
    const markers = pageMarkers(html, finalUrl);
    if (markers.length) out.markers = markers;
  }
  return out;
}

function noDataScript(html, finalUrl) {
  const block = blockReason(pageMarkers(html, finalUrl));
  return failure(block || "layout_changed", block ? {} : { detail: "no_data_script" }, html, finalUrl, true);
}

/**
 * Main video page (www.tiktok.com/@user/video/<id>).
 * expected: { videoId, handle, account } — all optional, but videoId should be set.
 * Returns { ok: true, counts, videoId, author } or { ok: false, reason, detail?, ... }.
 */
export function parseVideoPage(html, expected = {}, finalUrl = "") {
  if (typeof html !== "string" || !html.trim()) return failure("empty_page", {}, "", finalUrl);
  const universal = readJsonScript(html, REHYDRATION_RE);
  const sigi = universal.found ? { found: false } : readJsonScript(html, SIGI_RE);
  if (!universal.found && !sigi.found) return noDataScript(html, finalUrl);
  const parsed = universal.found ? universal : sigi;
  if (parsed.error) return failure("layout_changed", { detail: "json_parse" }, html, finalUrl);

  let item = null;
  let statusCode;
  if (universal.found) {
    const entry = detailEntry(parsed.data);
    if (entry) {
      statusCode = normalizeCode(entry.statusCode);
      const struct = entry.itemInfo && entry.itemInfo.itemStruct;
      item = struct && typeof struct === "object" ? struct : null;
    }
  } else {
    item = sigiItem(parsed.data, expected.videoId);
  }

  if (statusCode !== undefined && statusCode !== 0 && !item) {
    return failure(statusReason(statusCode), { status_code: statusCode }, html, finalUrl);
  }
  if (!item) return failure("layout_changed", { detail: "no_item" }, html, finalUrl);
  const binding = bindingProblem(item, expected);
  if (binding) return failure("wrong_video", binding, html, finalUrl);
  if (item.privateItem === true) return failure("video_private", {}, html, finalUrl);

  const counts = countsFrom([item.stats, item.statsV2], COUNT_FIELDS);
  if (!counts) {
    if (statusCode !== undefined && statusCode !== 0) {
      return failure(statusReason(statusCode), { status_code: statusCode }, html, finalUrl);
    }
    return failure("layout_changed", { detail: "no_stats" }, html, finalUrl);
  }
  return { ok: true, counts, videoId: item.id, author: itemAuthor(item), page: "video" };
}

/**
 * Embed page (www.tiktok.com/embed/v2/<id>). Carries views, likes, comments and
 * shares but not saves, so saves is left out rather than guessed.
 */
export function parseEmbedPage(html, expected = {}, finalUrl = "") {
  if (typeof html !== "string" || !html.trim()) return failure("empty_page", {}, "", finalUrl);
  const state = readJsonScript(html, FRONTITY_RE);
  if (!state.found) return noDataScript(html, finalUrl);
  if (state.error) return failure("layout_changed", { detail: "json_parse" }, html, finalUrl);
  const pages = state.data && state.data.source && state.data.source.data;
  if (!pages || typeof pages !== "object") return failure("layout_changed", { detail: "no_item" }, html, finalUrl);
  const key = Object.keys(pages).find((name) => /^\/embed\/v2\//.test(name));
  const pageData = key ? pages[key] : null;
  const videoData = pageData && pageData.videoData;
  const infos = videoData && videoData.itemInfos;
  if (!infos || typeof infos !== "object") {
    const code = normalizeCode(pageData && (pageData.statusCode ?? pageData.code));
    if (code !== undefined && code !== 0) {
      return failure(statusReason(code), { status_code: code }, html, finalUrl);
    }
    return failure("layout_changed", { detail: "no_item" }, html, finalUrl);
  }
  const author = videoData.authorInfos && videoData.authorInfos.uniqueId;
  const item = { id: infos.id, author: author ? { uniqueId: author } : undefined };
  const binding = bindingProblem(item, expected);
  if (binding) return failure("wrong_video", binding, html, finalUrl);
  const counts = countsFrom([infos], EMBED_FIELDS);
  if (!counts) return failure("layout_changed", { detail: "no_stats" }, html, finalUrl);
  return { ok: true, counts, videoId: item.id, author: itemAuthor(item), page: "embed" };
}
