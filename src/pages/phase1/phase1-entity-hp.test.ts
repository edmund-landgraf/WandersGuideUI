import { describe, expect, it } from 'vitest';
import type { Creature } from '@schemas/content';
import { calculatedStatsForHydration, fillCurrentHp } from './phase1-entity';

function creature(hp: number): Creature {
  return { hp_current: hp, hp_temp: 3, meta_data: { calculated_stats: { hp_max: 30 } } } as Creature;
}

describe('encounter creature HP hydration', () => {
  it.each([0, 1, 17, 30])('preserves live current HP %i and temporary HP', (hp) => {
    const source = creature(hp);
    expect(fillCurrentHp(source, 30)).toBe(source);
    expect(fillCurrentHp(source, 35).hp_current).toBe(hp);
    expect(fillCurrentHp(source, 35).hp_temp).toBe(3);
  });
  it('initializes HP only on the explicit new-creature path', () => {
    expect(fillCurrentHp(creature(0), 35, true).hp_current).toBe(35);
    expect(fillCurrentHp(creature(1), 30, true).hp_current).toBe(30);
  });
});

describe('catalog hydration with incomplete stored defenses', () => {
  it('uses complete catalog statistics even when the encounter operations contain saves', () => {
    const source = { ...creature(16), operations: [
      { type: 'adjValue', data: { variable: 'AC_BONUS', value: 6 } },
      { type: 'adjValue', data: { variable: 'MAX_HEALTH_BONUS', value: 16 } },
      ...['SAVE_FORT','SAVE_REFLEX','SAVE_WILL'].map(variable => ({type:'addBonusToValue', data:{variable,value:7}})),
    ], meta_data:{calculated_stats:{hp_max:16}} } as unknown as Creature;
    const catalog = { ...source, hp_current:18, meta_data:{calculated_stats:{hp_max:18, ac:16, profs:{
      SAVE_FORT:{total:7,type:'T'}, SAVE_REFLEX:{total:7,type:'T'}, SAVE_WILL:{total:4,type:'T'},
    }}} } as unknown as Creature;
    expect(calculatedStatsForHydration(source,catalog)).toEqual(catalog.meta_data?.calculated_stats);
    expect(calculatedStatsForHydration(catalog,source)).toEqual(catalog.meta_data?.calculated_stats);
    expect(fillCurrentHp(source,18).hp_current).toBe(16);
  });
});
