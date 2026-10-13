import { describe, expect, it } from 'vitest';
import { parseAbility } from './tactics-parse';
import { annotatePenalties, choiceFaults, legalMenu, rankChoices, separateActions, unusedActions } from './tactics-legal';
import type { TacticsChoice, TacticsCombatant } from './tactics-types';

function actor(): TacticsCombatant {
  return {
    id: 'shikigami',
    name: 'Shikigami (1)',
    side: 'enemy',
    hpCurrent: 20,
    hpMax: 20,
    ac: 15,
    conditions: [],
    description: 'A kami can merge with or emerge from their ward as a single action, which has the concentrate trait.',
    abilities: [
      {
        id: 'spade',
        name: 'Spade',
        actions: 1,
        traits: [],
        description: 'Melee Strike +7, Damage 1d6 piercing.',
        kind: 'strike',
        attackBonus: 7,
        damage: '1d6 piercing',
        agile: false,
        concentrate: false,
        concealed: false,
        hidden: false,
        fascinates: false,
      },
    ],
  };
}

function choice(lines: string[]): TacticsChoice {
  return { id: 'c', text: lines.join(' '), lines, score: 0, tip: '', abilityIds: [], source: 'menu' };
}

describe('choiceFaults', () => {
  it('accepts stride, a listed strike, and seek', () => {
    const turn = choice([
      'Stride to Nemeia.',
      'Strike Nemeia with Spade. Attack roll vs AC 18, bonus +7.',
      'Seek Nemeia.',
    ]);
    expect(choiceFaults(turn, actor())).toEqual([]);
  });

  it('keeps a turn that spends only 2 actions', () => {
    const turn = choice(['Stride to Nemeia.', 'Strike Nemeia with Spade.']);
    expect(choiceFaults(turn, actor())).toEqual([]);
    expect(unusedActions(turn.lines, actor())).toBe(1);
  });

  it('rejects seek and grapple on the same line', () => {
    const turn = choice(['Stride to Nemeia.', 'Seek to grapple Nemeia.', 'Demoralize Nemeia.']);
    expect(choiceFaults(turn, actor()).join(' ')).toContain('add up to 4');
    expect(choiceFaults(turn, actor()).join(' ')).not.toContain('add up to 0');
  });

  it('shows the remaster multiple attack penalty on the second and third attacks', () => {
    const agile = { ...actor().abilities[0], id: 'fist', name: 'Fist', agile: true };
    const sheet = { ...actor(), abilities: [...actor().abilities, agile] };
    const lines = annotatePenalties([
      'Strike with Spade.',
      'Grapple Nemeia.',
      'Strike with Fist.',
      'Demoralize Nemeia.',
      'Strike with Spade.',
    ], sheet);
    expect(lines[0]).not.toContain('Multiple attack penalty');
    expect(lines[1]).toContain('Multiple attack penalty −5');
    expect(lines[2]).toContain('Multiple attack penalty −8 (agile)');
    expect(lines[3]).not.toContain('Multiple attack penalty');
    expect(lines[4]).toContain('Multiple attack penalty −10');
  });

  it('matches a strike from the damage when the weapon name was left off', () => {
    const fist = parseAbility({ id: 'fist', name: 'Fist', actions: 'ONE-ACTION', description: 'Melee Strike +7, Damage 1d4 bludgeoning.' });
    const spade = parseAbility({ id: 'spade-a', name: 'Spade', actions: 'ONE-ACTION', description: 'Melee Strike +7, Damage 1d6+3 bludgeoning.' });
    const spadeAgain = { ...spade, id: 'spade-b' };
    const sheet = { ...actor(), abilities: [fist, spade, spadeAgain] };
    const turn = choice(['Stride to Nemeia.', 'Strike (1d6+3 bludgeoning damage), Seek Nemeia.']);
    expect(separateActions(turn.lines, sheet).some((line) => line.startsWith('Seek'))).toBe(true);
    expect(choiceFaults(turn, sheet)).toEqual([]);
    const unnamed = choice(['Stride to Nemeia.', 'Strike Nemeia.', 'Seek Nemeia.']);
    expect(choiceFaults(unnamed, sheet).join(' ')).toContain('Strike must name one of: Fist, Spade.');
  });

  it('rejects a strike that is not on the sheet', () => {
    const turn = choice(['Stride to Nemeia.', 'Strike Nemeia with Fist.', 'Seek Nemeia.']);
    expect(choiceFaults(turn, actor()).join(' ')).toContain('Strike must name');
  });

  it('keeps a full stride-strike-demoralize turn legal', () => {
    const turn = choice([
      'Stride to Ada.',
      'Strike Ada with Spade. Attack roll vs AC 18, bonus +7. Damage 1d6 piercing.',
      'Demoralize Ada. Intimidation vs Will DC 16.',
    ]);
    expect(choiceFaults(turn, actor())).toEqual([]);
  });

  it('puts the legal turn first', () => {
    const bad = choice(['Shikigami (1) Spade', 'AC 15']);
    const good = choice(['Stride to Nemeia.', 'Strike Nemeia with Spade.', 'Seek Nemeia.']);
    expect(rankChoices([bad, good], actor())[0]).toBe(good);
  });

  it('counts a two-action special and leaves one action', () => {
    const spore = parseAbility({
      id: 'spore',
      name: 'Release Sporebloom',
      actions: 'TWO-ACTIONS',
      frequency: 'once per day',
      description: 'The plant releases a cloud of spores. Fortitude DC 19.',
    });
    const withSpore = { ...actor(), abilities: [...actor().abilities, spore] };
    const turn = choice(['Stride to Nemeia.', 'Release Sporebloom. Fortitude save vs DC 19.']);
    expect(spore.actions).toBe(2);
    expect(choiceFaults(turn, withSpore)).toEqual([]);
    expect(legalMenu(withSpore)).toContain('Release Sporebloom (2 actions)');
    expect(legalMenu(withSpore)).toContain('once per day');
    const crowded = choice(['Stride to Nemeia.', 'Release Sporebloom.', 'Strike Nemeia with Spade.']);
    expect(choiceFaults(crowded, withSpore).join(' ')).toContain('add up to 4');
  });

  it('reads two actions from the ability text when the cost field is empty', () => {
    const spore = parseAbility({
      id: 'spore',
      name: 'Release Sporebloom',
      description: 'Two actions. The plant releases spores.',
    });
    expect(spore.actions).toBe(2);
  });

  it('uses a loaded catalog action instead of only the short list', () => {
    const climb = {
      id: 'climb',
      name: 'Climb',
      actions: 1,
      traits: [],
      description: 'You move up a slope or vertical surface.',
      kind: 'other' as const,
      agile: false,
      concentrate: false,
      concealed: false,
      hidden: false,
      fascinates: false,
    };
    const turn = choice(['Climb the wall.', 'Strike Nemeia with Spade.', 'Seek Nemeia.']);
    expect(choiceFaults(turn, actor(), [climb, { ...climb, id: 'seek', name: 'Seek' }, { ...climb, id: 'strike', name: 'Strike' }])).toEqual([]);
    expect(legalMenu(actor(), [climb])).toContain('Climb');
  });

  it('lists seek and the real attack in the menu', () => {
    const menu = legalMenu(actor());
    expect(menu).toContain('Seek');
    expect(menu).toContain('Strike with Spade');
    expect(menu).toContain('Melee Strike +7');
    expect(menu).not.toContain('Fist');
  });
});
