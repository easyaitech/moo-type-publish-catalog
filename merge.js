/** Pure catalog merge rules shared by the page and node tests. */

export const STAT_KEYS = ["views", "likes", "comments", "shares", "saves"];

export function driveFileId(url) {
  const text = String(url || "");
  const file = text.match(/\/file\/d\/([^/?#]+)/);
  if (file) return file[1];
  const query = text.match(/[?&]id=([^&#]+)/);
  return query ? query[1] : "";
}

export function downloadUrl(explicit, viewUrl) {
  if (explicit) return String(explicit);
  const id = driveFileId(viewUrl);
  if (id) return `https://drive.google.com/uc?id=${id}&export=download`;
  return viewUrl || "";
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function isTikTokUrl(value) {
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

function newer(left, right) {
  if (!left) return false;
  if (!right) return true;
  return left > right;
}

export function mergeVideo(video, overlay) {
  const stats = { ...emptyStats(), ...(video.stats || {}) };
  const merged = {
    ...video,
    publish_link: video.publish_link || "",
    published_at: video.published_at || "",
    publish_copy: video.publish_copy || "",
    stage: video.stage || "WAITING_MANUAL_PUBLISH",
    stats,
  };
  if (!overlay) {
    if (merged.publish_link && merged.stage === "WAITING_MANUAL_PUBLISH") {
      merged.stage = "PUBLISHED";
    }
    return merged;
  }
  const overlayStats = overlay.stats || {};
  if (newer(overlayStats.updated_at || "", stats.updated_at || "")) {
    for (const key of STAT_KEYS) {
      if (overlayStats[key] !== null && overlayStats[key] !== undefined) {
        stats[key] = overlayStats[key];
      }
    }
    stats.updated_at = overlayStats.updated_at || "";
    if (overlayStats.source) stats.source = overlayStats.source;
  }
  const overlayLink = overlay.publish_link || "";
  if (overlayLink && newer(overlay.published_at || "", merged.published_at || "")) {
    merged.publish_link = overlayLink;
    merged.published_at = overlay.published_at || "";
    merged.stage = "PUBLISHED";
  } else if (merged.publish_link && merged.stage === "WAITING_MANUAL_PUBLISH") {
    merged.stage = "PUBLISHED";
  }
  merged.stats = stats;
  return merged;
}

export function summarize(videos) {
  const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const total = (key) => {
    const values = videos.map((video) => num(video.stats?.[key])).filter((value) => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  return {
    total: videos.length,
    waiting_manual_publish: videos.filter(
      (video) => !video.publish_link && video.stage === "WAITING_MANUAL_PUBLISH",
    ).length,
    published_with_link: videos.filter((video) => !!video.publish_link).length,
    views: total("views"),
    likes: total("likes"),
    comments: total("comments"),
    shares: total("shares"),
    saves: total("saves"),
  };
}

export function stageLabel(stage, hasLink) {
  if (hasLink || stage === "PUBLISHED") return "已发布";
  if (stage === "WAITING_MANUAL_PUBLISH") return "待手动发布";
  return stage || "未知";
}

/**
 * Card heading is the human folder name, not the technical subfolder_name.
 * Prefer video.title, then folder_title, then the short label.
 */
export function cardTitle(video) {
  const displayTitle = String(video?.title || "").trim();
  const folderTitle = String(video?.folder_title || "").trim();
  const label = String(video?.label || "").trim();
  return displayTitle || folderTitle || label;
}

/**
 * Secondary line: short label, revision, technical subfolder id, and platform.
 * Skip any part that repeats the heading so the folder display name is not shown twice.
 */
export function cardMeta(video) {
  const heading = cardTitle(video);
  const label = String(video?.label || "").trim();
  const revision = String(video?.revision || "").trim();
  const subfolder = String(video?.subfolder_name || "").trim();
  const platform = String(video?.platform || "").trim() || "TikTok";
  const parts = [];
  if (label && label !== heading) parts.push(label);
  if (revision && revision !== heading) parts.push(revision);
  if (subfolder && subfolder !== heading && subfolder !== label) parts.push(subfolder);
  if (platform && platform !== heading) parts.push(platform);
  return parts.join(" · ");
}
