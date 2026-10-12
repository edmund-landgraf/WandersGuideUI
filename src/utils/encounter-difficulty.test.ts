import type { Encounter } from '@schemas/content';
import { describe, expect, it } from 'vitest';
import { calculateDifficulty, encounterBudget, type EncounterDifficultyCombatant } from './encounter-difficulty';

function party(size: number, level = 2): EncounterDifficultyCombatant[] {
  return Array.from({ length: size }, () => ({ ally: true, data: { level, name: 'PC' } as EncounterDifficultyCombatant['data'] }));
}

function creature(level: number, name: string): EncounterDifficultyCombatant {
  return { ally: false, data: { level, name } as EncounterDifficultyCombatant['data'] };
}

function encounter(partySize: number, partyLevel = 2): Encounter {
  return { meta_data: { party_size: partySize, party_level: partyLevel } } as Encounter;
}

describe('encounter budgets', () => {
  it('uses the GM Core per-PC adjustments for five PCs', () => {
    expect(encounterBudget('Trivial', 5)).toBe(50);
    expect(encounterBudget('Low', 5)).toBe(80);
    expect(encounterBudget('Moderate', 5)).toBe(100);
    expect(encounterBudget('Severe', 5)).toBe(150);
    expect(encounterBudget('Extreme', 5)).toBe(200);
  });

  it('rates three level-2 creatures against five level-2 PCs as Moderate at 120 XP', () => {
    const difficulty = calculateDifficulty(encounter(5), [
      ...party(5),
      creature(2, 'Animated Panoply'),
      creature(2, 'Animated Panoply'),
      creature(2, 'Animated Panoply'),
    ]);
    expect(difficulty.xp).toBe(120);
    expect(difficulty.status).toBe('Moderate');
    expect(difficulty.budget).toBe(100);
    expect(difficulty.exceedsBudget).toBe(true);
    expect(difficulty.awardXp).toBe(80);
    expect(difficulty.thresholds.find((band) => band.status === 'Severe')?.min).toBe(150);
  });
});
