import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const updatesFile = path.join(repoRoot, 'src', 'generated', 'weeklyUpdates.json');

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

const raw = git([
  'log',
  '--first-parent',
  '--reverse',
  '--date=iso-strict',
  '--pretty=format:%ad%x1f%s%x1e',
]);

const entries =
  raw == null
    ? []
    : raw
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

fs.mkdirSync(path.dirname(updatesFile), { recursive: true });
fs.writeFileSync(updatesFile, `${JSON.stringify({ weeks }, null, 2)}\n`);
console.log(`Wrote ${weeks.length} weeks to ${path.relative(repoRoot, updatesFile)}`);
