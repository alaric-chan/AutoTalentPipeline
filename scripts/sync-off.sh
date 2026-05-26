#!/usr/bin/env bash
set -euo pipefail

LABEL="com.leai.recruiting.watch-deploy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"

echo "Local-to-server auto sync is OFF."
