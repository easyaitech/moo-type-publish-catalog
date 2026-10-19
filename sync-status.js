/** Copy and display rules when the Cloudflare backfill overlay did not load. */

import { stageLabel } from "./merge.js";

export const UNSYNCED_TEXT = "未同步";

const NETWORK_RE =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|internet connection appears to be offline|access-control-allow-origin/i;

const FAILURE_CONSEQUENCE =
  "页面上的「已发布」「发布链接」「播放 / 点赞 / 评论」不完整。看到的「待发布」数量可能偏多，不代表视频没发，也不代表数据丢了。下载和文案仍可用。";

const FAILURE_ADVICE =
  "换一个网络（连上 Wi‑Fi，或关掉再打开代理）后点「重试」，也可以刷新页面。如果还是不行，先别重复提交链接，把这个画面截图发给 John。";

const UNCONFIGURED_CONSEQUENCE =
  "只能看到 GitHub 上的底稿，朋友已经提交的发布链接、播放、点赞和评论都不会出现。看到的「待发布」数量可能偏多，不代表视频没发，也不代表数据丢了。下载和文案仍可用。";

const UNCONFIGURED_ADVICE =
  "换网络没有用。请把 TikTok 链接先发给 John，等他把 Worker 地址配上后再刷新。先别在页面上重复提交。";

export function classifySyncError(raw) {
  const message = String(raw ?? "").trim() || "error";
  const health = message.match(/^health (\d{3})$/);
  if (health) {
    const status = health[1];
    const server = Number(status) >= 500;
    return {
      kind: "health",
      title: "回填服务健康检查没通过",
      problem: server
        ? `回填服务有回应，但健康检查没通过（HTTP ${status}）。服务自己出错了，可能正在部署，或只是临时故障。`
        : `回填服务有回应，但健康检查没通过（HTTP ${status}）。多半是地址不对，或这个地址上还没有可用的服务。`,
      raw: message,
    };
  }
  const stateError = message.match(/^state (\d{3})$/);
  if (stateError) {
    const status = stateError[1];
    const server = Number(status) >= 500;
    return {
      kind: "state",
      title: "发布状态没有读下来",
      problem: server
        ? `健康检查通过了，但读取发布状态时服务出错（HTTP ${status}）。已提交的链接和播放数据这次没有到页面上。`
        : `健康检查通过了，但读取已提交的发布状态失败（HTTP ${status}）。页面拿不到朋友填过的链接和播放数据。`,
      raw: message,
    };
  }
  if (message === "write disabled") {
    return {
      kind: "write_disabled",
      title: "回填写入被关掉了",
      problem:
        "回填服务在线，但写入被关掉了。已提交的链接和播放数据这次没有同步下来，现在也不能在页面上提交新链接。",
      raw: message,
    };
  }
  if (NETWORK_RE.test(message)) {
    return {
      kind: "network",
      title: "没连上回填服务",
      problem:
        "浏览器没能连上 Cloudflare 回填服务，请求在到达之前就失败了。手机 4G、公司网络，或开了代理、防火墙时经常这样。服务本身可能是好的，只是这台设备现在到不了。",
      raw: message,
    };
  }
  return {
    kind: "other",
    title: "回填状态没有同步",
    problem: "读取回填服务时出了意外错误，页面没有拿到已提交的发布链接和播放数据。",
    raw: message,
  };
}

/** View model for the banner above the stat cards. Null when the overlay loaded. */
export function syncAlertModel({ apiBase, apiOk, apiError }) {
  if (apiOk) return null;
  const configured = Boolean(String(apiBase || "").trim());
  if (!configured) {
    return {
      kind: "unconfigured",
      tone: "config",
      role: "status",
      title: "回填服务还没配置",
      sections: [
        {
          label: "出了什么问题",
          body: "页面里没有 Worker 地址（site-config.js 的 apiBase 是空的），所以不会去请求回填服务。这不是网络故障，换 Wi‑Fi 或开关代理也没有用。",
        },
        { label: "现在会怎样", body: UNCONFIGURED_CONSEQUENCE },
        { label: "建议", body: UNCONFIGURED_ADVICE },
      ],
      raw: "",
      retry: false,
    };
  }
  const failure = classifySyncError(apiError);
  return {
    kind: failure.kind,
    tone: "error",
    role: "alert",
    title: failure.title,
    sections: [
      { label: "出了什么问题", body: failure.problem },
      { label: "现在会怎样", body: FAILURE_CONSEQUENCE },
      { label: "建议", body: FAILURE_ADVICE },
    ],
    raw: failure.raw,
    retry: true,
  };
}

export function summaryCells(summary, synced, formatNum) {
  const stat = (value) => (synced ? formatNum(value) : UNSYNCED_TEXT);
  return [
    { key: "total", label: "成片总数", value: String(summary.total), unsynced: false },
    {
      key: "waiting",
      label: "待手动发布",
      value: synced ? String(summary.waiting_manual_publish) : UNSYNCED_TEXT,
      unsynced: !synced,
    },
    {
      key: "published",
      label: "已填发布链接",
      value: synced ? String(summary.published_with_link) : UNSYNCED_TEXT,
      unsynced: !synced,
    },
    { key: "views", label: "总播放", value: stat(summary.views), unsynced: !synced },
    { key: "likes", label: "总点赞", value: stat(summary.likes), unsynced: !synced },
    { key: "comments", label: "总评论", value: stat(summary.comments), unsynced: !synced },
  ];
}

export function filterChips(summary, synced) {
  return [
    { id: "all", label: `全部 ${summary.total}`, unsynced: false },
    {
      id: "waiting",
      label: synced ? `待发布 ${summary.waiting_manual_publish}` : "待发布 未同步",
      unsynced: !synced,
    },
    {
      id: "published",
      label: synced ? `已发布 ${summary.published_with_link}` : "已发布 未同步",
      unsynced: !synced,
    },
  ];
}

export function badgePresentation(video, synced) {
  if (!synced) return { className: "badge unsynced", text: "状态未同步" };
  const published = Boolean(video?.publish_link);
  return {
    className: published ? "badge ok" : "badge wait",
    text: stageLabel(video?.stage, published),
  };
}

export function metricText(value, synced, formatNum) {
  if (!synced) return UNSYNCED_TEXT;
  return formatNum(value);
}

export function statTimeText(updatedAt, synced) {
  if (!synced) return "播放数据未同步";
  return updatedAt ? `数据更新 ${updatedAt}` : "数据更新 —";
}

export function publishBlock(apiBase) {
  if (!String(apiBase || "").trim()) {
    return {
      className: "sync-form-note config",
      text: "回填服务还没配置，页面上提交不了。请把链接发给 John，不要在这里重复提交。",
    };
  }
  return {
    className: "sync-form-note",
    text: "回填状态没同步，先别提交。换网络后点页面顶部的「重试」，成功后再填。已经发过的不要重复提交。",
  };
}

export function emptyListMessage(filter, { synced, configured }) {
  if (synced) return "这个筛选下没有成片。";
  if (!configured) {
    if (filter === "published") {
      return "回填服务还没配置，底稿里看不到已填的发布链接。这不代表还没有人发过。请把链接发给 John。";
    }
    if (filter === "waiting") return "回填服务还没配置，现在不能判断哪些还没发。";
    return "这个筛选下没有成片。";
  }
  if (filter === "published") {
    return "回填没同步，底稿里看不到已填的发布链接。这不代表还没有人发过。换网络后点顶部的「重试」。";
  }
  if (filter === "waiting") return "回填没同步，现在不能判断哪些还没发。请先点顶部的「重试」。";
  return "这个筛选下没有成片。";
}
