# SayIt Sparkle Update Service (EdgeOne)

Static Sparkle appcast host for SayIt in-app updates.

## EdgeOne project

| Item | Value |
| --- | --- |
| Project name | `sayit-sparkle-update` |
| Project ID | `makers-2gtkiwcbcdiw` |
| Provider | GitHub (`yee94/SayIt`) |
| Root directory | `deploy/sparkle-update-service` |
| Build command | `node scripts/build.mjs` |
| Output directory | `dist` |
| Custom domain | `https://sayit-update.xiaobe.top` |
| Preset domain | `https://sayit-sparkle-update.edgeone.dev` (preview auth; not for Sparkle) |

## Public feeds (production)

```text
https://sayit-update.xiaobe.top/updates/stable/appcast.xml
https://sayit-update.xiaobe.top/updates/beta/appcast.xml
https://sayit-update.xiaobe.top/health.json
```

Client defaults (`AppUpdateManager` / `Info.plist`) use the custom domain above.

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
  --version 1.15.1 \
  --sparkle-version 101500199 \
  --url "https://github.com/yee94/SayIt/releases/download/v1.15.1/SayIt-1.15.1-macOS.zip" \
  --length 49528507 \
  --ed-signature "$SPARKLE_ED_SIGNATURE" \
  --release-url "https://github.com/yee94/SayIt/releases/tag/v1.15.1" \
  --published-at "2026-08-02T02:00:00Z" \
  --notes-html "<p>SayIt 1.15.1</p>"
```

`edSignature` must be produced by Sparkle `sign_update` with the private key that matches app `SUPublicEDKey`.

## Deploy / CI

Because this project is **GitHub-connected**, CLI `edgeone pages deploy` cannot upload into it (Upload-only). Redeploy with:

1. push changes under `deploy/sparkle-update-service/` (EdgeOne auto-build), or
2. API `CreatePagesDeployment` with `ViaMeta=Github` (used by CI), or
3. workflow `Deploy Sparkle Feed (EdgeOne)`.

| Workflow | When | What |
| --- | --- | --- |
| `Release` (`v2-migration.yml`) | tag `v*.*.*` | sign zip, write channel manifest, trigger EdgeOne GitHub redeploy |
| `Deploy Sparkle Feed (EdgeOne)` | push to feed paths / manual | rebuild check + trigger EdgeOne GitHub redeploy |

Required secret:

- `EDGEONE_API_TOKEN` — EdgeOne Pages/Makers API Token

Optional secret (for installable updates):

- `SPARKLE_PRIVATE_KEY` — Sparkle EdDSA private key matching app `SUPublicEDKey`

Manual redeploy:

```bash
gh workflow run "Deploy Sparkle Feed (EdgeOne)" -f branch=v2
```

## Custom domain / TLS

DNS:

```text
sayit-update.xiaobe.top  CNAME  sayit-update.xiaobe.top.pages.dnsoe8.com
```

If HTTPS fails with certificate name mismatch (`*.cdn.myqcloud.com`), open EdgeOne console → project **sayit-sparkle-update** → Domain management → ensure free SSL is applied/issued for `sayit-update.xiaobe.top` (same pattern as `openchamber.xiaobe.top`).

## Notes

- Install packages stay on GitHub Releases; EdgeOne only serves appcast XML.
- Do not commit API tokens.
- Empty `edSignature` produces a parseable feed but Sparkle will reject install until a valid signature is published.
