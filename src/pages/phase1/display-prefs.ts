import { makeRequest } from '@requests/request-manager';
import type { PublicUser } from '@schemas/content';
import { getCachedPublicUser } from '@auth/user-manager';
import { isPhase1CssTheme, PHASE1_CSS_THEME_STORAGE_KEY, type Phase1CssTheme } from './phase1-css-theme';
import { isPhase1Theme, PHASE1_THEME_STORAGE_KEY, type Phase1Theme } from './phase1-theme';

export const PHASE1_PREFERRED_PHASE_KEY = 'phase1-preferred-phase';
export const DISPLAY_PREF_STORAGE_KEYS = [
  PHASE1_THEME_STORAGE_KEY,
  PHASE1_CSS_THEME_STORAGE_KEY,
  PHASE1_PREFERRED_PHASE_KEY,
] as const;

export type PreferredPhase = 'phase0' | 'phase1';

export function isPreferredPhase(value: string | null | undefined): value is PreferredPhase {
  return value === 'phase0' || value === 'phase1';
}

export function readStoredPreferredPhase(): PreferredPhase | null {
  try {
    const stored = localStorage.getItem(PHASE1_PREFERRED_PHASE_KEY);
    if (isPreferredPhase(stored)) return stored;
  } catch {
    /* ignore */
  }
  return null;
}

export function persistPreferredPhase(phase: PreferredPhase) {
  try {
    localStorage.setItem(PHASE1_PREFERRED_PHASE_KEY, phase);
  } catch {
    /* ignore */
  }
  void syncDisplayPrefsToUser({ preferred_phase: phase });
}

/** Logout used to `localStorage.clear()`, which wiped the header theme switches. */
export function snapshotDisplayPrefs(): Record<string, string> {
  const saved: Record<string, string> = {};
  try {
    for (const key of DISPLAY_PREF_STORAGE_KEYS) {
      const value = localStorage.getItem(key);
      if (value != null) saved[key] = value;
    }
  } catch {
    /* ignore */
  }
  return saved;
}

export function restoreDisplayPrefs(saved: Record<string, string>) {
  try {
    for (const [key, value] of Object.entries(saved)) {
      localStorage.setItem(key, value);
    }
  } catch {
    /* ignore */
  }
}

export function clearStoragePreservingDisplayPrefs() {
  const saved = snapshotDisplayPrefs();
  localStorage.clear();
  restoreDisplayPrefs(saved);
}

export function applyDisplayPrefsFromUser(user: PublicUser | null | undefined) {
  if (!user?.site_theme) return;
  const { phase1_theme, phase1_css_theme, preferred_phase } = user.site_theme;
  try {
    if (isPhase1Theme(phase1_theme) && !localStorage.getItem(PHASE1_THEME_STORAGE_KEY)) {
      localStorage.setItem(PHASE1_THEME_STORAGE_KEY, phase1_theme);
    }
    if (isPhase1CssTheme(phase1_css_theme) && !localStorage.getItem(PHASE1_CSS_THEME_STORAGE_KEY)) {
      localStorage.setItem(PHASE1_CSS_THEME_STORAGE_KEY, phase1_css_theme);
    }
    if (isPreferredPhase(preferred_phase) && !localStorage.getItem(PHASE1_PREFERRED_PHASE_KEY)) {
      localStorage.setItem(PHASE1_PREFERRED_PHASE_KEY, preferred_phase);
    }
  } catch {
    /* ignore */
  }
}

export function hydrateDisplayPrefsFromUser(user: PublicUser | null | undefined) {
  applyDisplayPrefsFromUser(user);
  if (!user) return;
  const phase1_theme = (localStorage.getItem(PHASE1_THEME_STORAGE_KEY) as Phase1Theme | null) ?? undefined;
  const phase1_css_theme = (localStorage.getItem(PHASE1_CSS_THEME_STORAGE_KEY) as Phase1CssTheme | null) ?? undefined;
  const preferred_phase = readStoredPreferredPhase() ?? undefined;
  const theme = user.site_theme;
  if (
    (isPhase1Theme(phase1_theme) && theme?.phase1_theme !== phase1_theme) ||
    (isPhase1CssTheme(phase1_css_theme) && theme?.phase1_css_theme !== phase1_css_theme) ||
    (preferred_phase && theme?.preferred_phase !== preferred_phase)
  ) {
    void syncDisplayPrefsToUser({
      ...(isPhase1Theme(phase1_theme) ? { phase1_theme } : {}),
      ...(isPhase1CssTheme(phase1_css_theme) ? { phase1_css_theme } : {}),
      ...(preferred_phase ? { preferred_phase } : {}),
    });
  }
}

export async function syncDisplayPrefsToUser(patch: {
  phase1_theme?: Phase1Theme;
  phase1_css_theme?: Phase1CssTheme;
  preferred_phase?: PreferredPhase;
}) {
  const user = getCachedPublicUser();
  if (!user) return;
  const site_theme = {
    ...user.site_theme,
    ...patch,
  };
  try {
    localStorage.setItem('user-data', JSON.stringify({ ...user, site_theme }));
  } catch {
    /* ignore */
  }
  await makeRequest('update-user', { site_theme });
}
