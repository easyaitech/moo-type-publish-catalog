import {
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
  query: "",
  helpOpen: false,
  tokenEditing: false,
  open: null,
  drafts: {},
  flash: null,
  toast: "",
  justId: "",
  pinJust: false,
  summary: null,
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

function catalogTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]} UTC` : text;
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

function searchHay(video) {
  const instagram = instagramBlock(video);
  return [
    video.title,
    video.folder_title,
    video.label,
    video.revision,
    video.subfolder_name,
    video.platform,
    video.publish_link,
    video.publish_copy,
    instagram?.caption,
    instagram?.hashtags,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function visibleVideos(videos) {
  const query = state.query.trim().toLowerCase();
  return videos.filter((video) => {
    const published = Boolean(video.publish_link);
    if (state.filter === "waiting" && published) return false;
    if (state.filter === "published" && !published) return false;
    if (!query) return true;
    return searchHay(video).includes(query);
  });
}

function rememberDrafts() {
  for (const card of document.querySelectorAll("#list [data-job]")) {
    const input = card.querySelector(".publish-form input");
    if (!input) continue;
    state.drafts[card.dataset.job] = input.value;
  }
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
  const row = el("div", "note-row");
  const summary = el("span", "", "先下载视频、复制文案、发出去，再点「填链接」把帖子地址贴回来。");
  const toggle = el("button", "note-toggle", state.helpOpen ? "收起说明" : "查看说明");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", state.helpOpen ? "true" : "false");
  toggle.addEventListener("click", () => {
    state.helpOpen = !state.helpOpen;
    renderBanner();
  });
  row.append(summary, toggle);
  note.append(row);
  if (!state.helpOpen) return;
  const body = el("div", "note-body");
  const lead = el("p");
  lead.textContent = "每条片子默认只显示标题。点「文案」「下载」「数据」「填链接」再展开。有英文版的，在「文案」和「下载」里切换到 Instagram，英文另外发。";
  body.append(lead);
  const folder = safeHttpUrl(state.catalog?.batch_folder_url || "");
  if (folder) {
    const line = el("p");
    line.append("这一批成片：");
    const anchor = el("a", "", "打开网盘文件夹");
    anchor.href = folder;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    line.append(anchor);
    body.append(line);
  }
  body.append(el("p", "", "数据里的「—」表示还没回填，不是抓取失败。这个页面不会登录 TikTok。"));
  if (state.apiOk) {
    body.append(el("p", "api-status", "回填在线。口令填一次就留在这台浏览器里，提交后不用改别的。"));
  }
  note.append(body);
}

function renderFilters(summary) {
  const bar = $("#filters");
  bar.replaceChildren();
  const group = el("div", "filter-group");
  for (const chip of filterChips(summary, state.apiOk)) {
    const className = ["chip", state.filter === chip.id ? "on" : "", chip.unsynced ? "unsynced" : ""]
      .filter(Boolean)
      .join(" ");
    const button = el("button", className, chip.label);
    button.type = "button";
    if (chip.unsynced) button.title = "回填没同步，这个数量不能当真";
    button.addEventListener("click", () => {
      state.filter = chip.id;
      state.toast = "";
      const hash = chip.id === "all" ? "#all" : `#${chip.id}`;
      history.replaceState(null, "", hash);
      render();
    });
    group.append(button);
  }
  bar.append(group);

  const search = el("div", "search");
  const searchInput = el("input");
  searchInput.type = "search";
  searchInput.placeholder = "搜标题、标签";
  searchInput.setAttribute("aria-label", "搜标题、标签");
  searchInput.value = state.query;
  searchInput.autocomplete = "off";
  searchInput.enterKeyHint = "search";
  const clear = el("button", "clear", "×");
  clear.type = "button";
  clear.setAttribute("aria-label", "清除搜索");
  clear.hidden = !state.query.trim();
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    clear.hidden = !state.query.trim();
    renderList();
  });
  clear.addEventListener("click", () => {
    state.query = "";
    searchInput.value = "";
    clear.hidden = true;
    renderList();
    searchInput.focus();
  });
  search.append(searchInput, clear);
  bar.append(search);

  if (state.token.trim() && !state.tokenEditing) {
    const saved = el("button", "token-saved", "口令已保存");
    saved.type = "button";
    saved.title = "点这里可以改口令";
    saved.addEventListener("click", () => {
      state.tokenEditing = true;
      renderFilters(state.summary);
      document.querySelector(".token input")?.focus();
    });
    bar.append(saved);
  } else {
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
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!state.token.trim() || state.tokenEditing === false) return;
        if (document.activeElement === input) return;
        state.tokenEditing = false;
        renderFilters(state.summary);
      }, 180);
    });
    tokenLabel.append(input);
    bar.append(tokenLabel);
  }

  bar.append(el("p", "count", ""));
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
  input.value = Object.prototype.hasOwnProperty.call(state.drafts, video.job_id)
    ? state.drafts[video.job_id]
    : video.publish_link || "";
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
    delete state.drafts[video.job_id];
    const hidden = state.filter === "waiting" || (state.query.trim() && !searchHay({ ...video, publish_link: publishLink }).includes(state.query.trim().toLowerCase()));
    if (hidden) {
      state.flash = null;
      state.open = null;
      state.justId = "";
      state.pinJust = false;
      state.toast = "已记下。这条已改为已发布，可以在「已发布」里看到。";
    } else {
      state.flash = { id: video.job_id, text: "已记下，这条已改为已发布。", tone: "ok" };
      state.open = { id: video.job_id, panel: "link", lang: "th" };
      state.justId = video.job_id;
      state.pinJust = true;
      state.toast = "";
    }
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

function metaBits(video) {
  const heading = video.title || video.folder_title || video.label || "";
  const wrap = el("div", "bits");
  const add = (text, className) => {
    const value = String(text || "").trim();
    if (!value || value === heading) return;
    wrap.append(el("span", className || "bit", value));
  };
  if (instagramBlock(video)) add("英文", "bit en");
  add(video.label);
  const revision = String(video.revision || "").trim();
  if (revision && revision !== String(video.label || "").trim()) add(revision);
  const platform = String(video.platform || "").trim();
  if (platform && platform !== "TikTok") add(platform);
  return wrap;
}

const SHORT_BADGE = {
  待手动发布: "待发布",
  状态未同步: "未同步",
};

function glanceNode(video) {
  if (!state.apiOk) return null;
  const box = el("div", "glance");
  const add = (label, value) => {
    if (typeof value !== "number") return;
    const cell = el("div", "glance-cell");
    cell.append(el("span", "glance-k", label), el("span", "glance-v", formatNum(value)));
    box.append(cell);
  };
  add("播放", video.stats?.views);
  add("赞", video.stats?.likes);
  return box.childElementCount ? box : null;
}

function togglePanel(id, panel) {
  rememberDrafts();
  const same = state.open?.id === id && state.open?.panel === panel;
  if (state.flash && (state.flash.id !== id || panel !== "link")) state.flash = null;
  if (same) {
    state.open = null;
    renderList();
    return;
  }
  state.open = { id, panel, lang: state.open?.id === id ? state.open.lang || "th" : "th" };
  renderList({ reveal: true });
  if (panel === "link") {
    document.querySelector(`[data-job="${CSS.escape(id)}"] .publish-form input`)?.focus();
  }
}

function setOpenLang(id, lang) {
  if (!state.open || state.open.id !== id) return;
  state.open = { ...state.open, lang };
  renderList();
}

function segButton(label, pressed, onClick, extraClass, expanded) {
  const button = el("button", ["seg", extraClass, pressed ? "on" : ""].filter(Boolean).join(" "), label);
  button.type = "button";
  if (expanded) button.setAttribute("aria-expanded", pressed ? "true" : "false");
  else button.setAttribute("aria-pressed", pressed ? "true" : "false");
  button.addEventListener("click", onClick);
  return button;
}

function renderCopyBody(label, text, copyLabel, extraButton) {
  const block = el("div", "copy-block");
  block.append(el("div", "copy-label", label));
  if (text) {
    const pre = el("pre", "copy-text");
    pre.textContent = text;
    const row = el("div", "links");
    row.append(copyButton(copyLabel, text));
    if (extraButton) row.append(extraButton);
    block.append(pre, row);
  } else {
    block.append(el("p", "muted", "文案还没写进看板。可以先打开网盘里的文案文件。"));
  }
  return block;
}

function renderCopyPanel(video) {
  const panel = el("div", "panel");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "文案");
  const instagram = instagramBlock(video);
  const lang = instagram && state.open?.lang === "en" ? "en" : "th";
  if (instagram) {
    const switcher = el("div", "lang-switch");
    switcher.append(
      segButton("泰语 TikTok", lang === "th", () => setOpenLang(video.job_id, "th")),
      segButton("英语 Instagram", lang === "en", () => setOpenLang(video.job_id, "en")),
    );
    panel.append(switcher);
  }
  if (lang === "en") {
    const fullText = instagramCopyText(instagram);
    const tags = instagram.hashtags ? copyButton("只复制标签", instagram.hashtags) : null;
    const body = renderCopyBody(
      instagram.revision ? `英文文案 · ${instagram.revision}` : "英文文案",
      fullText,
      "复制文案",
      tags,
    );
    const pre = body.querySelector(".copy-text");
    if (pre) pre.lang = "en";
    panel.append(body);
    const file = linkButton(instagram.drive_publish_copy, "打开英文文案文件", false);
    if (file) panel.append(file);
  } else {
    panel.append(
      renderCopyBody(video.revision ? `泰语文案 · ${video.revision}` : "泰语文案", video.publish_copy, "复制文案"),
    );
    const file = linkButton(video.drive_publish_copy, "打开文案文件", false);
    if (!video.publish_copy && file) panel.append(file);
  }
  return panel;
}

function fileGroup(title, buttons) {
  const group = el("div", "file-group");
  group.append(el("div", "copy-label", title));
  appendLinks(group, buttons);
  if (!group.querySelector(".links")) group.append(el("p", "muted", "还没有可下载的文件。"));
  return group;
}

function renderFilesPanel(video) {
  const panel = el("div", "panel");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "下载");
  panel.append(
    fileGroup("TikTok 泰语", [
      linkButton(downloadUrl(video.drive_video_download, video.drive_video), "下载视频", true),
      linkButton(downloadUrl(video.drive_cover_download, video.drive_cover), "下载封面", true),
      linkButton(video.drive_video, "打开视频", false),
      linkButton(video.drive_cover, "打开封面", false),
      linkButton(video.drive_publish_copy, "文案文件", false),
      linkButton(video.drive_folder, "打开文件夹", false),
    ]),
  );
  const instagram = instagramBlock(video);
  if (instagram) {
    panel.append(
      fileGroup("Instagram 英语", [
        linkButton(instagram.drive_video_download, "下载视频", true),
        linkButton(instagram.drive_cover_download, "下载封面", true),
        linkButton(instagram.drive_video, "打开视频", false),
        linkButton(instagram.drive_cover, "打开封面", false),
        linkButton(instagram.drive_publish_copy, "文案文件", false),
      ]),
    );
  }
  return panel;
}

function renderStatsPanel(video) {
  const panel = el("div", "panel");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "数据");
  const metrics = el("div", "metrics");
  metrics.append(
    metric("播放", video.stats?.views),
    metric("点赞", video.stats?.likes),
    metric("评论", video.stats?.comments),
    metric("分享", video.stats?.shares),
    metric("收藏", video.stats?.saves),
  );
  panel.append(metrics, el("div", "muted stat-time", statTimeText(video.stats?.updated_at, state.apiOk)));
  return panel;
}

function renderLinkPanel(video) {
  const panel = el("div", "panel");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "发布链接");
  const published = Boolean(video.publish_link);
  if (state.flash?.id === video.job_id) {
    panel.append(el("div", state.flash.tone === "ok" ? "form-msg ok" : "form-msg", state.flash.text));
  }
  if (published) {
    const row = el("div", "published-link");
    row.append(el("span", "muted", state.apiOk ? "当前链接" : "底稿里的链接（还没和回填服务核对）"));
    const anchor = linkButton(video.publish_link, video.publish_link, false);
    if (anchor) {
      anchor.classList.add("post-link");
      row.append(anchor);
    }
    panel.append(row);
    if (video.published_at) panel.append(el("div", "muted", `提交于 ${video.published_at}`));
    panel.append(el("div", "copy-label", "要换链接时再填下面"));
  } else if (state.apiOk) {
    panel.append(el("div", "copy-label", "发出去之后，把 TikTok 链接贴在这里"));
  }
  renderPublishForm(video, panel);
  return panel;
}

function renderCard(video) {
  const published = Boolean(video.publish_link);
  const tone = !state.apiOk ? "unsynced" : published ? "ok" : "wait";
  const open = state.open?.id === video.job_id ? state.open.panel : "";
  const card = el(
    "article",
    ["item", `item-${tone}`, open ? "open" : "", state.justId === video.job_id ? "just" : ""].filter(Boolean).join(" "),
  );
  card.dataset.job = video.job_id || "";

  const top = el("div", "item-top");
  const badgeInfo = badgePresentation(video, state.apiOk);
  const badge = el("span", badgeInfo.className, SHORT_BADGE[badgeInfo.text] || badgeInfo.text);
  if (SHORT_BADGE[badgeInfo.text]) badge.title = badgeInfo.text;
  const titleWrap = el("div", "title-wrap");
  const displayTitle = video.title || video.folder_title || video.label || "未命名";
  const name = el("h2", "title-line", displayTitle);
  name.title = displayTitle;
  const metaRow = el("div", "meta-row");
  metaRow.append(metaBits(video));
  const segs = el("div", "segs");
  const actions = [
    ["copy", "文案", ""],
    ["files", "下载", ""],
    ["stats", "数据", ""],
    ["link", published ? "改链接" : "填链接", published ? "" : "emphasis"],
  ];
  for (const [id, label, extra] of actions) {
    segs.append(segButton(label, open === id, () => togglePanel(video.job_id, id), extra, true));
  }
  metaRow.append(segs);
  titleWrap.append(name, metaRow);
  top.append(badge, titleWrap);

  const aside = el("div", "aside");
  const glance = glanceNode(video);
  if (glance) aside.append(glance);
  if (published) {
    const post = linkButton(video.publish_link, "打开帖子", false);
    if (post) {
      post.classList.remove("btn");
      post.classList.add("text-link");
      aside.append(post);
    }
  }
  if (aside.childElementCount) top.append(aside);
  card.append(top);

  if (open === "copy") card.append(renderCopyPanel(video));
  if (open === "files") card.append(renderFilesPanel(video));
  if (open === "stats") card.append(renderStatsPanel(video));
  if (open === "link") card.append(renderLinkPanel(video));
  return card;
}

function updateCount(shownCount) {
  const node = document.querySelector("#filters .count");
  if (!node) return;
  node.textContent = state.query.trim() ? (shownCount ? `找到 ${shownCount} 条` : "没有找到") : "";
}

function renderList({ reveal = false } = {}) {
  rememberDrafts();
  const list = $("#list");
  const shown = visibleVideos(mergedVideos());
  updateCount(shown.length);
  list.replaceChildren();
  if (!shown.length) {
    const query = state.query.trim();
    list.append(
      el(
        "p",
        "empty",
        query
          ? `没有找到「${query.slice(0, 40)}」。换个词，或点搜索框里的 ×。`
          : emptyListMessage(state.filter, { synced: state.apiOk, configured: Boolean(state.apiBase) }),
      ),
    );
    return;
  }
  const waitingFirst = [...shown].sort((a, b) => Number(Boolean(a.publish_link)) - Number(Boolean(b.publish_link)));
  for (const video of waitingFirst) list.append(renderCard(video));
  const revealId = reveal && state.open ? state.open.id : "";
  if (revealId) {
    const card = list.querySelector(`[data-job="${CSS.escape(revealId)}"]`);
    (card?.querySelector(".panel") || card)?.scrollIntoView({ block: "nearest" });
  }
  if (state.pinJust && state.justId) {
    state.pinJust = false;
    list.querySelector(`[data-job="${CSS.escape(state.justId)}"]`)?.scrollIntoView({ block: "nearest" });
  }
  if (state.justId) {
    const marked = state.justId;
    window.setTimeout(() => {
      if (state.justId !== marked) return;
      state.justId = "";
      document.querySelector(`[data-job="${CSS.escape(marked)}"]`)?.classList.remove("just");
    }, 1600);
  }
}

function renderToast() {
  const existing = $("#toast");
  if (!state.toast) {
    existing?.remove();
    return;
  }
  const toast = existing || el("div", "toast");
  toast.id = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = state.toast;
  if (!existing) $("#list").before(toast);
}

function render() {
  if (!state.catalog) return;
  const summary = summarize(mergedVideos());
  state.summary = summary;
  $("#subtitle").textContent = state.catalog.updated_at ? `目录 ${catalogTime(state.catalog.updated_at)}` : "";
  renderSyncAlert();
  renderSummary(summary);
  renderBanner();
  renderFilters(summary);
  renderToast();
  renderList();
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.open) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  state.open = null;
  renderList();
});

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
