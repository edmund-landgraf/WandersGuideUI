import { describe, expect, it } from 'vitest';
import {
  isEnemyCreature,
  isPlayerVisibleCombatant,
  playerAllyRoundLog,
  playerEnemyLabel,
  playerSaveDc,
  playerVisibleCombatants,
} from './phase1-player-combat';

describe('playerEnemyLabel', () => {
  it('initials from spaces and hyphens, no number', () => {
    expect(playerEnemyLabel('Blue-Ringed Octopus')).toBe('BRO');
  });

  it('keeps parenthetical instance', () => {
    expect(playerEnemyLabel('Mudjaw Lurkbloom (2)')).toBe('ML (2)');
  });

  it('concatenates trailing space-number', () => {
    expect(playerEnemyLabel('Reefclaw 1')).toBe('R1');
    expect(playerEnemyLabel('Grindylow 1')).toBe('G1');
  });
});

describe('playerVisibleCombatants', () => {
  const pc = { type: 'CHARACTER', ally: true, data: { hp_current: 0, name: 'Ada' } };
  const ally = { type: 'CREATURE', ally: true, data: { hp_current: 0, name: 'Wolf' } };
  const living = { type: 'CREATURE', ally: false, data: { hp_current: 12, name: 'Mudjaw Lurkbloom (2)' } };
  const dead1 = { type: 'CREATURE', ally: false, data: { hp_current: 0, name: 'Mudjaw Lurkbloom (1)' } };
  const dead3 = { type: 'CREATURE', ally: false, data: { hp_current: -3, name: 'Mudjaw Lurkbloom (3)' } };

  it('treats non-ally creatures as enemies', () => {
    expect(isEnemyCreature(living)).toBe(true);
    expect(isEnemyCreature(ally)).toBe(false);
    expect(isEnemyCreature(pc)).toBe(false);
  });

  it('keeps a new enemy whose HP has not been stored yet', () => {
    expect(isPlayerVisibleCombatant({ type: 'CREATURE', ally: false, data: { name: 'Jailer' } })).toBe(true);
    expect(isPlayerVisibleCombatant({ type: 'CREATURE', ally: false, data: { hp_current: null, name: 'Jailer' } })).toBe(true);
  });

  it('keeps PCs and ally creatures at 0 HP and drops dead enemies without renumbering', () => {
    const rows = playerVisibleCombatants([pc, dead1, living, dead3, ally]);
    expect(rows).toEqual([pc, living, ally]);
    expect(playerEnemyLabel(rows[1]!.data.name)).toBe('ML (2)');
    expect(isPlayerVisibleCombatant(dead1)).toBe(false);
  });
});

describe('playerAllyRoundLog', () => {
  it('keeps ally entries and drops rounds that only have enemies', () => {
    const log = [
      {
        round: 1,
        entries: [
          { name: 'Ada', ally: true, initiative: 18, calculation: '1d20+8' },
          { name: 'Wolf', ally: false, initiative: 12, calculation: '1d20+4' },
        ],
      },
      {
        round: 2,
        entries: [{ name: 'Jailer', ally: false, initiative: 9, calculation: '1d20+2' }],
      },
    ];
    expect(playerAllyRoundLog(log)).toEqual([
      {
        round: 1,
        entries: [{ name: 'Ada', ally: true, initiative: 18, calculation: '1d20+8' }],
      },
    ]);
  });
});

describe('playerSaveDc', () => {
  it('is 10 plus the modifier', () => {
    expect(playerSaveDc(4)).toBe(14);
    expect(playerSaveDc(-1)).toBe(9);
  });
});
