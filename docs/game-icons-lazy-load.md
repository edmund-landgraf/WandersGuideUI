# Game Icons: lazy-load plan

Yes: lazy-load. The pack is 4,040 SVG React components in one barrel (`react-icons/gi` → `index.esm-*.js`, ~6.7 MB / ~2.7 MB gzip). The app does not need that on every page.

This plan only covers Game Icons. Phase 1 splitting and `mathjs` stay in [bundle-size-refactor.md](./bundle-size-refactor.md).

## Current behavior (not enough)

[`src/common/Icon.tsx`](../src/common/Icon.tsx) already uses `import('react-icons/gi')`. That is a separate chunk, but:

1. Idle preload (`requestIdleCallback` / 2s) still downloads the pack on every visit.
2. Any `<Icon name="…">` that is not a Tabler chrome name calls `loadGameIcons()` and pulls all 4,040 icons.
3. [`src/modals/SelectIconModal.tsx`](../src/modals/SelectIconModal.tsx) calls `getAllIconsAsync()` when the picker mounts, which also loads the full barrel.

`react-icons/gi` is a single `index.esm.js`. There is no per-icon file to `import()`. A dynamic import of the package is all-or-nothing.

## Goal

- First paint and typical sheet/campaign use: **no** `index.esm` download.
- Keep the ~20 eager SVGs in [`src/common/game-icons-inline.tsx`](../src/common/game-icons-inline.tsx) (item types + dice buttons).
- Download the 4,040-icon barrel **only when the icon picker opens**, or when a stored name is a Game Icon (not Tabler).

## Changes

### 1. Stop idle preload

Delete the `requestIdleCallback` / `setTimeout` preload in `Icon.tsx`. Do not call `loadGameIcons()` until something needs the pack.

### 2. Keep Tabler and inlined icons off the pack

`<Icon name>` already resolves Tabler synchronously (`combat`, `notebook`, `dice`, …). Leave that path pack-free.

`ItemIcon` and dice UI already import from `game-icons-inline`. Do not route those through `loadGameIcons()`.

### 3. Load the barrel only on picker (and on a real Game Icon miss)

- **Picker:** keep `getAllIconsAsync()` in `SelectIconModalContents`. That is the one UX that needs every name. Show the existing loader until the chunk arrives.
- **Display:** if the name is not Tabler, then `loadGameIcons()` (today’s `GameIcon`). That covers saved homebrew / note / encounter icons that used a Game Icon name. Do not preload “in case.”

### 4. AI random icon

[`src/ai/open-ai-handler.ts`](../src/ai/open-ai-handler.ts) uses `getAllIcons()` synchronously. After dropping the idle preload, that list is Tabler-only unless the pack has already loaded. Change it to `getAllIconsAsync()`, or pick from the Tabler name list only so AI generation does not force the 6.7 MB download.

### 5. Measure

`npm run build`. Confirm `index.esm-*.js` is still a **separate** chunk (it will be) and that it is **not** requested from `main` on first load. Open the icon picker once and confirm the chunk fetches then. Do not raise `workbox.maximumFileSizeToCacheInBytes`.

## What this does not do

Per-icon code-split is not available from `react-icons/gi` without generating our own files. Opening the picker still downloads ~6.7 MB once. That is acceptable for a rare editor; it is not acceptable on every page load.

A later cut (out of scope here) would be a generated name list plus SVG JSON only for icons in use, or replacing the picker with Tabler-only.
