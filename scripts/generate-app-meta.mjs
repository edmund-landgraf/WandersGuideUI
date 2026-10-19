import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = path.join(repoRoot, 'src', 'generated', 'appVersion.json');
const updatesFile = path.join(repoRoot, 'src', 'generated', 'weeklyUpdates.json');

const APP_VERSION_MAJOR = 2;
const APP_VERSION_INCLUDED_THROUGH = '3376ea4b54e59e42fc93c00f214ed1aa7dfd0fa9';
const APP_VERSION_BASE_MINOR = 1;
const APP_VERSION_BASE_PATCH = 0;
const APP_VERSION_PATCH_MAX_LINES = 1;

const FALLBACK_STAMP = {
  version: `${APP_VERSION_MAJOR}.${APP_VERSION_BASE_MINOR}.${APP_VERSION_BASE_PATCH}`,
  shortSha: 'unknown',
  historyHash: 'unknown',
  commitCount: 0,
};

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? '').trimEnd();
}

function isNoisyVersionPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  if (base === 'package-lock.json') return true;
  if (normalized.includes('/node_modules/') || normalized.startsWith('node_modules/')) return true;
  if (normalized === 'dist' || normalized.startsWith('dist/')) return true;
  if (base === 'stats.html') return true;
  return false;
}

function parseGitNumstatLog(text) {
  const commits = [];
  let current = null;
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) continue;
    if (/^[0-9a-f]{7,40}\t/i.test(line) && !/^[0-9-]+\t/.test(line)) {
      const [sha, parents = ''] = line.split('\t');
      const parentList = parents.trim() ? parents.trim().split(/\s+/).filter(Boolean) : [];
      current = { sha, isMerge: parentList.length > 1, files: [] };
      commits.push(current);
      continue;
    }
    if (!current) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? 0 : Number(parts[0]);
    const deleted = parts[1] === '-' ? 0 : Number(parts[1]);
    if (!Number.isFinite(added) || !Number.isFinite(deleted)) continue;
    current.files.push({ path: parts.slice(2).join('\t'), added, deleted });
  }
  return commits;
}

function bumpAppVersion(commits) {
  let minor = APP_VERSION_BASE_MINOR;
  let patch = APP_VERSION_BASE_PATCH;
  for (const commit of commits) {
    if (commit.isMerge) continue;
    let n = 0;
    for (const file of commit.files) {
      if (isNoisyVersionPath(file.path)) continue;
      n += file.added + file.deleted;
    }
    if (n >= APP_VERSION_PATCH_MAX_LINES) {
      minor += 1;
      patch = 0;
    } else {
      patch += 1;
    }
  }
  return { major: APP_VERSION_MAJOR, minor, patch };
}

function historyHash(shas) {
  return createHash('sha1').update(shas.join('')).digest('hex').slice(0, 7);
}

function weekStartKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return String(iso).slice(0, 10);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday));
  return start.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStart) {
  const start = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(start.valueOf())) return weekStart;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  const endLabel = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${startLabel} – ${endLabel}`;
}

function sentenceFromSubject(subject) {
  const trimmed = String(subject ?? '').replace(/^Merge pull request #\d+ from \S+\s*/i, '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

function summarizeSubjects(subjects) {
  const sentences = subjects.map(sentenceFromSubject).filter(Boolean);
  if (sentences.length === 0) return 'No public updates this week.';
  const limit = 520;
  const shown = [];
  for (const sentence of sentences) {
    const next = shown.length === 0 ? sentence : `${shown.join(' ')} ${sentence}`;
    if (next.length > limit && shown.length > 0) break;
    shown.push(sentence);
    if (next.length > limit) break;
  }
  const overflow = sentences.length - shown.length;
  const body = shown.join(' ');
  return overflow > 0 ? `${body} Plus ${overflow} more.` : body;
}

function isPublicUpdateSubject(subject) {
  const normalized = String(subject ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('merge ')) return false;
  return true;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeVersion() {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    if (!fs.existsSync(versionFile)) writeJson(versionFile, FALLBACK_STAMP);
    return;
  }
  const head = git(['rev-parse', 'HEAD']);
  const shortSha = git(['rev-parse', '--short=7', 'HEAD']);
  if (!head || !shortSha) {
    writeJson(versionFile, FALLBACK_STAMP);
    return;
  }
  const range = `${APP_VERSION_INCLUDED_THROUGH}..HEAD`;
  const logText = git(['log', '--first-parent', '--reverse', '--pretty=format:%H%x09%P', '--numstat', range]) ?? '';
  const commits = parseGitNumstatLog(logText);
  const parts = bumpAppVersion(commits);
  const countedShas = commits.filter((commit) => !commit.isMerge).map((commit) => commit.sha);
  writeJson(versionFile, {
    version: `${parts.major}.${parts.minor}.${parts.patch}`,
    shortSha,
    historyHash: historyHash([APP_VERSION_INCLUDED_THROUGH, ...countedShas]),
    commitCount: countedShas.length,
  });
}

function writeWeeklyUpdates() {
  const raw = git([
    'log',
    '--first-parent',
    '--reverse',
    '--date=iso-strict',
    '--pretty=format:%ad%x1f%s%x1e',
  ]);
  if (raw == null) {
    if (!fs.existsSync(updatesFile)) writeJson(updatesFile, { weeks: [] });
    return;
  }
  const entries = raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [date, subject = ''] = record.split('\x1f');
      return { date, subject };
    })
    .filter((entry) => isPublicUpdateSubject(entry.subject));

  const groups = new Map();
  const order = [];
  for (const entry of entries) {
    const key = weekStartKey(entry.date);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    if (sentenceFromSubject(entry.subject)) groups.get(key).push(entry.subject);
  }
  const weeks = order.map((weekStart) => {
    const subjects = groups.get(weekStart) ?? [];
    return {
      weekStart,
      label: formatWeekLabel(weekStart),
      count: subjects.length,
      summary: summarizeSubjects(subjects),
      subjects: subjects.map(sentenceFromSubject),
    };
  });
  writeJson(updatesFile, { weeks });
}

writeVersion();
writeWeeklyUpdates();
