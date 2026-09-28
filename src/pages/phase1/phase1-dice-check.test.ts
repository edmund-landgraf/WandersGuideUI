import { describe, expect, it } from 'vitest';
import { adoptServerDiceLogs, overlayDiceRollMeta, playerPartyDiceCombatants } from './phase1-dice-check';
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

describe('adoptServerDiceLogs', () => {
  it('replaces a longer local log when the server log was cleared', () => {
    const encounters = [{ id: 1, meta_data: { dice_roll_log: [] } }] as unknown as Encounter[];
    const logs = new Map([[1, [{ id: 'old' } as never]]]);
    adoptServerDiceLogs(encounters, logs);
    const overlaid = overlayDiceRollMeta(encounters, logs, new Map());
    expect(overlaid[0]?.meta_data.dice_roll_log).toEqual([]);
  });
});
