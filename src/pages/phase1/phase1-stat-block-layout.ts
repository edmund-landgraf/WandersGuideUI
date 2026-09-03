import catalog from './phase1-stat-block-layouts.json';

export const STAT_BLOCK_LAYOUTS = ['current', 'board-v1', 'experimental'] as const;
export type StatBlockLayout = (typeof STAT_BLOCK_LAYOUTS)[number];

export const STAT_BLOCK_LAYOUT_STORAGE_KEY = catalog.storageKey;

export const STAT_BLOCK_LAYOUT_OPTIONS: { id: StatBlockLayout; label: string }[] = catalog.layouts.map((layout) => ({
  id: layout.id as StatBlockLayout,
  label: layout.label,
}));

export function isStatBlockLayout(value: string | null | undefined): value is StatBlockLayout {
  return STAT_BLOCK_LAYOUTS.includes(value as StatBlockLayout);
}

export function readStoredStatBlockLayout(): StatBlockLayout {
  try {
    const stored = localStorage.getItem(STAT_BLOCK_LAYOUT_STORAGE_KEY);
    if (isStatBlockLayout(stored)) return stored;
  } catch {
    /* ignore */
  }
  return isStatBlockLayout(catalog.default) ? catalog.default : 'current';
}

export function persistStatBlockLayout(layout: StatBlockLayout) {
  try {
    localStorage.setItem(STAT_BLOCK_LAYOUT_STORAGE_KEY, layout);
  } catch {
    /* ignore */
  }
}

export function isWideStatBlockLayout(layout: StatBlockLayout) {
  return layout !== 'current';
}
