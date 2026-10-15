import { describe, expect, it } from 'vitest';
import { parseAbility } from './tactics-parse';
import { composeTurns } from './tactics-turns';
import type { TacticsCombatant } from './tactics-types';

function fighter(partial: Partial<TacticsCombatant> & Pick<TacticsCombatant, 'id' | 'name' | 'side'>): TacticsCombatant {
  return {
    hpCurrent: 20,
    hpMax: 20,
    ac: 18,
    conditions: [],
    resistances: [],
    abilities: [],
    ...partial,
  };
}

describe('composeTurns', () => {
  it('prints attack bonus, AC, range, and a concealed flat check', () => {
    const bow = parseAbility({
      id: 'bow',
      name: 'shortbow',
      actions: 'ONE-ACTION',
      traits: ['agile'],
      description: 'Ranged Strike +9, Damage 1d6 piercing. Range 60 feet. The target is concealed.',
    });
    const actor = fighter({
      id: 'goblin',
      name: 'Goblin',
      side: 'enemy',
      abilities: [{ ...bow, attackBonus: 7 }],
    });
    const ada = fighter({ id: 'ada', name: 'Ada', side: 'ally', ac: 18 });
    const [choice] = composeTurns(actor, [actor, ada], []);
    expect(choice.text).toContain('Stay within shortbow range, 60 feet');
    expect(choice.text).toContain('flat check DC 5');
    expect(choice.text).toContain('AC is 18');
    expect(choice.text).toContain('+7');
    expect(choice.text).toContain('1d6 piercing');
  });

  it('keeps a pollen cloud and warns that a later Strike ends fascination', () => {
    const cloud = parseAbility({
      id: 'pollen',
      name: 'Pollen cloud',
      actions: 'TWO-ACTIONS',
      description: 'The plant releases a 10-foot burst of pollen. Fortitude DC 19. Failure: fascinated. Concentrate.',
    });
    const actor = fighter({ id: 'plant', name: 'Plant', side: 'enemy', abilities: [cloud] });
    const ada = fighter({ id: 'ada', name: 'Ada', side: 'ally' });
    const choices = composeTurns(actor, [actor, ada], []);
    expect(choices.some((choice) => choice.text.includes('Fortitude save vs your DC 19'))).toBe(true);
    expect(choices.some((choice) => choice.text.includes('ends fascination'))).toBe(true);
  });

  it('lists three actions and keeps Fist as the last bullet', () => {
    const spade = parseAbility({ id: 'spade', name: 'Spade', actions: 'ONE-ACTION', description: 'Melee Strike +7, Damage 1d6 piercing.' });
    const fist = parseAbility({ id: 'fist', name: 'Fist', actions: 'ONE-ACTION', description: 'Melee Strike +7, Damage 1d4 bludgeoning.' });
    const actor = fighter({ id: 'mob', name: 'Mob', side: 'enemy', abilities: [fist, spade] });
    const hunnger = fighter({ id: 'hunnger', name: 'Hunnger', side: 'ally', ac: 18 });
    const [choice] = composeTurns(actor, [actor, hunnger], []);
    expect(choice.lines).toHaveLength(3);
    expect(choice.lines[0]).toContain('with Spade');
    expect(choice.lines[1]).toContain('with Spade');
    expect(choice.lines[2]).toContain('with Fist');
    expect(choice.lines[0]).not.toContain('with Fist');
  });

  it('drops healing when every ally is at full hit points', () => {
    const heal = parseAbility({ id: 'heal', name: 'Heal', actions: 'ONE-ACTION', description: 'You heal an ally.' });
    const actor = fighter({ id: 'cleric', name: 'Cleric', side: 'enemy', abilities: [heal] });
    const ally = fighter({ id: 'brute', name: 'Brute', side: 'enemy' });
    expect(composeTurns(actor, [actor, ally], []).some((choice) => /Heal/.test(choice.text))).toBe(false);
  });
});
