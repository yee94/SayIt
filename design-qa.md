# SayIt visual redesign QA

## Scope

- Surface: desktop Settings page and shared application shell
- State: dark theme, Chinese locale, existing ASR credentials, Settings selected
- Viewport: 960 × 680 points (1920 × 1360 Retina capture)

## Visual sources

- Before: `/var/folders/5l/tlc329r51b17td86h3klclbw0000gn/T/codex-clipboard-7743aa2a-58a3-46e8-9ba9-03d6b6d2f498.png`
- Design grammar: `/Users/yee.wang/Code/github/openchamber-yee/docs/references/chat_example.png`
- Final implementation: `/Users/yee.wang/.codex/visualizations/2026/07/28/019fa806-3101-7943-b77e-1a9c23e5cffe/sayit-settings-blue-final.png`
- Combined comparison: `/Users/yee.wang/.codex/visualizations/2026/07/28/019fa806-3101-7943-b77e-1a9c23e5cffe/sayit-style-comparison-final.png`
- Action-layout correction source: `/var/folders/5l/tlc329r51b17td86h3klclbw0000gn/T/codex-clipboard-d75180a0-4967-4504-8107-b23f15a14def.png`
- Final action layout: `/Users/yee.wang/.codex/visualizations/2026/07/28/019fa806-3101-7943-b77e-1a9c23e5cffe/sayit-actions-alignment-final.png`
- Action-layout comparison: `/Users/yee.wang/.codex/visualizations/2026/07/28/019fa806-3101-7943-b77e-1a9c23e5cffe/sayit-actions-comparison.png`

The OpenChamber image is a design-language reference, not a pixel-exact screen target. The compared traits are density, hierarchy, surface treatment, navigation weight, borders, and color restraint.

## Full-view comparison

- The oversized card headers and header/content divider bands are removed.
- Section titles now act as quiet labels outside grouped content surfaces.
- Settings content remains scrollable without clipping or horizontal overflow.
- The sidebar is 18rem wide at this viewport, with 40px navigation rows, 18px icons, and a 56px brand header. It has enough visual weight relative to the content column.
- Dark surfaces use neutral black and cool gray rather than the rejected warm green-black cast.
- The cobalt-blue primary is limited to active navigation, selected segments, focus rings, and primary actions.

## Focused checks

- Form labels, descriptions, masked values, and destructive actions maintain clear contrast.
- Grouped surfaces use a subtle one-pixel boundary; no permanent drop shadows were introduced.
- Controls do not collide at the 960px-wide desktop window.
- Active navigation remains immediately distinguishable without turning the whole sidebar blue.
- Card and page spacing is compact but still preserves grouping and scan order.
- Destructive actions use a solid red surface with white text and sit at the left edge of action groups.
- Connection tests remain inline with destructive actions, while every explicit Save action is aligned to the right edge.

## Interaction and regression checks

- Navigated between Feature Guide and Settings in the native Tauri window.
- Scrolled the Settings surface and verified the compact group treatment beyond the first viewport.
- `pnpm build` passes.
- `pnpm test -- --run` passes: 24 files, 388 tests.
- `git diff --check` passes.

## Iteration history

1. First pass adopted OpenChamber's compact grouped-settings grammar.
2. Review found the sidebar too light in visual weight and the warm dark palette insufficiently pure.
3. Sidebar width, row size, icon size, and brand header were increased; dark tokens were moved to neutral black.
4. Green interaction accents were replaced by a restrained cobalt blue after user feedback.
5. Stacked credential actions were made inline; destructive buttons were standardized through the shared button variant.
6. Save actions were separated from destructive/test actions and aligned to the right.

## Findings

- P0: none
- P1: none
- P2: none
- P3: none blocking handoff

## Final result

passed
