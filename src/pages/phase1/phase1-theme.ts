export const PHASE1_THEMES = ['dark', 'grey', 'parchment'] as const;
export type Phase1Theme = (typeof PHASE1_THEMES)[number];

export const PHASE1_THEME_STORAGE_KEY = 'phase1-theme';

export function isPhase1Theme(value: string | null | undefined): value is Phase1Theme {
  return value === 'dark' || value === 'grey' || value === 'parchment';
}

export function readStoredPhase1Theme(): Phase1Theme {
  try {
    const stored = localStorage.getItem(PHASE1_THEME_STORAGE_KEY);
    if (isPhase1Theme(stored)) return stored;
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function applyPhase1Theme(theme: Phase1Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
}

export function persistPhase1Theme(theme: Phase1Theme) {
  applyPhase1Theme(theme);
  try {
    localStorage.setItem(PHASE1_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function nextPhase1Theme(theme: Phase1Theme): Phase1Theme {
  const index = PHASE1_THEMES.indexOf(theme);
  return PHASE1_THEMES[(index + 1) % PHASE1_THEMES.length];
}
