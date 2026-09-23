import { cardMeta, cardTitle, downloadUrl, isTikTokUrl, mergeVideo, safeHttpUrl, stageLabel, summarize } from "./merge.js";

const TOKEN_KEY = "moo-friend-token";

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function writeToken(value) {
  try {
    localStorage.setItem(TOKEN_KEY, value);
  } catch {
    /* private mode can reject storage; the field still works for this page view */
  }
}

const state = {
  catalog: null,
  overlays: {},
  filter: filterFromHash(),
  apiBase: resolveApiBase(),
  apiOk: false,
  apiDetail: "",
  token: readToken(),
};

const $ = (selector) => document.querySelector(selector);

function filterFromHash() {
  if (location.hash === "#published") return "published";
  if (location.hash === "#waiting") return "waiting";
  return "all";
}

function resolveApiBase() {
  const fromQuery = new URLSearchParams(location.search).get("api");
  const configured = fromQuery || (window.MOO_SITE && window.MOO_SITE.apiBase) || "";
  return String(configured).trim().replace(/\/$/, "");
}

function formatNum(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("en-US");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function linkButton(href, label, primary) {
  const safe = safeHttpUrl(href);
  if (!safe) return null;
  const anchor = el("a", primary ? "btn primary" : "btn", label);
  anchor.href = safe;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  return anchor;
}

async function copyText(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "已复制";
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    button.textContent = "已复制";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

function mergedVideos() {
  return (state.catalog?.videos || []).map((video) =>
    mergeVideo(video, state.overlays[video.job_id]),
  );
}

function visibleVideos(videos) {
  return videos.filter((video) => {
    const published = Boolean(video.publish_link);
    if (state.filter === "waiting") return !published;
    if (state.filter === "published") return published;
    return true;
  });
}

function renderSummary(summary) {
  const cards = [
    ["成片总数", summary.total],
    ["待手动发布", summary.waiting_manual_publish],
    ["已填发布链接", summary.published_with_link],
    ["总播放", formatNum(summary.views)],
    ["总点赞", formatNum(summary.likes)],
    ["总评论", formatNum(summary.comments)],
  ];
  const root = $("#summary");
  root.replaceChildren();
  for (const [label, value] of cards) {
    const card = el("div", "card");
    card.append(el("div", "k", label), el("div", "v", String(value)));
    root.append(card);
  }
}

function renderBanner() {
  const note = $("#banner");
  note.replaceChildren();
  const folder = safeHttpUrl(state.catalog?.batch_folder_url || "");
  note.append("朋友：下载视频和封面，复制文案，手动发到 TikTok，再把帖子链接填回对应卡片。");
  note.append(document.createElement("br"));
  if (folder) {
    note.append("批次文件夹：");
    const anchor = el("a");
    anchor.href = folder;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = folder;
    note.append(anchor);
    note.append(document.createElement("br"));
  }
  note.append("「—」表示还没回填，不是抓取失败。Bot 不登录 TikTok。");
  const status = el("div", "api-status");
  if (!state.apiBase) {
    status.textContent = "回填服务还没接上。可以先下载和复制；提交链接要等 Worker 部署后，或先把链接发给 John。";
  } else if (state.apiOk) {
    status.textContent = "回填服务在线。填一次口令后，提交会直接记下，不用改 git。";
  } else {
    status.textContent = state.apiDetail || "回填服务暂时连不上。刷新后再试。";
  }
  note.append(status);
}

function renderFilters(summary) {
  const bar = $("#filters");
  bar.replaceChildren();
  const options = [
    ["all", `全部 ${summary.total}`],
    ["waiting", `待发布 ${summary.waiting_manual_publish}`],
    ["published", `已发布 ${summary.published_with_link}`],
  ];
  for (const [id, label] of options) {
    const button = el("button", state.filter === id ? "chip on" : "chip", label);
    button.type = "button";
    button.addEventListener("click", () => {
      state.filter = id;
      const hash = id === "all" ? "#all" : `#${id}`;
      history.replaceState(null, "", hash);
      render();
    });
    bar.append(button);
  }
  const tokenLabel = el("label", "token");
  tokenLabel.append(el("span", "", "回填口令"));
  const input = el("input");
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = "John 单独给你的口令";
  input.value = state.token;
  input.addEventListener("input", () => {
    state.token = input.value;
    writeToken(state.token);
  });
  tokenLabel.append(input);
  bar.append(tokenLabel);
}

function metric(label, value) {
  const cell = el("div", "metric");
  cell.append(el("div", "mk", label), el("div", "mv", formatNum(value)));
  return cell;
}

function renderPublishForm(video, host) {
  const form = el("form", "publish-form");
  const input = el("input");
  input.type = "url";
  input.required = true;
  input.placeholder = "https://www.tiktok.com/@账号/video/…";
  input.value = video.publish_link || "";
  const button = el("button", "btn primary", video.publish_link ? "更新链接" : "我已发布，提交链接");
  button.type = "submit";
  const message = el("div", "form-msg");
  if (!state.apiBase) button.disabled = true;
  form.append(input, button, message);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPublish(video, input.value, button, message);
  });
  host.append(form);
}

async function submitPublish(video, rawUrl, button, message) {
  const publishLink = String(rawUrl || "").trim();
  message.className = "form-msg";
  if (!isTikTokUrl(publishLink)) {
    message.classList.add("bad");
    message.textContent = "请贴 https 的 TikTok 链接（tiktok.com / vm.tiktok.com / vt.tiktok.com）。";
    return;
  }
  if (!state.token.trim()) {
    message.classList.add("bad");
    message.textContent = "请先在上方填写回填口令。";
    document.querySelector(".token input")?.focus();
    return;
  }
  if (!state.apiBase) {
    message.classList.add("bad");
    message.textContent = "回填服务还没配置。";
    return;
  }
  if (video.publish_link && video.publish_link !== publishLink) {
    const ok = window.confirm("这条已经有发布链接，要换成新的吗？");
    if (!ok) return;
  }
  button.disabled = true;
  message.textContent = "正在提交…";
  try {
    const response = await fetch(`${state.apiBase}/v1/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-moo-token": state.token.trim(),
      },
      body: JSON.stringify({ id: video.job_id, publish_link: publishLink }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      message.classList.add("bad");
      message.textContent = errorText(response.status, payload);
      button.disabled = false;
      return;
    }
    state.overlays[video.job_id] = payload.overlay;
    message.classList.add("ok");
    message.textContent = "已记下，状态改为已发布。";
    render();
  } catch {
    message.classList.add("bad");
    message.textContent = "网络失败，链接还没提交。请再试一次。";
    button.disabled = false;
  }
}

function errorText(status, payload) {
  if (status === 401) return "口令不对。向 John 要回填口令后再试。";
  if (status === 403) return "这个口令不能改这一项。";
  if (payload?.error === "invalid_publish_link") return "链接格式不对，请贴 TikTok 帖子地址。";
  return payload?.error ? `提交失败：${payload.error}` : "提交失败，请稍后再试。";
}

function renderCard(video) {
  const card = el("article", "item");
  const head = el("div", "item-head");
  const title = el("div");
  const name = el("h2", "", cardTitle(video));
  const meta = el("div", "muted", cardMeta(video));
  title.append(name, meta);
  const published = Boolean(video.publish_link);
  const badge = el("span", published ? "badge ok" : "badge wait", stageLabel(video.stage, published));
  head.append(title, badge);
  card.append(head);

  const metrics = el("div", "metrics");
  metrics.append(
    metric("播放", video.stats?.views),
    metric("点赞", video.stats?.likes),
    metric("评论", video.stats?.comments),
    metric("分享", video.stats?.shares),
    metric("收藏", video.stats?.saves),
  );
  const updated = el(
    "div",
    "muted stat-time",
    video.stats?.updated_at ? `数据更新 ${video.stats.updated_at}` : "数据更新 —",
  );
  card.append(metrics, updated);

  const copyBlock = el("div", "copy-block");
  copyBlock.append(el("div", "copy-label", "发布文案"));
  if (video.publish_copy) {
    const pre = el("pre", "copy-text");
    pre.textContent = video.publish_copy;
    const copyBtn = el("button", "btn", "复制文案");
    copyBtn.type = "button";
    copyBtn.addEventListener("click", () => copyText(video.publish_copy, copyBtn));
    copyBlock.append(pre, copyBtn);
  } else {
    copyBlock.append(el("p", "muted", "文案还没写进看板。打开网盘文案，复制后再发。"));
  }
  card.append(copyBlock);

  const links = el("div", "links");
  const buttons = [
    linkButton(downloadUrl(video.drive_video_download, video.drive_video), "下载视频", true),
    linkButton(downloadUrl(video.drive_cover_download, video.drive_cover), "下载封面", true),
    linkButton(video.drive_video, "打开视频", false),
    linkButton(video.drive_cover, "打开封面", false),
    linkButton(video.drive_folder, "文件夹", false),
    linkButton(video.drive_publish_copy, "文案文件", false),
  ];
  for (const button of buttons) {
    if (button) links.append(button);
  }
  card.append(links);

  const publish = el("div", "publish");
  if (published) {
    const row = el("div", "published-link");
    row.append(el("span", "muted", "发布链接"));
    const anchor = linkButton(video.publish_link, video.publish_link, false);
    if (anchor) {
      anchor.classList.add("post-link");
      row.append(anchor);
    }
    publish.append(row);
    if (video.published_at) publish.append(el("div", "muted", `提交于 ${video.published_at}`));
    const details = el("details");
    details.append(el("summary", "", "更正链接"));
    renderPublishForm(video, details);
    publish.append(details);
  } else {
    publish.append(el("div", "copy-label", "发布后把 TikTok 链接贴在这里"));
    renderPublishForm(video, publish);
  }
  card.append(publish);
  return card;
}

function render() {
  if (!state.catalog) return;
  const videos = mergedVideos();
  const summary = summarize(videos);
  $("#subtitle").textContent = `成片包 · 待发布 / 已发布 · 目录更新 ${state.catalog.updated_at || ""} UTC`;
  renderSummary(summary);
  renderBanner();
  renderFilters(summary);
  const list = $("#list");
  const shown = visibleVideos(videos);
  list.replaceChildren();
  if (!shown.length) {
    list.append(el("p", "empty", "这个筛选下没有成片。"));
    return;
  }
  const waitingFirst = [...shown].sort((a, b) => Number(Boolean(a.publish_link)) - Number(Boolean(b.publish_link)));
  for (const video of waitingFirst) list.append(renderCard(video));
}

async function loadCatalog() {
  const response = await fetch("catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  state.catalog = await response.json();
}

async function loadState() {
  if (!state.apiBase || !state.catalog) return;
  const ids = (state.catalog.videos || []).map((video) => video.job_id).filter(Boolean);
  const health = await fetch(`${state.apiBase}/v1/health`);
  if (!health.ok) throw new Error(`health ${health.status}`);
  const healthBody = await health.json();
  if (!healthBody.write) throw new Error("write disabled");
  const response = await fetch(`${state.apiBase}/v1/state?ids=${encodeURIComponent(ids.join(","))}`);
  if (!response.ok) throw new Error(`state ${response.status}`);
  const body = await response.json();
  state.overlays = body.overlays || {};
  state.apiOk = true;
}

async function boot() {
  const list = $("#list");
  try {
    await loadCatalog();
  } catch {
    list.replaceChildren(el("p", "empty", "成片目录没有加载出来。确认 catalog.json 和页面在同一目录。"));
    return;
  }
  if (state.apiBase) {
    try {
      await loadState();
    } catch (error) {
      state.apiOk = false;
      state.apiDetail = `回填服务连不上（${error.message || "error"}）。下载和文案仍可用。`;
    }
  }
  render();
}

boot();
