#!/usr/bin/env bash
set -euo pipefail

INTERVAL="${INTERVAL:-3}"
RUN_INITIAL="${RUN_INITIAL:-0}"
LOCK_DIR="${TMPDIR:-/tmp}/leai-recruiting-watch-deploy.lock"
WATCH_PATHS=(
  "server"
  "src"
  "scripts"
  ".github"
  "index.html"
  "package.json"
  "package-lock.json"
  "vite.config.js"
  "ecosystem.config.cjs"
  "README.md"
)

fingerprint() {
  find "${WATCH_PATHS[@]}" \
    -type f \
    ! -path '*/node_modules/*' \
    ! -path '*/dist/*' \
    ! -path '*/data/*' \
    -print0 2>/dev/null |
    sort -z |
    xargs -0 shasum 2>/dev/null |
    shasum |
    awk '{print $1}'
}

last="$(fingerprint)"
echo "Watching local recruiting workbench changes. Press Ctrl+C to stop."

run_deploy() {
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "A deploy is already running; skip this tick."
    return 1
  fi
  if ./scripts/deploy-server.sh; then
    rmdir "$LOCK_DIR"
    return 0
  fi
  local status=$?
  rmdir "$LOCK_DIR"
  return "$status"
}

if [[ "$RUN_INITIAL" == "1" ]]; then
  run_deploy
fi

while true; do
  sleep "$INTERVAL"
  current="$(fingerprint)"
  if [[ "$current" != "$last" ]]; then
    echo "Change detected at $(date '+%Y-%m-%d %H:%M:%S'), deploying..."
    if run_deploy; then
      last="$current"
    else
      echo "Deploy failed; waiting for next change." >&2
    fi
  fi
done
