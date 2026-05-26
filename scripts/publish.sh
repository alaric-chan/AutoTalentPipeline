#!/usr/bin/env bash
set -euo pipefail

message="${1:-}"

if [[ -z "$message" ]]; then
  echo "Usage: npm run publish -- \"describe what changed\"" >&2
  exit 1
fi

if [[ -z "$(git status --porcelain)" ]]; then
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

echo "Published to GitHub."

remote="$(git remote get-url origin)"
branch="$(git branch --show-current)"
repo=""
if [[ "$remote" =~ github.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
  repo="${BASH_REMATCH[1]}"
fi

if [[ -n "$repo" && -n "$branch" ]] && command -v gh >/dev/null 2>&1; then
  echo "Waiting for GitHub Actions to finish deploying..."
  sleep 3
  run_id="$(gh run list -R "$repo" --branch "$branch" --event push --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  if [[ -n "$run_id" && "$run_id" != "null" ]]; then
    gh run watch "$run_id" -R "$repo" --exit-status
  else
    echo "No push-triggered GitHub Actions run found."
  fi
else
  echo "GitHub Actions watch skipped. Install/login gh to wait for deployment status."
fi
