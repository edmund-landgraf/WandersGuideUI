/** Frozen product major. Matches package.json until a real major ships. */
export const APP_VERSION_MAJOR = 2;

/** History through this commit is already folded into 2.1.0. */
export const APP_VERSION_INCLUDED_THROUGH = '3376ea4b54e59e42fc93c00f214ed1aa7dfd0fa9';

export const APP_VERSION_BASE_MINOR = 1;
export const APP_VERSION_BASE_PATCH = 0;

/** Any real line change bumps the minor (2.1, 2.2, …). */
export const APP_VERSION_PATCH_MAX_LINES = 1;

export type AppVersionStamp = {
  version: string;
  shortSha: string;
  historyHash: string;
  commitCount: number;
};

export const FALLBACK_APP_VERSION_STAMP: AppVersionStamp = {
  version: `${APP_VERSION_MAJOR}.${APP_VERSION_BASE_MINOR}.${APP_VERSION_BASE_PATCH}`,
  shortSha: 'unknown',
  historyHash: 'unknown',
  commitCount: 0,
};

export type CommitLineFile = {
  path: string;
  added: number;
  deleted: number;
};

export type VersionCommit = {
  sha: string;
  isMerge: boolean;
  files: CommitLineFile[];
};

export function isNoisyVersionPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  if (base === 'package-lock.json') return true;
  if (normalized.includes('/node_modules/') || normalized.startsWith('node_modules/')) return true;
  if (normalized === 'dist' || normalized.startsWith('dist/')) return true;
  if (base === 'stats.html') return true;
  return false;
}

export function countCommitLines(files: CommitLineFile[]): number {
  let total = 0;
  for (const file of files) {
    if (isNoisyVersionPath(file.path)) continue;
    total += file.added + file.deleted;
  }
  return total;
}

export function bumpAppVersion(commits: VersionCommit[]): {
  major: number;
  minor: number;
  patch: number;
} {
  let minor = APP_VERSION_BASE_MINOR;
  let patch = APP_VERSION_BASE_PATCH;
  for (const commit of commits) {
    if (commit.isMerge) continue;
    const n = countCommitLines(commit.files);
    if (n >= APP_VERSION_PATCH_MAX_LINES) {
      minor += 1;
      patch = 0;
    } else {
      patch += 1;
    }
  }
  return { major: APP_VERSION_MAJOR, minor, patch };
}

export function formatAppVersion(parts: { major: number; minor: number; patch: number }): string {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

export function formatAppVersionLabel(stamp: AppVersionStamp): string {
  return `v${stamp.version} · ${stamp.shortSha}`;
}

export function formatAppVersionTitle(stamp: AppVersionStamp): string {
  return `WGUI ${stamp.version} (git ${stamp.shortSha}, history ${stamp.historyHash})`;
}
