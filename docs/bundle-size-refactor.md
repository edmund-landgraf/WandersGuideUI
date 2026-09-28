# Bundle size refactor

Production build currently ships two oversized JS chunks:

| File | Raw | gzip |
| --- | --- | --- |
| `dist/assets/main-DtgyOGZH.js` | 3,500.67 kB | 1,017.94 kB |
| `dist/assets/index.esm-DCNA6x0q.js` | 6,719.88 kB | 2,743.72 kB |

Hashes change each build. The names below are from this snapshot.

This note describes the causes and the code cuts. It does not implement them.

## What the hashes are

### `index.esm-*.js` — Game Icons (`react-icons/gi`)

`node_modules/react-icons/gi/index.esm.js` is about 6.7 MB (4,040 icons). Vite names the output chunk `index.esm-*` after that file.

It is still emitted because [`src/common/Icon.tsx`](../src/common/Icon.tsx) does `import('react-icons/gi')` and preloads the pack on idle (`requestIdleCallback` / 2s timeout). Moving the import off the static graph took Game Icons out of the entry chunk; it did not stop the download. Any later navigation that renders a content icon, plus the idle preload, still fetches the full set.

A smaller eager subset already lives in [`src/common/game-icons-inline.tsx`](../src/common/game-icons-inline.tsx) (item icon map + dice roller). That path is correct; the remaining problem is the full-pack dynamic import.

### `main-*.js` — phase 1 entry

[`src/pages/phase1/main.tsx`](../src/pages/phase1/main.tsx) is the phase 1 bootstrap. [`src/pages/phase1/Phase1App.tsx`](../src/pages/phase1/Phase1App.tsx) statically imports the workspace, sheet, builder, and stat block, so those pages share one entry chunk.

Heavy static edges into that chunk:

- [`src/pages/phase1/Phase1Workspace.tsx`](../src/pages/phase1/Phase1Workspace.tsx) statically imports [`src/pages/phase1/phase1-dice-3d.tsx`](../src/pages/phase1/phase1-dice-3d.tsx), which pulls `open-dice-dnd` and `three`.
- [`src/pages/phase1/Phase1SheetPage.tsx`](../src/pages/phase1/Phase1SheetPage.tsx) statically imports the Plate notes editor (`phase1-plate-notes`).

PDF export is already a dynamic import in `Phase1Workspace` (`@export/pdf/pdf-v2`).

## Cuts

### 1. Stop shipping all of `react-icons/gi`

Keep the inlined set in `game-icons-inline.tsx`.

For content icons, load only names that actually appear (a generated name-to-SVG map, or per-icon dynamic imports). Delete `import('react-icons/gi')` and the idle preload in `Icon.tsx`.

Expected drop: the entire `index.esm` chunk (~6.7 MB / ~2.7 MB gzip).

### 2. Split the phase 1 entry

- `React.lazy` the sheet, builder, stat block, and workspace routes from `Phase1App`.
- Dynamic-import `phase1-dice-3d` only when a 3D roll is shown.
- Dynamic-import `phase1-plate-notes` only when the notes editor mounts.

Expected drop: a smaller `main` on first paint; Three.js / dice / Plate load on the routes that need them.

### 3. `mathjs` number build

Several call sites import `evaluate` from `mathjs` (full library). Others already use `mathjs/number`:

- [`src/process/variables/variable-utils.ts`](../src/process/variables/variable-utils.ts)
- [`src/process/upload/foundry-utils.ts`](../src/process/upload/foundry-utils.ts)
- [`src/drawers/types/InvItemDrawer.tsx`](../src/drawers/types/InvItemDrawer.tsx)

Switch remaining `from 'mathjs'` imports to `mathjs/number`:

- [`src/pages/campaign/panels/EncountersPanel.tsx`](../src/pages/campaign/panels/EncountersPanel.tsx)
- [`src/pages/phase1/phase1-change-log.ts`](../src/pages/phase1/phase1-change-log.ts)
- [`src/pages/character_sheet/sections/HealthSection.tsx`](../src/pages/character_sheet/sections/HealthSection.tsx)
- [`src/pages/character_sheet/panels/CompanionsPanel.tsx`](../src/pages/character_sheet/panels/CompanionsPanel.tsx)
- [`src/pages/character_sheet/entity-handler.ts`](../src/pages/character_sheet/entity-handler.ts)
- [`src/drawers/types/ManageCoinsDrawer.tsx`](../src/drawers/types/ManageCoinsDrawer.tsx)

## Measure

[`vite.config.ts`](../vite.config.ts) already emits `stats.html` via `rollup-plugin-visualizer`. After the cuts:

1. Run `npm run build`.
2. Confirm `index.esm-*.js` is gone from `dist/assets`.
3. Re-check `main-*.js` size and gzip.
4. Open `dist/stats.html` if a remaining large module is unclear.

Do not raise `workbox.maximumFileSizeToCacheInBytes` (currently 15 MiB) to hide the size.
