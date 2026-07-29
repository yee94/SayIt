#!/usr/bin/env bash
set -euo pipefail

# Set the repository secrets Tauri requires for Developer ID signing and
# notarization. Values are streamed directly to `gh` and never written to disk.

if [ "${1:-}" = "--" ]; then
  shift
fi

repository="${GITHUB_REPOSITORY:-yee94/SayIt}"
certificate_path="${1:-${APPLE_CERTIFICATE_PATH:-}}"
api_key_path="${2:-${APP_STORE_CONNECT_API_KEY_PATH:-}}"
api_key_id="${APP_STORE_CONNECT_KEY_ID:-}"
api_issuer_id="${APP_STORE_CONNECT_ISSUER_ID:-}"

if [ -z "$certificate_path" ] || [ -z "$api_key_path" ]; then
  echo "Usage: $0 /absolute/path/to/developer-id.p12 /absolute/path/to/AuthKey_KEYID.p8" >&2
  echo "Set GITHUB_REPOSITORY to override the default repository: $repository" >&2
  exit 1
fi

if [ ! -f "$certificate_path" ] || [ ! -f "$api_key_path" ]; then
  echo "Both the Developer ID .p12 and App Store Connect .p8 files must exist." >&2
  exit 1
fi

gh auth status -h github.com >/dev/null

if [ -z "$api_key_id" ]; then
  api_key_basename="$(basename "$api_key_path")"
  if [[ "$api_key_basename" =~ ^AuthKey_([A-Z0-9]+)\.p8$ ]]; then
    api_key_id="${BASH_REMATCH[1]}"
  else
    read -r -p "App Store Connect Key ID: " api_key_id
  fi
fi

if [ -z "$api_issuer_id" ]; then
  read -r -p "App Store Connect Issuer ID: " api_issuer_id
fi

if [ -z "$api_key_id" ] || [ -z "$api_issuer_id" ]; then
  echo "App Store Connect Key ID and Issuer ID are required." >&2
  exit 1
fi

read -r -s -p "Developer ID .p12 password: " certificate_password
echo

base64 -i "$certificate_path" | tr -d '\n' | gh secret set APPLE_CERTIFICATE --repo "$repository"
printf '%s' "$certificate_password" | gh secret set APPLE_CERTIFICATE_PASSWORD --repo "$repository"
unset certificate_password
base64 -i "$api_key_path" | tr -d '\n' | gh secret set APP_STORE_CONNECT_PRIVATE_KEY_BASE64 --repo "$repository"
printf '%s' "$api_key_id" | gh secret set APP_STORE_CONNECT_KEY_ID --repo "$repository"
printf '%s' "$api_issuer_id" | gh secret set APP_STORE_CONNECT_ISSUER_ID --repo "$repository"

echo "Configured Apple signing and notarization secrets for $repository."
