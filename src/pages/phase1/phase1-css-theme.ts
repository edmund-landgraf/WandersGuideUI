export const PHASE1_CSS_THEMES = ['default', 'waitly'] as const;
export type Phase1CssTheme = (typeof PHASE1_CSS_THEMES)[number];

export const PHASE1_CSS_THEME_STORAGE_KEY = 'phase1-css-theme';

/** Distinct stacks so Default vs Waitly is obvious even if a webfont fails. */
export const PHASE1_CSS_THEME_TOKENS = {
  default: {
    fontSans: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontHeading: 'Inter, ui-sans-serif, system-ui, sans-serif',
    radius: '0px',
  },
  waitly: {
    fontSans: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
    fontHeading: '"Cal Sans", ui-sans-serif, system-ui, sans-serif',
    radius: '0.75rem',
  },
} as const;

const PHASE1_FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Cal+Sans&family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';

export function isPhase1CssTheme(value: string | null | undefined): value is Phase1CssTheme {
  return value === 'default' || value === 'waitly';
}

export function readStoredPhase1CssTheme(): Phase1CssTheme {
  try {
    const stored = localStorage.getItem(PHASE1_CSS_THEME_STORAGE_KEY);
    if (isPhase1CssTheme(stored)) return stored;
  } catch {
    /* ignore */
  }
  return 'default';
}

function ensureFontStylesheet() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-phase1-fonts]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = PHASE1_FONT_STYLESHEET;
  link.dataset.phase1Fonts = 'true';
  document.head.appendChild(link);
}

async function loadThemeFaces(theme: Phase1CssTheme) {
  if (typeof document === 'undefined') return;
  ensureFontStylesheet();
  const { fontSans, fontHeading } = PHASE1_CSS_THEME_TOKENS[theme];
  const sansName = fontSans.split(',')[0].replaceAll('"', '').trim();
  const headingName = fontHeading.split(',')[0].replaceAll('"', '').trim();
  try {
    await Promise.all([
      document.fonts.load(`400 16px "${sansName}"`),
      document.fonts.load(`600 16px "${sansName}"`),
      document.fonts.load(`400 32px "${headingName}"`),
    ]);
  } catch {
    /* ignore */
  }
}

export function readAppliedCssThemeTokens() {
  const style = document.documentElement.style;
  return {
    cssTheme: document.documentElement.dataset.cssTheme ?? '',
    fontSans: style.getPropertyValue('--p1-font-sans'),
    fontHeading: style.getPropertyValue('--p1-font-heading'),
    radius: style.getPropertyValue('--p1-radius'),
    waitlyClass: document.documentElement.classList.contains('p1-css-waitly'),
    defaultClass: document.documentElement.classList.contains('p1-css-default'),
  };
}

function writeThemeTokens(theme: Phase1CssTheme) {
  const root = document.documentElement;
  const tokens = PHASE1_CSS_THEME_TOKENS[theme];
  root.dataset.cssTheme = theme;
  root.classList.toggle('p1-css-waitly', theme === 'waitly');
  root.classList.toggle('p1-css-default', theme === 'default');
  root.style.setProperty('--p1-font-sans', tokens.fontSans);
  root.style.setProperty('--p1-font-heading', tokens.fontHeading);
  root.style.setProperty('--p1-radius', tokens.radius);
  document.body?.style.removeProperty('font-family');
}

export function applyPhase1CssTheme(theme: Phase1CssTheme) {
  if (typeof document === 'undefined') return;
  writeThemeTokens(theme);
  void loadThemeFaces(theme);
}

export function persistPhase1CssTheme(theme: Phase1CssTheme) {
  applyPhase1CssTheme(theme);
  try {
    localStorage.setItem(PHASE1_CSS_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  void import('./display-prefs').then(({ syncDisplayPrefsToUser }) => {
    void syncDisplayPrefsToUser({ phase1_css_theme: theme });
  });
}
