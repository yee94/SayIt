#!/usr/bin/env bash
set -euo pipefail

# Import a Developer ID .p12 into the login keychain without storing its password
# in this repository.

if [ "${1:-}" = "--" ]; then
  shift
fi

certificate_path="${1:-${APPLE_CERTIFICATE_PATH:-}}"
identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application: yee wang (6W97S9B7CZ)}"
keychain_path="${HOME}/Library/Keychains/login.keychain-db"

if [ -z "$certificate_path" ]; then
  echo "Usage: $0 /absolute/path/to/developer-id.p12" >&2
  echo "Or set APPLE_CERTIFICATE_PATH before running this script." >&2
  exit 1
fi

if [ ! -f "$certificate_path" ]; then
  echo "Certificate archive not found: $certificate_path" >&2
  exit 1
fi

read -r -s -p "Developer ID .p12 password: " certificate_password
echo

security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$certificate_password" \
  -T /usr/bin/codesign \
  -T /usr/bin/productbuild
unset certificate_password

if ! security find-identity -v -p codesigning "$keychain_path" | grep -Fq "$identity"; then
  echo "Imported certificate did not provide the expected signing identity:" >&2
  echo "  $identity" >&2
  exit 1
fi

echo "Apple signing identity is available in the login keychain:"
security find-identity -v -p codesigning "$keychain_path" | grep -F "$identity"
