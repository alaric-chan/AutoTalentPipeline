#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.leai.recruiting.watch-deploy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/leai-recruiting"
OUT_LOG="$LOG_DIR/watch-deploy.out.log"
ERR_LOG="$LOG_DIR/watch-deploy.err.log"
INTERVAL="${INTERVAL:-3}"
RUN_INITIAL="${RUN_INITIAL:-0}"
REMOTE="${REMOTE:-chenbaike@43.160.195.171}"
REMOTE_DIR="${REMOTE_DIR:-/opt/projects/leai-recruiting}"

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"

if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "mkdir -p '$REMOTE_DIR' && echo ssh-ok" >/dev/null; then
  echo "Cannot connect to $REMOTE. Please check SSH key/network before enabling sync." >&2
  exit 1
fi

xml_escape() {
  sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\&apos;/g"
}

COMMAND="cd '$ROOT' && INTERVAL='$INTERVAL' RUN_INITIAL='$RUN_INITIAL' REMOTE='$REMOTE' REMOTE_DIR='$REMOTE_DIR' npm run deploy:watch"
ESCAPED_COMMAND="$(printf '%s' "$COMMAND" | xml_escape)"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>$ESCAPED_COMMAND</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(printf '%s' "$ROOT" | xml_escape)</string>
  <key>StandardOutPath</key>
  <string>$(printf '%s' "$OUT_LOG" | xml_escape)</string>
  <key>StandardErrorPath</key>
  <string>$(printf '%s' "$ERR_LOG" | xml_escape)</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/$LABEL" >/dev/null 2>&1 || true

echo "Local-to-server auto sync is ON."
echo "Project: $ROOT"
echo "Remote:  $REMOTE:$REMOTE_DIR"
echo "Logs:    $OUT_LOG"
echo "Status:  npm run sync:status"
echo "Stop:    npm run sync:off"
