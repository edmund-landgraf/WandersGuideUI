export type WeeklyUpdate = {
  weekStart: string;
  label: string;
  count: number;
  summary: string;
  subjects: string[];
};

const SUMMARY_LIMIT = 520;

export function weekStartKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso.slice(0, 10);
  const day = date.getUTCDay();
  const sinceMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday));
  return start.toISOString().slice(0, 10);
}

export function formatWeekLabel(weekStart: string): string {
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

export function sentenceFromSubject(subject: string): string {
  const trimmed = subject.replace(/^Merge pull request #\d+ from \S+\s*/i, '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

export function summarizeSubjects(subjects: string[]): string {
  const sentences = subjects.map(sentenceFromSubject).filter(Boolean);
  if (sentences.length === 0) return 'No public updates this week.';
  let used = 0;
  const shown: string[] = [];
  for (const sentence of sentences) {
    const next = shown.length === 0 ? sentence : `${shown.join(' ')} ${sentence}`;
    if (next.length > SUMMARY_LIMIT && shown.length > 0) break;
    shown.push(sentence);
    used += 1;
    if (next.length > SUMMARY_LIMIT) break;
  }
  const overflow = sentences.length - used;
  const body = shown.join(' ');
  return overflow > 0 ? `${body} Plus ${overflow} more.` : body;
}

export type UpdateGroup = {
  title: string;
  items: string[];
};

const UPDATE_GROUPS: { title: string; test: RegExp }[] = [
  { title: 'Art and maps', test: /\bart\b|image|map\b|owlbear|lightbox/i },
  { title: 'Encounters and combat', test: /encounter|combat|dice|initiative|tactics|creature|hazard|xp\b/i },
  { title: 'Accounts', test: /account|oauth|sign-in|sign in|login|session|patreon/i },
  { title: 'Campaigns', test: /campaign|roster|join key|join-key|party/i },
  { title: 'Characters', test: /character|builder|ancestry|\bclass\b|spellbook|character sheet/i },
  { title: 'Help and docs', test: /\bhelp\b|document|docs\b|walkthrough/i },
];

/** First matching topic wins so a line appears in only one group. */
export function groupUpdateLines(subjects: string[]): UpdateGroup[] {
  const claimed = new Set<number>();
  const groups: UpdateGroup[] = [];
  for (const bucket of UPDATE_GROUPS) {
    const items: string[] = [];
    subjects.forEach((subject, index) => {
      if (claimed.has(index) || !bucket.test.test(subject)) return;
      claimed.add(index);
      items.push(subject);
    });
    if (items.length > 0) groups.push({ title: bucket.title, items });
  }
  const rest = subjects.filter((_, index) => !claimed.has(index));
  if (rest.length > 0) groups.push({ title: 'Also', items: rest });
  return groups;
}

export function groupSubjectsByWeek(
  entries: { date: string; subject: string }[],
): WeeklyUpdate[] {
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  for (const entry of entries) {
    const key = weekStartKey(entry.date);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    const sentence = sentenceFromSubject(entry.subject);
    if (sentence) groups.get(key)!.push(entry.subject);
  }
  return order.map((weekStart) => {
    const subjects = groups.get(weekStart) ?? [];
    return {
      weekStart,
      label: formatWeekLabel(weekStart),
      count: subjects.length,
      summary: summarizeSubjects(subjects),
      subjects: subjects.map(sentenceFromSubject),
    };
  });
}
