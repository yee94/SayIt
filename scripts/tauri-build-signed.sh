#!/usr/bin/env bash
set -euo pipefail

# Rustup commonly lives outside the login shell PATH in desktop terminals.
# Use it when present without hard-coding a machine-specific toolchain path.
if ! command -v cargo >/dev/null 2>&1 && [ -x "${HOME}/.cargo/bin/cargo" ]; then
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust Cargo is required for a signed Tauri build. Install Rust with rustup, then retry." >&2
  exit 1
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  updater_key_path="${HOME}/.tauri/sayit-updater.key"
  if [ ! -f "$updater_key_path" ]; then
    echo "Tauri updater private key is missing: $updater_key_path" >&2
    exit 1
  fi

  export TAURI_SIGNING_PRIVATE_KEY="$(<"$updater_key_path")"
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -a "$(id -un)" -s 'SayIt Tauri updater signing key' -w)"
fi

pnpm exec tauri build --bundles dmg
