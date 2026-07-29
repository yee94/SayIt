# Apple Developer ID signing and notarization

SayIt is distributed as a notarized macOS DMG outside the Mac App Store. It uses this Developer ID identity:

```text
Developer ID Application: yee wang (6W97S9B7CZ)
```

The corresponding `openchamber-developer-id.p12` may be reused for this app because a Developer ID Application certificate identifies its developer, rather than a specific bundle ID. Do not commit the `.p12`, its password, or App Store Connect `.p8` key.

## Configure local builds

Import the Developer ID archive into the login keychain once. The helper prompts for the archive password without storing it in the repository:

```bash
pnpm apple:import-cert -- /absolute/path/to/openchamber-developer-id.p12
security find-identity -v -p codesigning
pnpm tauri:build:signed
```

The expected identity must appear in the `security find-identity` output. Tauri's macOS configuration selects that identity and enables the Hardened Runtime.

To notarize a local release as well, export these values for the current shell before building:

```bash
export APPLE_API_KEY='your App Store Connect Key ID'
export APPLE_API_ISSUER='your App Store Connect Issuer ID'
export APPLE_API_KEY_PATH='/absolute/path/to/AuthKey_your-key-id.p8'
pnpm tauri:build:signed
```

## Configure GitHub Actions

First authenticate the GitHub CLI again (the current local token is invalid), then set the five repository secrets. The helper derives the Key ID from `AuthKey_<KEY_ID>.p8`, prompts for the Issuer ID and `.p12` password, and streams every sensitive value directly to GitHub.

```bash
gh auth login -h github.com
pnpm apple:configure-secrets -- \
  /absolute/path/to/openchamber-developer-id.p12 \
  /absolute/path/to/AuthKey_your-key-id.p8
```

`APPLE_CERTIFICATE` must be the single-line Base64 of the `.p12`; `APPLE_CERTIFICATE_PASSWORD` is the password selected when that archive was exported. The App Store Connect API key needs access suitable for notarization.

The release workflow refuses to create a macOS release if any of those secrets are absent. On a macOS runner, Tauri imports the certificate from `APPLE_CERTIFICATE`, uses the configured Developer ID identity, submits the build using `APPLE_API_KEY`, `APPLE_API_ISSUER`, and `APPLE_API_KEY_PATH`, then staples the notarization ticket to the output.

## Verify a release artifact

After a release workflow succeeds, mount the DMG and run these commands against the app bundle:

```bash
codesign --verify --deep --strict --verbose=2 /Volumes/SayIt/SayIt.app
spctl --assess --type execute --verbose=4 /Volumes/SayIt/SayIt.app
stapler validate /Volumes/SayIt/SayIt.app
```

The assessment should identify `Developer ID Application: yee wang (6W97S9B7CZ)` and report an accepted notarized build.
