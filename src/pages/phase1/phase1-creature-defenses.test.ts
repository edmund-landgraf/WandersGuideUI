import { describe, expect, it } from 'vitest';
import type { Creature } from '@schemas/content';
import { alignCreatureDefenses, readStoredDefenses } from './phase1-creature-defenses';

function creature(name: string, hp: number, source: string): Creature {
  return {
    id: 1,
    name,
    level: 1,
    hp_current: hp,
    operations: [{ type: 'adjValue', data: { variable: 'MAX_HEALTH_BONUS', value: hp } }],
    meta_data: { calculated_stats: { hp_max: hp } },
    notes: { pages: [{ name: 'Source', icon: 'notebook', color: '#359fdf', contents: source }] },
    details: { description: '' },
  } as unknown as Creature;
}

describe('alignCreatureDefenses', () => {
  it('raises a raw health bonus to the source-block HP and fills missing defenses', () => {
    const eel = alignCreatureDefenses(creature('Electric Eel', 16, 'HP 18, AC 16, Fort +7, Ref +7, Will +4'));
    const fox = alignCreatureDefenses(creature('Ember Fox', 31, 'HP 35 AC 18 Fort +6 Ref +10 Will +8'));
    expect(readStoredDefenses(eel)).toMatchObject({ hp: 18, ac: 16, fort: 7, reflex: 7, will: 4 });
    expect(eel.hp_current).toBe(18);
    expect(readStoredDefenses(fox)).toMatchObject({ hp: 35, ac: 18, fort: 6, reflex: 10, will: 8 });
    expect(fox.hp_current).toBe(35);
  });

  it('keeps a current HP that is already below the stored maximum', () => {
    const wounded = creature('Electric Eel', 16, 'HP 18, AC 16, Fort +7, Ref +7, Will +4');
    wounded.hp_current = 9;
    const aligned = alignCreatureDefenses(wounded);
    expect(aligned.hp_current).toBe(9);
    expect(readStoredDefenses(aligned).hp).toBe(18);
  });

  it('leaves a creature that already has defenses unchanged', () => {
    const ready = creature('Wolf', 20, 'HP 40, AC 15, Fort +8, Ref +6, Will +4');
    ready.operations = [
      { type: 'adjValue', data: { variable: 'MAX_HEALTH_BONUS', value: 20 } },
      { type: 'adjValue', data: { variable: 'AC_BONUS', value: 5 } },
      { type: 'addBonusToValue', data: { variable: 'SAVE_FORT', value: 8 } },
      { type: 'addBonusToValue', data: { variable: 'SAVE_REFLEX', value: 6 } },
      { type: 'addBonusToValue', data: { variable: 'SAVE_WILL', value: 4 } },
    ] as Creature['operations'];
    expect(alignCreatureDefenses(ready)).toBe(ready);
  });
});
