import { describe, expect, it } from 'vitest';
import { roundTripNotesMarkdown } from './phase1-plate-notes';

const formatted = ['# Notes', '', '**Joerg** is a *dedicated* warrior.', '', '## Gear', '', '- longsword', '- shield', '', '`action_symbol_1` Strike', '', '[Archives](https://2e.aonprd.com)'].join('\n');

describe('sheet notes markdown round trip', () => {
  it('keeps formatting after save and reload', () => {
    const saved = roundTripNotesMarkdown(formatted);
    const reloaded = roundTripNotesMarkdown(saved);

    expect(saved).toContain('**Joerg**');
    expect(saved).toMatch(/\*dedicated\*|_dedicated_/);
    expect(saved).toMatch(/gear/i);
    expect(saved).toContain('longsword');
    expect(saved).toContain('action_symbol_1');
    expect(saved).toContain('https://2e.aonprd.com');
    expect(reloaded).toBe(saved);
  });

  it('keeps a Wanderer\'s Guide condition link', () => {
    const saved = roundTripNotesMarkdown('See [Hidden](<link_condition_hidden>) nearby.');
    expect(saved).toContain('[Hidden](<link_condition_hidden>)');
    expect(roundTripNotesMarkdown(saved)).toBe(saved);
  });

  it('keeps a blank line created with enter', () => {
    const saved = roundTripNotesMarkdown('First line\n\nSecond line');
    expect(saved).toContain('First line');
    expect(saved).toContain('Second line');
    expect(saved).toMatch(/First line\n\nSecond line/);
  });
});
