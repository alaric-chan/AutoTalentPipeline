#!/usr/bin/env bash
set -euo pipefail

message="${1:-}"

if [[ -z "$message" ]]; then
  echo "Usage: npm run publish -- \"describe what changed\"" >&2
  exit 1
fi

if git diff --quiet && git diff --cached --quiet; then
  echo "No local code changes to publish."
  exit 0
fi

npm run build

git add .

if git grep --cached -n -E 'sk-[A-Za-z0-9_-]{16,}|APP_AUTH_TOKEN=[^[:space:]]{8,}|BAILIAN_API_KEY=sk-|MS_CLIENT_SECRET=[^[:space:]]{8,}|LARK_BASE_TOKEN=[A-Za-z0-9]{8,}|INTERVIEW_SPREADSHEET_TOKEN=[A-Za-z0-9]{8,}' -- . ':!*.md' ':!.env.example' ':!scripts/publish.sh' >/tmp/leai-recruiting-secret-scan.log 2>/dev/null; then
  echo "Potential secret found in staged files. Publish stopped." >&2
  cat /tmp/leai-recruiting-secret-scan.log >&2
  exit 1
fi

if git diff --cached --quiet; then
  echo "No publishable code changes after applying .gitignore."
  exit 0
fi

git commit -m "$message"
git push

echo "Published to GitHub. GitHub Actions will deploy to the server when deployment secrets are configured."
