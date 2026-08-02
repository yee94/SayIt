#!/usr/bin/env bash
# Publish one Sparkle release item into deploy/sparkle-update-service and
# deploy the static site to EdgeOne Pages.
#
# Required env:
#   VERSION, TAG, CHANNEL (stable|beta), GITHUB_REPOSITORY
# Optional env:
#   SPARKLE_ED_SIGNATURE, SPARKLE_ED_LENGTH
#   EDGEONE_API_TOKEN, EDGEONE_PROJECT_NAME (default sayit-sparkle-update)
#   EDGEONE_ENV (default production)
#   RELEASE_BUILD_NUMBER (sparkle:version; falls back to CFBundle-style from VERSION)
#   RELEASE_NOTES_HTML, PUBLISHED_AT, RELEASE_URL
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
EDGEONE_ENV="${EDGEONE_ENV:-production}"

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

if [[ -z "${EDGEONE_API_TOKEN:-}" ]]; then
  echo "::warning::EDGEONE_API_TOKEN not set; appcast written locally but not deployed."
  exit 0
fi

npx --yes edgeone@1.6.19 pages deploy ./dist \
  -n "$EDGEONE_PROJECT_NAME" \
  -t "$EDGEONE_API_TOKEN" \
  -e "$EDGEONE_ENV"

echo "Sparkle feed deployed to EdgeOne project=${EDGEONE_PROJECT_NAME} channel=${CHANNEL} version=${VERSION}"
echo "Feed paths:"
echo "  /updates/stable/appcast.xml"
echo "  /updates/beta/appcast.xml"
