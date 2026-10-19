import {
  cardMeta,
  downloadUrl,
  instagramBlock,
  instagramCopyText,
  isTikTokUrl,
  mergeVideo,
  safeHttpUrl,
  summarize,
} from "./merge.js";
import {
  badgePresentation,
  emptyListMessage,
  filterChips,
  metricText,
  publishBlock,
  statTimeText,
  summaryCells,
  syncAlertModel,
} from "./sync-status.js";

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
  apiError: "",
  retrying: false,
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

function renderSyncAlert() {
  const host = $("#sync-alert");
  const model = syncAlertModel({
    apiBase: state.apiBase,
    apiOk: state.apiOk,
    apiError: state.apiError,
  });
  host.replaceChildren();
  if (!model) {
    host.hidden = true;
    host.className = "";
    host.removeAttribute("role");
    host.removeAttribute("aria-live");
    delete host.dataset.syncKind;
    return;
  }
  host.hidden = false;
  host.className = model.tone === "config" ? "sync-alert config" : "sync-alert";
  host.dataset.syncKind = model.kind;
  host.setAttribute("role", model.role);
  host.setAttribute("aria-live", model.role === "alert" ? "assertive" : "polite");
  host.append(el("div", "sync-alert-title", model.title));
  model.sections.forEach((section, index) => {
    const paragraph = el("p");
    paragraph.append(el("strong", "", `${section.label}。`), document.createTextNode(section.body));
    host.append(paragraph);
    if (index === 0 && model.raw) host.append(el("p", "sync-raw", `原始错误：${model.raw}`));
  });
  if (!model.retry) return;
  const button = el("button", "btn retry", state.retrying ? "正在重试…" : "重试");
  button.type = "button";
  button.disabled = state.retrying;
  button.addEventListener("click", () => {
    retrySync();
  });
  host.append(button);
}

function renderSummary(summary) {
  const root = $("#summary");
  root.replaceChildren();
  for (const cell of summaryCells(summary, state.apiOk, formatNum)) {
    const card = el("div", cell.unsynced ? "card unsynced" : "card");
    const value = el("div", cell.unsynced ? "v unsynced" : "v", cell.value);
    card.append(el("div", "k", cell.label), value);
    root.append(card);
  }
}

function renderBanner() {
  const note = $("#banner");
  note.replaceChildren();
  const folder = safeHttpUrl(state.catalog?.batch_folder_url || "");
  note.append("朋友：下载视频和封面，复制文案，手动发到 TikTok，再把帖子链接填回对应卡片。有「Instagram 英语」的卡片，英文版另外手动发 Instagram。");
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
  if (state.apiOk) {
    const status = el("div", "api-status");
    status.textContent = "回填服务在线。填一次口令后，提交会直接记下，不用改 git。";
    note.append(status);
  }
}

function renderFilters(summary) {
  const bar = $("#filters");
  bar.replaceChildren();
  for (const chip of filterChips(summary, state.apiOk)) {
    const className = ["chip", state.filter === chip.id ? "on" : "", chip.unsynced ? "unsynced" : ""]
      .filter(Boolean)
      .join(" ");
    const button = el("button", className, chip.label);
    button.type = "button";
    if (chip.unsynced) button.title = "回填没同步，这个数量不能当真";
    button.addEventListener("click", () => {
      state.filter = chip.id;
      const hash = chip.id === "all" ? "#all" : `#${chip.id}`;
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
  const unsynced = !state.apiOk;
  const cell = el("div", unsynced ? "metric unsynced" : "metric");
  cell.append(el("div", "mk", label), el("div", unsynced ? "mv unsynced" : "mv", metricText(value, state.apiOk, formatNum)));
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
  if (!state.apiOk) {
    const block = publishBlock(state.apiBase);
    input.disabled = true;
    button.disabled = true;
    button.textContent = "状态未同步，不能提交";
    input.title = block.text;
    button.title = block.text;
    form.classList.add("blocked");
    host.append(el("div", block.className, block.text));
  }
  form.append(input, button, message);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPublish(video, input.value, button, message);
  });
  host.append(form);
}

function thrownMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "error";
}

async function submitPublish(video, rawUrl, button, message) {
  const publishLink = String(rawUrl || "").trim();
  message.className = "form-msg";
  if (!state.apiOk) {
    message.classList.add("bad");
    message.textContent = publishBlock(state.apiBase).text;
    button.disabled = true;
    return;
  }
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

function copyButton(label, text) {
  const button = el("button", "btn", label);
  button.type = "button";
  button.addEventListener("click", () => copyText(text, button));
  return button;
}

function appendLinks(host, buttons) {
  const links = el("div", "links");
  for (const button of buttons) {
    if (button) links.append(button);
  }
  if (links.childElementCount) host.append(links);
}

function variantSection(kind, heading, revision) {
  const section = el("section", `variant variant-${kind}`);
  const head = el("div", "variant-head");
  head.append(el("span", `variant-tag ${kind}`, heading));
  if (revision) head.append(el("span", "muted", revision));
  section.append(head);
  return section;
}

/** Thai TikTok cut: the original card body (copy + downloads), now labelled. */
function renderTikTokSection(video) {
  const section = variantSection("tiktok", "TikTok 泰语", video.revision);
  const copyBlock = el("div", "copy-block");
  copyBlock.append(el("div", "copy-label", "发布文案"));
  if (video.publish_copy) {
    const pre = el("pre", "copy-text");
    pre.textContent = video.publish_copy;
    copyBlock.append(pre, copyButton("复制文案", video.publish_copy));
  } else {
    copyBlock.append(el("p", "muted", "文案还没写进看板。打开网盘文案，复制后再发。"));
  }
  section.append(copyBlock);
  appendLinks(section, [
    linkButton(downloadUrl(video.drive_video_download, video.drive_video), "下载视频", true),
    linkButton(downloadUrl(video.drive_cover_download, video.drive_cover), "下载封面", true),
    linkButton(video.drive_video, "打开视频", false),
    linkButton(video.drive_cover, "打开封面", false),
    linkButton(video.drive_publish_copy, "文案文件", false),
  ]);
  return section;
}

/** English Instagram cut: caption + hashtags with the same copy / download controls. */
function renderInstagramSection(block) {
  const section = variantSection("instagram", "Instagram 英语", block.revision);
  const copyBlock = el("div", "copy-block");
  copyBlock.append(el("div", "copy-label", "英文文案（caption + hashtags）"));
  const fullText = instagramCopyText(block);
  if (fullText) {
    const pre = el("pre", "copy-text");
    pre.lang = "en";
    pre.textContent = fullText;
    copyBlock.append(pre, copyButton("复制文案", fullText));
    if (block.hashtags) copyBlock.append(" ", copyButton("只复制标签", block.hashtags));
  } else {
    copyBlock.append(el("p", "muted", "英文文案还没写进看板。打开网盘文案，复制后再发。"));
  }
  section.append(copyBlock);
  appendLinks(section, [
    linkButton(block.drive_video_download, "下载视频", true),
    linkButton(block.drive_cover_download, "下载封面", true),
    linkButton(block.drive_video, "打开视频", false),
    linkButton(block.drive_cover, "打开封面", false),
    linkButton(block.drive_publish_copy, "文案文件", false),
  ]);
  return section;
}

function renderCard(video) {
  const card = el("article", "item");
  const head = el("div", "item-head");
  const title = el("div");
  const displayTitle = video.title || video.folder_title || video.label || "";
  const name = el("h2", "", displayTitle);
  const meta = el("div", "muted", cardMeta(video));
  title.append(name, meta);
  const published = Boolean(video.publish_link);
  const badgeInfo = badgePresentation(video, state.apiOk);
  const badge = el("span", badgeInfo.className, badgeInfo.text);
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
  const updated = el("div", "muted stat-time", statTimeText(video.stats?.updated_at, state.apiOk));
  card.append(metrics, updated);

  card.append(renderTikTokSection(video));
  const instagram = instagramBlock(video);
  if (instagram) {
    card.append(renderInstagramSection(instagram));
  } else {
    card.append(el("div", "muted variant-none", "Instagram 英语：这条还没有英文版。"));
  }

  const shared = el("div", "links");
  const folderButton = linkButton(video.drive_folder, "文件夹", false);
  if (folderButton) {
    shared.append(folderButton);
    card.append(shared);
  }

  const publish = el("div", "publish");
  if (published) {
    const row = el("div", "published-link");
    row.append(el("span", "muted", state.apiOk ? "发布链接" : "底稿里的链接（还没和回填服务核对）"));
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
    if (state.apiOk) publish.append(el("div", "copy-label", "TikTok 泰语版发布后，把 TikTok 链接贴在这里"));
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
  renderSyncAlert();
  renderSummary(summary);
  renderBanner();
  renderFilters(summary);
  const list = $("#list");
  const shown = visibleVideos(videos);
  list.replaceChildren();
  if (!shown.length) {
    list.append(
      el(
        "p",
        "empty",
        emptyListMessage(state.filter, { synced: state.apiOk, configured: Boolean(state.apiBase) }),
      ),
    );
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
  const ids = (state.catalog.videos || []).map((video) => video.job_id).filter((id) => /^job-[a-zA-Z0-9]{8,64}$/.test(id || ""));
  const health = await fetch(`${state.apiBase}/v1/health`);
  if (!health.ok) throw new Error(`health ${health.status}`);
  const healthBody = await health.json();
  if (!healthBody.write) throw new Error("write disabled");
  const response = await fetch(`${state.apiBase}/v1/state?ids=${encodeURIComponent(ids.join(","))}`);
  if (!response.ok) throw new Error(`state ${response.status}`);
  const body = await response.json();
  state.overlays = body.overlays || {};
  state.apiOk = true;
  state.apiError = "";
}

let retryFlight = null;

async function refreshOverlay() {
  if (!state.apiBase || !state.catalog) {
    state.apiOk = false;
    state.apiError = "";
    return;
  }
  try {
    await loadState();
  } catch (error) {
    state.apiOk = false;
    state.overlays = {};
    state.apiError = thrownMessage(error);
  }
}

async function retrySync() {
  if (retryFlight || state.retrying || !state.apiBase) return;
  state.retrying = true;
  render();
  retryFlight = refreshOverlay();
  try {
    await retryFlight;
  } finally {
    retryFlight = null;
    state.retrying = false;
    render();
  }
}

async function boot() {
  const list = $("#list");
  try {
    await loadCatalog();
  } catch {
    list.replaceChildren(el("p", "empty", "成片目录没有加载出来。确认 catalog.json 和页面在同一目录。"));
    return;
  }
  if (state.apiBase) await refreshOverlay();
  render();
}

boot();
