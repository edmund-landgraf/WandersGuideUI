import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPhase1CssTheme,
  isPhase1CssTheme,
  persistPhase1CssTheme,
  PHASE1_CSS_THEME_STORAGE_KEY,
  PHASE1_CSS_THEME_TOKENS,
  readAppliedCssThemeTokens,
  readStoredPhase1CssTheme,
} from './phase1-css-theme';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'phase1.css');

describe('phase1 css themes', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-css-theme');
    document.documentElement.className = '';
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('keeps default and waitly fonts and radii far apart', () => {
    const { default: defaultTheme, waitly } = PHASE1_CSS_THEME_TOKENS;
    expect(defaultTheme.fontSans).toContain('Inter');
    expect(defaultTheme.fontSans).not.toContain('Plus Jakarta');
    expect(waitly.fontSans).toContain('Plus Jakarta Sans');
    expect(waitly.fontHeading).toContain('Cal Sans');
    expect(defaultTheme.radius).toBe('0px');
    expect(waitly.radius).toBe('0.75rem');
    expect(defaultTheme.fontSans).not.toBe(waitly.fontSans);
    expect(defaultTheme.radius).not.toBe(waitly.radius);
  });

  it('applies waitly then fully restores default tokens', () => {
    applyPhase1CssTheme('waitly');
    expect(readAppliedCssThemeTokens()).toMatchObject({
      cssTheme: 'waitly',
      fontSans: PHASE1_CSS_THEME_TOKENS.waitly.fontSans,
      fontHeading: PHASE1_CSS_THEME_TOKENS.waitly.fontHeading,
      radius: PHASE1_CSS_THEME_TOKENS.waitly.radius,
      waitlyClass: true,
      defaultClass: false,
    });

    applyPhase1CssTheme('default');
    expect(readAppliedCssThemeTokens()).toMatchObject({
      cssTheme: 'default',
      fontSans: PHASE1_CSS_THEME_TOKENS.default.fontSans,
      fontHeading: PHASE1_CSS_THEME_TOKENS.default.fontHeading,
      radius: PHASE1_CSS_THEME_TOKENS.default.radius,
      waitlyClass: false,
      defaultClass: true,
    });
  });

  it('persists the chosen theme and reads it back', () => {
    persistPhase1CssTheme('waitly');
    expect(localStorage.getItem(PHASE1_CSS_THEME_STORAGE_KEY)).toBe('waitly');
    expect(readStoredPhase1CssTheme()).toBe('waitly');
    persistPhase1CssTheme('default');
    expect(readStoredPhase1CssTheme()).toBe('default');
  });

  it('rejects unknown theme ids', () => {
    expect(isPhase1CssTheme('waitly')).toBe(true);
    expect(isPhase1CssTheme('default')).toBe(true);
    expect(isPhase1CssTheme('georgia')).toBe(false);
    expect(isPhase1CssTheme(null)).toBe(false);
  });

  it('stylesheet restores gold default chrome and waitly greyscale separately', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain("[data-css-theme='waitly']");
    expect(css).toContain("[data-css-theme='default']");
    expect(css).toMatch(/\[data-css-theme='default'\][\s\S]*Inter/);
    expect(css).toMatch(/\[data-css-theme='waitly'\][\s\S]*Plus Jakarta Sans/);
    expect(css).toContain('--p1-accent: #d6a85f');
    expect(css).toContain("[data-css-theme='waitly'][data-theme='parchment']");
    expect(css).toContain('--p1-radius: 0px');
    expect(css).toContain('--p1-radius: 0.75rem');
    expect(css).not.toContain('Georgia');
  });
});
