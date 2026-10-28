import { describe, expect, it } from 'vitest';
import { adoptServerDiceLogs, gmDiceAudience, normalizeDiceRollLog, overlayDiceRollMeta, playerPartyDiceCombatants, playerVisibleDiceRollLog } from './phase1-dice-check';
import type { Encounter } from '../../schemas/content';

describe('playerPartyDiceCombatants', () => {
  it('keeps character combatants and drops creatures', () => {
    expect(playerPartyDiceCombatants([
      { type: 'CHARACTER', _id: 'pc' },
      { type: 'CREATURE', _id: 'gob' },
      { type: 'CHARACTER', _id: 'pc2' },
    ])).toEqual([
      { type: 'CHARACTER', _id: 'pc' },
      { type: 'CHARACTER', _id: 'pc2' },
    ]);
  });
});

describe('playerVisibleDiceRollLog', () => {
  it('drops private GM rolls and keeps public and player rolls', () => {
    const log = [
      { audience: 'private' as const, entries: [{ ally: true }] },
      { audience: 'public' as const, entries: [{ ally: false }] },
      { entries: [{ ally: true }] },
    ];
    expect(playerVisibleDiceRollLog(log)).toEqual([log[1], log[2]]);
    expect(gmDiceAudience(undefined)).toBe('public');
    expect(gmDiceAudience('private')).toBe('private');
    expect(gmDiceAudience('public')).toBe('public');
  });
});

describe('normalizeDiceRollLog', () => {
  it('groups legacy flat initiative rows into one round', () => {
    expect(normalizeDiceRollLog([
      { name: 'Malkus', roll: 18, stat: 'Perception', title: 'Initiative', total: 26, modifier: 8 },
      { name: 'Doku', roll: 20, stat: 'Perception', title: 'Initiative', total: 25, modifier: 5 },
    ])).toEqual([{
      title: 'Initiative',
      dc: 0,
      defaultStat: 'Perception',
      entries: [
        { name: 'Malkus', ally: true, calculation: '18 + 8 = 26', total: 26 },
        { name: 'Doku', ally: true, calculation: '20 + 5 = 25', total: 25 },
      ],
    }]);
  });
});

describe('adoptServerDiceLogs', () => {
  it('replaces a longer local log when the server log was cleared', () => {
    const encounters = [{ id: 1, meta_data: { dice_roll_log: [] } }] as unknown as Encounter[];
    const logs = new Map([[1, [{ id: 'old' } as never]]]);
    adoptServerDiceLogs(encounters, logs);
    const overlaid = overlayDiceRollMeta(encounters, logs, new Map());
    expect(overlaid[0]?.meta_data.dice_roll_log).toEqual([]);
  });
});
