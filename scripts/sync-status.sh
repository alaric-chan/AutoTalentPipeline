#!/usr/bin/env bash
set -euo pipefail

LABEL="com.leai.recruiting.watch-deploy"
LOG_DIR="$HOME/Library/Logs/leai-recruiting"
OUT_LOG="$LOG_DIR/watch-deploy.out.log"
ERR_LOG="$LOG_DIR/watch-deploy.err.log"

if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
  echo "Status: ON"
else
  echo "Status: OFF"
fi

echo "Label:  $LABEL"
echo "Logs:   $OUT_LOG"

if [[ -f "$OUT_LOG" ]]; then
  echo
  echo "Last output:"
  tail -n 20 "$OUT_LOG"
fi

if [[ -s "$ERR_LOG" ]]; then
  echo
  echo "Last errors:"
  tail -n 20 "$ERR_LOG"
fi
