# SayIt Sparkle Update Service (EdgeOne)

Static Sparkle appcast host for SayIt in-app updates.

## Public feeds

After EdgeOne deploy (project name `sayit-sparkle-update`):

| Channel | Path |
| --- | --- |
| stable | `/updates/stable/appcast.xml` |
| beta | `/updates/beta/appcast.xml` |
| health | `/health.json` |

Client defaults:

```text
https://sayit-sparkle-update.edgeone.cool/updates/stable/appcast.xml
https://sayit-sparkle-update.edgeone.cool/updates/beta/appcast.xml
```

If EdgeOne assigns a different project domain, update:

- `Voxt/Core/Utilities/AppUpdateManager.swift`
- `Voxt/Voxt/Info.plist`
- this README

## Local build

```bash
cd deploy/sparkle-update-service
node scripts/build.mjs
# output: dist/
```

## Publish one release item

```bash
node scripts/write-appcast.mjs \
  --channel stable \
  --version 1.15.0 \
  --sparkle-version 101500099 \
  --url "https://github.com/yee94/SayIt/releases/download/v1.15.0/SayIt-1.15.0-macOS.zip" \
  --length 49528507 \
  --ed-signature "$SPARKLE_ED_SIGNATURE" \
  --release-url "https://github.com/yee94/SayIt/releases/tag/v1.15.0" \
  --published-at "2026-08-01T16:48:30Z" \
  --notes-html "<p>SayIt 1.15.0</p>"
```

`edSignature` must be produced by Sparkle `sign_update` with the private key that matches app `SUPublicEDKey`.

## Deploy to EdgeOne

```bash
cd deploy/sparkle-update-service
node scripts/build.mjs
npx --yes edgeone pages deploy ./dist -n sayit-sparkle-update -t "$EDGEONE_API_TOKEN" -e production
```

### GitHub Actions

| Workflow | When | What |
| --- | --- | --- |
| `Release` (`v2-migration.yml`) | tag `v*.*.*` | sign zip (if `SPARKLE_PRIVATE_KEY`), write channel manifest, deploy EdgeOne appcast |
| `Deploy Sparkle Feed (EdgeOne)` | push to `deploy/sparkle-update-service/**` or manual | rebuild + redeploy current manifests only |

Required secret:

- `EDGEONE_API_TOKEN` — EdgeOne Pages/Makers API Token

Optional secret (for real installable updates):

- `SPARKLE_PRIVATE_KEY` — Sparkle EdDSA private key matching app `SUPublicEDKey`

Manual redeploy:

```bash
gh workflow run "Deploy Sparkle Feed (EdgeOne)"
```

## Notes

- Install packages stay on GitHub Releases; EdgeOne only serves appcast XML.
- Do not commit API tokens.
- Empty `edSignature` produces a parseable feed but Sparkle will reject install until a valid signature is published.
- Default `*.edgeone.cool` project domain may require preview auth; bind a custom domain for production Sparkle clients.
