# MLX Audio Dependency Policy

SayIt uses `mlx-audio-swift` through the mirror fork at `https://github.com/hehehai/mlx-audio-swift`.

The current Xcode package reference is:

- URL: `https://github.com/hehehai/mlx-audio-swift.git`
- Requirement: `exactVersion`
- Version: `0.1.3-voxt.12`

## Version rules

- Prefer upstream release tags when they already contain the STT features or fixes SayIt needs.
- When upstream `main` contains required changes that are not released yet, sync the fork's `main` to upstream and create a SayIt tag on the selected commit.
- Switch SayIt back to upstream release tags once an official release covers the same changes.

## Tag rules

- Keep the fork as a mirror plus tags only. Do not land SayIt-specific source patches there unless absolutely required.
- Use tags in the form `v<upstream-version>-voxt.<n>`.
- Do not reuse upstream tag names for different commits.

## Update workflow

1. Sync `hehehai/mlx-audio-swift` `main` from `Blaizzy/mlx-audio-swift`.
2. Pick the target commit from fork `main`.
3. Create a new annotated SayIt tag on that commit, for example `v0.1.2-voxt.2`.
4. Point `Voxt.xcodeproj` at the fork URL and `exactVersion`.
5. Build SayIt and verify STT model loading, legacy repo migration, and downloaded-model detection before shipping.

If SayIt needs to consume a synced fork commit before a new tag exists, pin the project to that exact `revision` temporarily, then switch back to a release tag once the fork tag is cut.

## Practical rules for SayIt maintainers

- Use upstream releases directly when they already include the models or fixes SayIt needs.
- Use the fork only when SayIt must consume unreleased upstream commits.
- Keep the fork as a mirror plus tags. Do not put long-lived SayIt-only API changes into the fork.
- Once upstream publishes an official release that covers the same changes, switch SayIt back to the upstream release tag instead of staying on a fork tag forever.
- If a new MLX Audio update renames model repos, add canonical mapping in `MLXModelManager` so existing user settings and downloaded caches continue to work.

## Current pin

- Fork: `hehehai/mlx-audio-swift`
- Requirement: `exactVersion`
- Version: `0.1.3-voxt.12`
- Commit: `95b4587`
- Notes: `TranscriptionEvent.ended` carries full `STTOutput` (text / segments / language provenance) for Qwen, MOSS, Cohere, and Nemotron live stop, aligned with batch structured-output semantics; includes upstream through `c5d4054` and SayIt Qwen KV / language-parameter work

## Resolved transitive pins

`Package.resolved` currently selects:

- `mlx-swift-lm` at revision `d2424294a6c3bbd0de37a0761d80efc05e6813dd` (direct SayIt pin)
- `mlx-swift` `0.31.4` (transitive via the audio/lm graph)

Toolchain ceiling on the current SayIt baseline (Swift 6.2 / Xcode 26.3):

- `mlx-swift` 0.31.5+ requires `swift-tools-version: 6.3`, so SPM keeps `0.31.4` even though `0.31.6` exists.
- `mlx-swift-lm` commits after `d242429` need APIs from `mlx-swift` ≥ 0.31.5 (`greatestFiniteMagnitudeArray`, later `maskFill` / TurboQuant). Keep `d242429` until the app can move to a Swift 6.3 toolchain, then bump `mlx-swift` to ≥ 0.31.6 and `mlx-swift-lm` to `main` tip together.
