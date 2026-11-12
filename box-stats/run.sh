#!/usr/bin/env bash
# Daily TikTok stats backfill on the assistant machine.
# Reads settings from box-stats/.env (or $MOO_BOX_ENV), never from argv, and appends
# one JSON line per run to box-stats/logs/stats-YYYY-MM-DD.jsonl.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${MOO_BOX_ENV:-$HERE/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Node's fetch ignores HTTPS_PROXY unless this is set (Node >= 22.21 / 24.5).
if [[ -n "${HTTPS_PROXY:-${https_proxy:-}}" && -z "${NODE_USE_ENV_PROXY:-}" ]]; then
  export NODE_USE_ENV_PROXY=1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed (need Node 20 or newer)" >&2
  exit 2
fi

exec node "$HERE/refresh-stats.mjs" --log-dir "${MOO_BOX_LOG_DIR:-$HERE/logs}" "$@"
