export const PHASE1_THEMES = ['dark', 'grey', 'parchment'] as const;
export type Phase1Theme = (typeof PHASE1_THEMES)[number];

export const PHASE1_THEME_STORAGE_KEY = 'phase1-theme';
export const PHASE1_SHEET_ART_TONE_KEY = 'phase1-sheet-art-tone';
export const PHASE1_SHEET_ART_TONE_EVENT = 'phase1-sheet-art-tone';
export type Phase1SheetArtTone = 'light' | 'dark';

export function isPhase1Theme(value: string | null | undefined): value is Phase1Theme {
  return value === 'dark' || value === 'grey' || value === 'parchment';
}

export function artToneForTheme(theme: Phase1Theme): Phase1SheetArtTone {
  return theme === 'dark' ? 'dark' : 'light';
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

export function readStoredSheetArtTone(): Phase1SheetArtTone {
  try {
    const stored = localStorage.getItem(PHASE1_SHEET_ART_TONE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* ignore */
  }
  return artToneForTheme(readStoredPhase1Theme());
}

export function persistSheetArtTone(tone: Phase1SheetArtTone) {
  try {
    localStorage.setItem(PHASE1_SHEET_ART_TONE_KEY, tone);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(PHASE1_SHEET_ART_TONE_EVENT));
  void import('./display-prefs').then(({ syncDisplayPrefsToUser }) => {
    void syncDisplayPrefsToUser({ phase1_sheet_art_tone: tone });
  });
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
  void import('./display-prefs').then(({ syncDisplayPrefsToUser }) => {
    void syncDisplayPrefsToUser({ phase1_theme: theme });
  });
}

export function nextPhase1Theme(theme: Phase1Theme): Phase1Theme {
  const index = PHASE1_THEMES.indexOf(theme);
  return PHASE1_THEMES[(index + 1) % PHASE1_THEMES.length];
}
