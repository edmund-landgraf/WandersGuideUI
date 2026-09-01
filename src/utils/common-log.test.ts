import { describe, expect, it } from 'vitest';
import { appendCommonLog, getCommonLog, subscribeCommonLog } from './common-log';

describe('common-log', () => {
  it('appends entries, notifies subscribers, and caps at 100', () => {
    const seen: string[] = [];
    const unsub = subscribeCommonLog((entry) => {
      seen.push(entry.message);
    });
    const entry = appendCommonLog('operations', 'test failure');
    expect(entry.source).toBe('operations');
    expect(entry.message).toBe('test failure');
    expect(getCommonLog().at(-1)?.message).toBe('test failure');
    expect(seen).toContain('test failure');
    unsub();
  });
});
