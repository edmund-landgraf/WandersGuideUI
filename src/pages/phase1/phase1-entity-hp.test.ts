import { describe, expect, it } from 'vitest';
import type { Creature } from '@schemas/content';
import { fillCurrentHp } from './phase1-entity';

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
