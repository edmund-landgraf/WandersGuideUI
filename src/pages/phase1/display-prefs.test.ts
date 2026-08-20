import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHASE1_CSS_THEME_STORAGE_KEY } from './phase1-css-theme';
import { PHASE1_THEME_STORAGE_KEY } from './phase1-theme';
import {
  applyDisplayPrefsFromUser,
  clearStoragePreservingDisplayPrefs,
  PHASE1_PREFERRED_PHASE_KEY,
} from './display-prefs';

vi.mock('@requests/request-manager', () => ({
  makeRequest: vi.fn(),
}));

vi.mock('@auth/user-manager', () => ({
  getCachedPublicUser: () => null,
}));

describe('display prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('keeps header theme choices through logout storage clear', () => {
    localStorage.setItem(PHASE1_THEME_STORAGE_KEY, 'parchment');
    localStorage.setItem(PHASE1_CSS_THEME_STORAGE_KEY, 'waitly');
    localStorage.setItem(PHASE1_PREFERRED_PHASE_KEY, 'phase1');
    localStorage.setItem('user-data', '{"id":1}');
    localStorage.setItem('unrelated', 'gone');

    clearStoragePreservingDisplayPrefs();

    expect(localStorage.getItem(PHASE1_THEME_STORAGE_KEY)).toBe('parchment');
    expect(localStorage.getItem(PHASE1_CSS_THEME_STORAGE_KEY)).toBe('waitly');
    expect(localStorage.getItem(PHASE1_PREFERRED_PHASE_KEY)).toBe('phase1');
    expect(localStorage.getItem('user-data')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBeNull();
  });

  it('fills empty local choices from the signed-in user', () => {
    applyDisplayPrefsFromUser({
      site_theme: {
        phase1_theme: 'grey',
        phase1_css_theme: 'waitly',
        preferred_phase: 'phase0',
      },
    } as never);

    expect(localStorage.getItem(PHASE1_THEME_STORAGE_KEY)).toBe('grey');
    expect(localStorage.getItem(PHASE1_CSS_THEME_STORAGE_KEY)).toBe('waitly');
    expect(localStorage.getItem(PHASE1_PREFERRED_PHASE_KEY)).toBe('phase0');
  });

  it('does not overwrite a local header choice with the account copy', () => {
    localStorage.setItem(PHASE1_THEME_STORAGE_KEY, 'parchment');
    applyDisplayPrefsFromUser({
      site_theme: { phase1_theme: 'dark' },
    } as never);
    expect(localStorage.getItem(PHASE1_THEME_STORAGE_KEY)).toBe('parchment');
  });
});
