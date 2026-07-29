# Signed automatic updates

SayIt uses Tauri's static updater endpoint at GitHub Releases:

```text
https://github.com/yee94/SayIt/releases/latest/download/latest.json
```

The updater requires a separate Tauri signing key from Apple Developer ID signing. The private key is kept locally at `~/.tauri/sayit-updater.key`; its password is stored in the macOS Keychain service `SayIt Tauri updater signing key` and in these GitHub repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

`bundle.createUpdaterArtifacts` is enabled in `src-tauri/tauri.conf.json`. Local `pnpm tauri:build:signed` builds use the Keychain item automatically. The Release workflow supplies the same key to Tauri, which generates signed macOS updater bundles and `latest.json` for the GitHub Release.

Do not rotate this updater key after publishing a release: installed versions trust the public key embedded at build time. If rotation is unavoidable, users must install a new release manually before automatic updates can resume.
