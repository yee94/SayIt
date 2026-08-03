#!/usr/bin/env bash
# Publish one Sparkle release item into deploy/sparkle-update-service and
# deploy/redeploy the static site on EdgeOne.
#
# Required env:
#   VERSION, TAG, CHANNEL (stable|beta), GITHUB_REPOSITORY
# Optional env:
#   SPARKLE_ED_SIGNATURE, SPARKLE_ED_LENGTH
#   EDGEONE_API_TOKEN
#   EDGEONE_PROJECT_NAME (default sayit-sparkle-update)
#   EDGEONE_PROJECT_ID (default makers-2gtkiwcbcdiw)
#   EDGEONE_DEPLOY_MODE: github | upload  (default github for GitHub-connected project)
#   EDGEONE_PUBLIC_FEED_BASE (default https://sayit-update.xiaobe.top)
#   EDGEONE_ENV (default production)
#   RELEASE_BUILD_NUMBER, RELEASE_NOTES_HTML, PUBLISHED_AT, RELEASE_URL
#   EDGEONE_REPO_BRANCH (default main; GitHub-connected feed branch — do not change)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_DIR="$ROOT/deploy/sparkle-update-service"

VERSION="${VERSION:?VERSION is required}"
TAG="${TAG:?TAG is required}"
CHANNEL="${CHANNEL:-stable}"
if [[ "$CHANNEL" != "stable" && "$CHANNEL" != "beta" ]]; then
  if [[ "$VERSION" == *-* ]]; then
    CHANNEL="beta"
  else
    CHANNEL="stable"
  fi
fi

GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-yee94/SayIt}"
EDGEONE_PROJECT_NAME="${EDGEONE_PROJECT_NAME:-sayit-sparkle-update}"
EDGEONE_PROJECT_ID="${EDGEONE_PROJECT_ID:-makers-2gtkiwcbcdiw}"
EDGEONE_DEPLOY_MODE="${EDGEONE_DEPLOY_MODE:-github}"
EDGEONE_ENV="${EDGEONE_ENV:-production}"
EDGEONE_PUBLIC_FEED_BASE="${EDGEONE_PUBLIC_FEED_BASE:-https://sayit-update.xiaobe.top}"
EDGEONE_API_BASE="${EDGEONE_API_BASE:-https://pages-api.edgeone.ai/v1}"
# GitHub-connected EdgeOne feed is always built from main.
EDGEONE_REPO_BRANCH="${EDGEONE_REPO_BRANCH:-main}"

ZIP_NAME="SayIt-${VERSION}-macOS.zip"
ZIP_URL="${ZIP_URL:-https://github.com/${GITHUB_REPOSITORY}/releases/download/${TAG}/${ZIP_NAME}}"
RELEASE_URL="${RELEASE_URL:-https://github.com/${GITHUB_REPOSITORY}/releases/tag/${TAG}}"
PUBLISHED_AT="${PUBLISHED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
RELEASE_NOTES_HTML="${RELEASE_NOTES_HTML:-<p>SayIt ${VERSION}</p>}"

if [[ -z "${RELEASE_BUILD_NUMBER:-}" ]]; then
  if [[ "$VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    MAJOR="${BASH_REMATCH[1]}"
    MINOR="${BASH_REMATCH[2]}"
    PATCH="${BASH_REMATCH[3]}"
    RELEASE_BUILD_NUMBER=$((MAJOR * 100000000 + MINOR * 100000 + PATCH * 100 + 99))
  else
    echo "::error::Unable to derive RELEASE_BUILD_NUMBER from VERSION=$VERSION"
    exit 1
  fi
fi

LENGTH="${SPARKLE_ED_LENGTH:-}"
if [[ -z "$LENGTH" && -n "${ZIP_PATH:-}" && -f "${ZIP_PATH}" ]]; then
  LENGTH="$(wc -c <"$ZIP_PATH" | tr -d ' ')"
fi
if [[ -z "$LENGTH" ]]; then
  echo "::warning::SPARKLE_ED_LENGTH missing; using 0 (Sparkle install will fail until length/signature are published)."
  LENGTH="0"
fi

ED_SIGNATURE="${SPARKLE_ED_SIGNATURE:-}"
if [[ -z "$ED_SIGNATURE" ]]; then
  echo "::warning::SPARKLE_ED_SIGNATURE missing; publishing appcast without edSignature."
fi

# For GitHub-connected deploy: land channel manifests on main before writing them.
if [[ "$EDGEONE_DEPLOY_MODE" != "upload" ]]; then
  cd "$ROOT"
  git fetch origin main
  # Detached or dirty worktrees are fine for CI; hard-reset tracked tree to origin/main.
  git checkout -B main origin/main
  echo "Checked out origin/main for Sparkle channel manifests (branch=${EDGEONE_REPO_BRANCH})."
fi

cd "$SERVICE_DIR"
node scripts/write-appcast.mjs \
  --channel "$CHANNEL" \
  --version "$VERSION" \
  --sparkle-version "$RELEASE_BUILD_NUMBER" \
  --url "$ZIP_URL" \
  --length "$LENGTH" \
  --ed-signature "$ED_SIGNATURE" \
  --release-url "$RELEASE_URL" \
  --published-at "$PUBLISHED_AT" \
  --notes-html "$RELEASE_NOTES_HTML" \
  --title "Version ${VERSION}"

test -f dist/updates/stable/appcast.xml
test -f dist/updates/beta/appcast.xml

edgeone_api() {
  local action="$1"
  local payload_json="$2"
  python3 - "$EDGEONE_API_BASE" "$EDGEONE_API_TOKEN" "$action" "$payload_json" <<'PY'
import json, sys, urllib.request
base, token, action, payload = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
body = {"Action": action, "Region": "ap-singapore"}
body.update(json.loads(payload))
req = urllib.request.Request(
    base,
    data=json.dumps(body).encode(),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    },
)
with urllib.request.urlopen(req, timeout=60) as resp:
    print(resp.read().decode())
PY
}

if [[ -z "${EDGEONE_API_TOKEN:-}" ]]; then
  echo "::warning::EDGEONE_API_TOKEN not set; appcast written locally but not deployed."
  exit 0
fi

if [[ "$EDGEONE_DEPLOY_MODE" == "upload" ]]; then
  # Only works for Provider=Upload projects. makers-2gtkiwcbcdiw is GitHub-connected.
  npx --yes edgeone@1.6.19 pages deploy ./dist \
    -n "$EDGEONE_PROJECT_NAME" \
    -t "$EDGEONE_API_TOKEN" \
    -e "$EDGEONE_ENV"
else
  # GitHub-connected project: commit channel manifests on main, then trigger redeploy from main.
  cd "$ROOT"
  if [[ -n "$(git status --porcelain deploy/sparkle-update-service/channels || true)" ]]; then
    git add deploy/sparkle-update-service/channels
    if git diff --cached --quiet; then
      echo "No channel manifest changes to commit."
    else
      git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
        commit -m "chore: publish Sparkle appcast ${VERSION} (${CHANNEL})"
      # Must land on main so EdgeOne GitHub build picks up the new appcast.
      if ! git push origin "HEAD:main"; then
        echo "::error::Failed to push channel manifests to origin/main; EdgeOne feed will not update."
        exit 1
      fi
      echo "Pushed channel manifests to origin/main for EdgeOne GitHub redeploy."
    fi
  fi

  BRANCH="$EDGEONE_REPO_BRANCH"
  RESP="$(
    edgeone_api CreatePagesDeployment "$(
      jq -n \
        --arg projectId "$EDGEONE_PROJECT_ID" \
        --arg branch "$BRANCH" \
        '{
          ProjectId: $projectId,
          ViaMeta: "Github",
          Provider: "Github",
          Env: "Production",
          RepoBranch: $branch
        }'
    )"
  )"
  DEPLOY_ID="$(printf '%s' "$RESP" | jq -r '.Data.Response.DeploymentId // empty')"
  if [[ -z "$DEPLOY_ID" ]]; then
    echo "::warning::EdgeOne GitHub redeploy response missing DeploymentId: $RESP"
  else
    echo "Triggered EdgeOne GitHub redeploy DeploymentId=$DEPLOY_ID project=$EDGEONE_PROJECT_ID branch=$BRANCH"
  fi
fi

echo "Sparkle feed published for project=${EDGEONE_PROJECT_NAME} id=${EDGEONE_PROJECT_ID} channel=${CHANNEL} version=${VERSION}"
echo "Public feed base: ${EDGEONE_PUBLIC_FEED_BASE}"
echo "  ${EDGEONE_PUBLIC_FEED_BASE}/updates/stable/appcast.xml"
echo "  ${EDGEONE_PUBLIC_FEED_BASE}/updates/beta/appcast.xml"
