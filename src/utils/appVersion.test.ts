import { describe, expect, it } from 'vitest';
import {
  APP_VERSION_BASE_MINOR,
  APP_VERSION_MAJOR,
  bumpAppVersion,
  countCommitLines,
  formatAppVersion,
  formatAppVersionLabel,
  formatAppVersionTitle,
  isNoisyVersionPath,
} from './appVersion';

describe('isNoisyVersionPath', () => {
  it('ignores lockfiles, vendor, and build output', () => {
    expect(isNoisyVersionPath('package-lock.json')).toBe(true);
    expect(isNoisyVersionPath('node_modules/foo/index.js')).toBe(true);
    expect(isNoisyVersionPath('dist/assets/index.js')).toBe(true);
    expect(isNoisyVersionPath('stats.html')).toBe(true);
    expect(isNoisyVersionPath('src/pages/HomePage.tsx')).toBe(false);
  });
});

describe('countCommitLines', () => {
  it('sums added and deleted lines except noisy paths', () => {
    expect(
      countCommitLines([
        { path: 'src/a.ts', added: 4, deleted: 1 },
        { path: 'package-lock.json', added: 400, deleted: 20 },
      ]),
    ).toBe(5);
  });
});

describe('bumpAppVersion', () => {
  it('starts at 2.1.0 with no commits', () => {
    expect(formatAppVersion(bumpAppVersion([]))).toBe(`2.${APP_VERSION_BASE_MINOR}.0`);
    expect(APP_VERSION_MAJOR).toBe(2);
  });

  it('bumps patch only for empty counted commits', () => {
    const next = bumpAppVersion([
      { sha: 'a', isMerge: false, files: [{ path: 'package-lock.json', added: 400, deleted: 20 }] },
    ]);
    expect(formatAppVersion(next)).toBe('2.1.1');
  });

  it('bumps minor for any real line change', () => {
    const next = bumpAppVersion([
      { sha: 'a', isMerge: false, files: [{ path: 'src/a.ts', added: 1, deleted: 0 }] },
    ]);
    expect(formatAppVersion(next)).toBe('2.2.0');
  });

  it('skips merge commits', () => {
    const next = bumpAppVersion([
      { sha: 'm', isMerge: true, files: [{ path: 'src/a.ts', added: 80, deleted: 10 }] },
      { sha: 'a', isMerge: false, files: [{ path: 'src/a.ts', added: 1, deleted: 0 }] },
    ]);
    expect(formatAppVersion(next)).toBe('2.2.0');
  });
});

describe('formatAppVersionLabel', () => {
  it('renders the home-page stamp', () => {
    const stamp = {
      version: '2.2.0',
      shortSha: 'a3f1c2e',
      historyHash: 'abcdef0',
      commitCount: 1,
    };
    expect(formatAppVersionLabel(stamp)).toBe('v2.2.0 · a3f1c2e');
    expect(formatAppVersionTitle(stamp)).toBe('WGUI 2.2.0 (git a3f1c2e, history abcdef0)');
  });
});
