import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  badgePresentation,
  classifySyncError,
  emptyListMessage,
  filterChips,
  metricText,
  publishBlock,
  statTimeText,
  summaryCells,
  syncAlertModel,
  UNSYNCED_TEXT,
} from "../sync-status.js";

function formatNum(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("en-US");
}

const draftSummary = {
  total: 15,
  waiting_manual_publish: 15,
  published_with_link: 0,
  views: null,
  likes: null,
  comments: null,
};

function section(model, label) {
  return model.sections.find((item) => item.label === label);
}

function joined(model) {
  return [model.title, ...model.sections.map((item) => item.body), model.raw].join("\n");
}

test("network failure explains the outage, the incomplete counts, and what to do", () => {
  for (const raw of [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ]) {
    const failure = classifySyncError(raw);
    assert.equal(failure.kind, "network");
    assert.equal(failure.raw, raw);
    const model = syncAlertModel({ apiBase: "https://worker.example", apiOk: false, apiError: raw });
    assert.equal(model.kind, "network");
    assert.equal(model.tone, "error");
    assert.equal(model.role, "alert");
    assert.equal(model.retry, true);
    assert.equal(model.title, "没连上回填服务");
    assert.match(section(model, "出了什么问题").body, /4G/);
    assert.match(section(model, "出了什么问题").body, /服务本身可能是好的/);
    assert.match(section(model, "现在会怎样").body, /已发布/);
    assert.match(section(model, "现在会怎样").body, /发布链接/);
    assert.match(section(model, "现在会怎样").body, /播放/);
    assert.match(section(model, "现在会怎样").body, /点赞/);
    assert.match(section(model, "现在会怎样").body, /评论/);
    assert.match(section(model, "现在会怎样").body, /待发布/);
    assert.match(section(model, "现在会怎样").body, /偏多/);
    assert.match(section(model, "现在会怎样").body, /数据丢了/);
    assert.match(section(model, "现在会怎样").body, /下载和文案仍可用/);
    assert.match(section(model, "建议").body, /Wi‑Fi/);
    assert.match(section(model, "建议").body, /代理/);
    assert.match(section(model, "建议").body, /重试/);
    assert.match(section(model, "建议").body, /刷新/);
    assert.match(section(model, "建议").body, /重复提交/);
    assert.match(section(model, "建议").body, /John/);
    assert.equal(model.raw, raw);
    assert.doesNotMatch(section(model, "出了什么问题").body, /数据丢了/);
  }
});

test("health, state, and write-disabled failures stay distinct and keep the raw error", () => {
  const health404 = classifySyncError("health 404");
  assert.equal(health404.kind, "health");
  assert.match(health404.problem, /HTTP 404/);
  assert.match(health404.problem, /地址不对/);
  assert.doesNotMatch(health404.problem, /服务自己出错/);

  const health503 = classifySyncError("health 503");
  assert.equal(health503.kind, "health");
  assert.match(health503.problem, /HTTP 503/);
  assert.match(health503.problem, /服务自己出错/);

  const state400 = classifySyncError("state 400");
  assert.equal(state400.kind, "state");
  assert.match(state400.problem, /HTTP 400/);
  assert.match(state400.problem, /发布状态/);
  assert.match(state400.problem, /拿不到/);

  const state500 = classifySyncError("state 500");
  assert.equal(state500.kind, "state");
  assert.match(state500.problem, /HTTP 500/);
  assert.match(state500.problem, /服务出错/);

  const writeOff = classifySyncError("write disabled");
  assert.equal(writeOff.kind, "write_disabled");
  assert.match(writeOff.problem, /写入被关掉/);
  assert.equal(writeOff.raw, "write disabled");

  for (const raw of ["health 503", "state 400", "write disabled", "Unexpected token <"]) {
    const model = syncAlertModel({ apiBase: "https://worker.example", apiOk: false, apiError: raw });
    assert.equal(model.retry, true);
    assert.equal(model.tone, "error");
    assert.equal(model.raw, raw.trim() || raw);
    assert.match(joined(model), /下载和文案仍可用/);
    assert.match(section(model, "建议").body, /截图发给 John/);
    assert.notEqual(section(model, "出了什么问题").body, raw);
  }
});

test("unknown errors still show a banner instead of a bare technical string", () => {
  const model = syncAlertModel({ apiBase: "https://worker.example", apiOk: false, apiError: "" });
  assert.equal(model.kind, "other");
  assert.equal(model.raw, "error");
  assert.match(section(model, "出了什么问题").body, /意外错误/);
  assert.equal(model.retry, true);
});

test("missing apiBase is a configuration problem, not a connection failure", () => {
  const model = syncAlertModel({ apiBase: "", apiOk: false, apiError: "Failed to fetch" });
  assert.equal(model.kind, "unconfigured");
  assert.equal(model.tone, "config");
  assert.equal(model.role, "status");
  assert.equal(model.retry, false);
  assert.equal(model.raw, "");
  assert.match(model.title, /还没配置/);
  assert.match(section(model, "出了什么问题").body, /apiBase/);
  assert.match(section(model, "出了什么问题").body, /不是网络/);
  assert.match(section(model, "现在会怎样").body, /底稿/);
  assert.match(section(model, "现在会怎样").body, /下载和文案仍可用/);
  assert.match(section(model, "建议").body, /发给 John/);
  assert.match(section(model, "建议").body, /换网络没有用/);
  assert.doesNotMatch(section(model, "建议").body, /重试/);
  assert.equal(syncAlertModel({ apiBase: "https://worker.example", apiOk: true, apiError: "" }), null);
});

test("worker-dependent summary numbers and filters are not shown as final when unsynced", () => {
  const cells = summaryCells(draftSummary, false, formatNum);
  assert.deepEqual(
    cells.map((cell) => cell.value),
    ["15", UNSYNCED_TEXT, UNSYNCED_TEXT, UNSYNCED_TEXT, UNSYNCED_TEXT, UNSYNCED_TEXT],
  );
  assert.deepEqual(
    cells.map((cell) => cell.unsynced),
    [false, true, true, true, true, true],
  );
  assert.equal(cells.find((cell) => cell.key === "waiting").value.includes("15"), false);
  assert.equal(cells.find((cell) => cell.key === "published").value.includes("0"), false);

  const chips = filterChips(draftSummary, false);
  assert.equal(chips[0].label, "全部 15");
  assert.equal(chips[0].unsynced, false);
  assert.equal(chips[1].label, "待发布 未同步");
  assert.equal(chips[2].label, "已发布 未同步");
  assert.equal(/\d/.test(chips[1].label), false);
  assert.equal(/\d/.test(chips[2].label), false);

  const synced = summaryCells(
    { ...draftSummary, waiting_manual_publish: 8, published_with_link: 7, likes: 12, comments: 0 },
    true,
    formatNum,
  );
  assert.deepEqual(
    synced.map((cell) => cell.value),
    ["15", "8", "7", "—", "12", "0"],
  );
  assert.equal(synced.some((cell) => cell.unsynced), false);
  assert.deepEqual(
    filterChips({ total: 15, waiting_manual_publish: 8, published_with_link: 7 }, true).map((chip) => chip.label),
    ["全部 15", "待发布 8", "已发布 7"],
  );
});

test("card badge, metrics, and the submit form follow the sync state", () => {
  const waiting = { stage: "WAITING_MANUAL_PUBLISH", publish_link: "" };
  const published = { stage: "PUBLISHED", publish_link: "https://www.tiktok.com/@moo/video/1" };
  assert.deepEqual(badgePresentation(waiting, false), { className: "badge unsynced", text: "状态未同步" });
  assert.deepEqual(badgePresentation(published, false), { className: "badge unsynced", text: "状态未同步" });
  assert.equal(badgePresentation(waiting, true).text, "待手动发布");
  assert.equal(badgePresentation(published, true).text, "已发布");

  assert.equal(metricText(1200, false, formatNum), UNSYNCED_TEXT);
  assert.equal(metricText(null, true, formatNum), "—");
  assert.equal(metricText(1200, true, formatNum), "1,200");
  assert.equal(statTimeText("2026-10-12T00:00:00Z", false), "播放数据未同步");
  assert.equal(statTimeText("", true), "数据更新 —");
  assert.equal(statTimeText("2026-10-12T00:00:00Z", true), "数据更新 2026-10-12T00:00:00Z");

  const offline = publishBlock("https://worker.example");
  const unconfigured = publishBlock("");
  assert.match(offline.text, /先别提交/);
  assert.match(offline.text, /重试/);
  assert.match(offline.text, /不要重复提交/);
  assert.match(unconfigured.text, /还没配置/);
  assert.match(unconfigured.text, /发给 John/);
  assert.doesNotMatch(unconfigured.text, /重试/);
  assert.notEqual(offline.text, unconfigured.text);

  assert.match(emptyListMessage("published", { synced: false, configured: true }), /不代表还没有人发过/);
  assert.match(emptyListMessage("published", { synced: false, configured: false }), /还没配置/);
  assert.doesNotMatch(emptyListMessage("published", { synced: false, configured: false }), /重试/);
  assert.equal(emptyListMessage("all", { synced: true, configured: true }), "这个筛选下没有成片。");
});

test("the page places a sync alert above the stats and no longer buries the fetch error", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const alertAt = html.indexOf('id="sync-alert"');
  const summaryAt = html.indexOf('id="summary"');
  const noteAt = html.indexOf('id="banner"');
  assert.ok(alertAt > 0, "sync alert mount is missing");
  assert.ok(alertAt < summaryAt, "sync alert must render above the stat cards");
  assert.ok(summaryAt < noteAt, "stat cards stay above the yellow instructions");
  assert.match(html, /\.sync-alert\b/);
  assert.match(html, /\.card\.unsynced\b/);
  assert.match(html, /\.badge\.unsynced\b/);
  assert.match(html, /\.chip\.unsynced\b/);
  assert.match(html, /\.sync-form-note\b/);

  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.equal(app.includes("回填服务连不上（"), false);
  assert.match(app, /syncAlertModel/);
  assert.match(app, /summaryCells/);
  assert.match(app, /retrySync/);
  assert.match(app, /publishBlock/);
});
