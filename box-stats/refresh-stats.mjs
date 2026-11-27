#!/usr/bin/env node
/**
 * Refresh TikTok counts for every bound video, from this machine's network.
 *
 *   MOO_ADMIN_TOKEN=... node box-stats/refresh-stats.mjs [--dry-run] [--only job-...]
 *
 * Exit: 0 all ok, 3 some failed, 4 all failed, 2 setup problem (no token, Worker unreachable).
 * The token is read from the environment (or MOO_ADMIN_TOKEN_FILE) and never printed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, runRefresh } from "./lib/refresh.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_API = "https://moo-type-publish.pkqiang49.workers.dev";
const DEFAULT_CATALOG_URL = "https://easyaitech.github.io/moo-type-publish-catalog/catalog.json";

function parseArgs(argv) {
  const args = { only: [], dryRun: false, embedFallback: true, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      i += 1;
      return argv[i];
    };
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--only") args.only.push(next());
    else if (flag === "--api") args.api = next();
    else if (flag === "--catalog") args.catalog = next();
    else if (flag === "--account") args.account = next();
    else if (flag === "--log-dir") args.logDir = next();
    else if (flag === "--save-failed-html") args.saveFailedHtml = next();
    else if (flag === "--no-embed-fallback") args.embedFallback = false;
    else if (flag === "--delay-ms") args.delayMs = Number(next());
    else if (flag === "--quiet") args.quiet = true;
    else if (flag === "--token") throw new Error("pass the token via MOO_ADMIN_TOKEN, not argv");
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

function readToken() {
  const direct = process.env.MOO_ADMIN_TOKEN || "";
  if (direct) return direct.trim();
  const file = process.env.MOO_ADMIN_TOKEN_FILE || "";
  if (file && fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return "";
}

async function loadJobIds(source) {
  let catalog;
  if (/^https:\/\//.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (!response.ok) throw new Error(`catalog_http_${response.status}`);
    catalog = await response.json();
  } else {
    catalog = JSON.parse(fs.readFileSync(source, "utf8"));
  }
  const videos = Array.isArray(catalog?.videos) ? catalog.videos : [];
  return videos.map((video) => String(video?.job_id || "")).filter(Boolean);
}

async function jobIdsFrom(args) {
  if (args.catalog) return loadJobIds(args.catalog);
  try {
    return await loadJobIds(DEFAULT_CATALOG_URL);
  } catch {
    return loadJobIds(path.join(HERE, "..", "catalog.json"));
  }
}

function shortLine(entry) {
  if (entry.status === "ok") {
    const c = entry.counts;
    const via = entry.page === "embed" ? ` via embed (main: ${entry.fallback_from})` : "";
    return `ok     ${entry.id} views=${c.views} likes=${c.likes} comments=${c.comments} shares=${c.shares}` +
      `${c.saves === undefined ? "" : ` saves=${c.saves}`}${via}${entry.written ? "" : " [not written]"}`;
  }
  const bits = [entry.reason];
  if (entry.detail) bits.push(entry.detail);
  if (entry.status_code !== undefined) bits.push(`status_code=${entry.status_code}`);
  if (entry.http_status) bits.push(`http=${entry.http_status}`);
  if (entry.markers) bits.push(`markers=${entry.markers.join("+")}`);
  if (entry.title) bits.push(`title="${entry.title}"`);
  if (entry.tried) bits.push(`tried=${entry.tried.join(",")}`);
  return `failed ${entry.id} ${bits.join(" ")}`;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const apiBase = String(args.api || process.env.MOO_API_BASE || DEFAULT_API).replace(/\/+$/, "");
  const token = readToken();
  if (!args.dryRun && token.length < 12) {
    console.error("MOO_ADMIN_TOKEN (or MOO_ADMIN_TOKEN_FILE) is missing; use --dry-run to only read.");
    process.exit(2);
  }

  let jobIds;
  try {
    jobIds = args.only.length ? args.only : await jobIdsFrom(args);
  } catch (err) {
    console.error(`could not read the catalog: ${err.message}`);
    process.exit(2);
  }

  let saveHtml;
  if (args.saveFailedHtml) {
    fs.mkdirSync(args.saveFailedHtml, { recursive: true });
    saveHtml = (id, kind, html) => {
      fs.writeFileSync(path.join(args.saveFailedHtml, `${id}.${kind}.html`), html);
    };
  }

  let summary;
  try {
    summary = await runRefresh(
      {
        apiBase,
        token,
        jobIds,
        dryRun: args.dryRun,
        account: args.account || process.env.MOO_TIKTOK_ACCOUNT || "",
        embedFallback: args.embedFallback,
        delayMs: Number.isFinite(args.delayMs) ? args.delayMs : DEFAULTS.delayMs,
        saveHtml,
      },
      {
        fetch: globalThis.fetch,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        random: Math.random,
      },
    );
  } catch (err) {
    const reason = err && typeof err.message === "string" && /^[a-z_0-9]{3,40}$/.test(err.message)
      ? err.message
      : "state_unreachable";
    console.error(`could not read bound links from the Worker: ${reason}`);
    process.exit(2);
  }

  summary.dry_run = args.dryRun;
  summary.proxy_env = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy) &&
    process.env.NODE_USE_ENV_PROXY === "1";
  if (!args.quiet) for (const entry of summary.results) console.log(shortLine(entry));
  const reasons = Object.entries(summary.reasons).map(([key, n]) => `${key}:${n}`).join(",");
  console.log(
    `targets=${summary.targets} ok=${summary.ok} failed=${summary.failed} ` +
      `skipped_no_link=${summary.skipped_no_link}${reasons ? ` reasons=${reasons}` : ""}` +
      `${args.dryRun ? " (dry-run, nothing written)" : ""}`,
  );
  if (args.logDir) {
    fs.mkdirSync(args.logDir, { recursive: true });
    const day = summary.at.slice(0, 10);
    fs.appendFileSync(path.join(args.logDir, `stats-${day}.jsonl`), `${JSON.stringify(summary)}\n`);
  }
  if (summary.failed === 0) process.exit(0);
  process.exit(summary.ok === 0 ? 4 : 3);
}

main();
