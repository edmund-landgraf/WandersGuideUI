import { describe, expect, it } from 'vitest';
import {
  formatWeekLabel,
  groupSubjectsByWeek,
  groupUpdateLines,
  summarizeSubjects,
  weekStartKey,
} from './weeklyUpdates';

describe('weekStartKey', () => {
  it('uses the Monday of the UTC week', () => {
    expect(weekStartKey('2026-10-18T15:00:00-07:00')).toBe('2026-10-12');
    expect(weekStartKey('2026-10-12T00:00:00Z')).toBe('2026-10-12');
  });
});

describe('formatWeekLabel', () => {
  it('spans Monday through Sunday', () => {
    expect(formatWeekLabel('2026-10-12')).toBe('Oct 12 – Oct 18, 2026');
  });
});

describe('summarizeSubjects', () => {
  it('joins subjects into one paragraph', () => {
    expect(summarizeSubjects(['Add the roster', 'Hide notes from players.'])).toBe(
      'Add the roster. Hide notes from players.',
    );
  });
});

describe('groupUpdateLines', () => {
  it('puts each line in one indented group', () => {
    const groups = groupUpdateLines([
      'Add a character sheet.',
      'Show shared dice for initiative.',
      'Fix the production build.',
    ]);
    expect(groups.map((group) => group.title)).toEqual(['Characters', 'Encounters and combat', 'Also']);
    expect(groups[0].items).toEqual(['Add a character sheet.']);
  });
});

describe('groupSubjectsByWeek', () => {
  it('keeps weeks in log order and skips empty subjects', () => {
    const weeks = groupSubjectsByWeek([
      { date: '2026-10-13T12:00:00Z', subject: 'First change' },
      { date: '2026-10-18T12:00:00Z', subject: 'Second change' },
      { date: '2026-10-20T12:00:00Z', subject: 'Next week' },
    ]);
    expect(weeks.map((week) => week.weekStart)).toEqual(['2026-10-12', '2026-10-19']);
    expect(weeks[0].count).toBe(2);
    expect(weeks[0].summary).toContain('First change.');
    expect(weeks[1].subjects).toEqual(['Next week.']);
  });
});
