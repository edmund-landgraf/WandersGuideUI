import { describe, expect, it } from 'vitest';
import { playerPartyDiceCombatants } from './phase1-dice-check';

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
