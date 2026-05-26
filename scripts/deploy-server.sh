#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-chenbaike@43.160.195.171}"
REMOTE_DIR="${REMOTE_DIR:-/opt/projects/leai-recruiting}"
BASE_PATH="${VITE_BASE_PATH:-/recruiting/}"
RSYNC_EXCLUDES=(
  --exclude '.DS_Store'
  --exclude '.git'
  --exclude '.env'
  --exclude 'node_modules'
  --exclude 'data/uploads'
  --exclude 'data/lark-downloads'
  --exclude 'data/outbox'
  --exclude 'artifacts'
)

if [[ "${SYNC_DATA:-0}" != "1" ]]; then
  RSYNC_EXCLUDES+=(--exclude 'data/recruiting.json')
fi

npm run build -- --base "$BASE_PATH"

ssh "$REMOTE" "mkdir -p '$REMOTE_DIR'"

rsync -az --delete \
  "${RSYNC_EXCLUDES[@]}" \
  ./ "$REMOTE:$REMOTE_DIR/"

ssh "$REMOTE" "cd '$REMOTE_DIR' && npm ci --omit=dev && pm2 startOrReload ecosystem.config.cjs --only leai-recruiting && pm2 save"

echo "Deployed to https://new.leaibot.cn/recruiting/"
