import type { Encounter, Hazard, LivingEntity } from '@schemas/content';
import { getHazardXpMultiplier } from '@utils/encounter-hazard';
import { getEntityLevel } from '@utils/entity-utils';
import { mean } from 'lodash-es';

export type EncounterDifficultyCombatant = {
  ally: boolean;
  type?: string;
  data?: LivingEntity;
  hazard?: Hazard;
  hazard_state?: { disabled?: boolean };
  out?: 'dead' | 'incapacitated';
};
export type EncounterDifficultyStatus = 'IMPOSSIBLE' | 'Extreme' | 'Severe' | 'Moderate' | 'Low' | 'Trivial';
export type EncounterDifficultyColor = 'dark' | 'red' | 'orange' | 'yellow' | 'green' | 'blue';

export type EncounterDifficultyLine = {
  name: string;
  level: number;
  delta: number;
  xp: number;
};

export type EncounterDifficultyThreshold = {
  status: EncounterDifficultyStatus;
  min: number;
};

export type EncounterDifficulty = {
  status: EncounterDifficultyStatus;
  color: EncounterDifficultyColor;
  xp: number;
  /** Party-adjusted building budget for `status`. Awards do not use this number. */
  budget: number;
  /** True when creature XP is above this difficulty's budget and still below the next one. */
  exceedsBudget: boolean;
  /** Group XP award for a four-PC party of this difficulty. Party size does not change it. */
  awardXp: number;
  partyLevel: number;
  partySize: number;
  partyLevelFromEncounter: boolean;
  partySizeFromEncounter: boolean;
  lines: EncounterDifficultyLine[];
  thresholds: EncounterDifficultyThreshold[];
};

const XP_BY_DELTA: Record<number, number> = {
  [-4]: 10,
  [-3]: 15,
  [-2]: 20,
  [-1]: 30,
  0: 40,
  1: 60,
  2: 80,
  3: 120,
  4: 160,
};

export function xpForLevelDelta(delta: number) {
  const rounded = Math.round(delta);
  if (rounded in XP_BY_DELTA) return XP_BY_DELTA[rounded];
  return rounded > 4 ? rounded * 40 : 0;
}

/** GM Core encounter budgets for four PCs, plus the amount added or removed per extra or missing PC. */
const BUDGET_BY_DIFFICULTY: Record<Exclude<EncounterDifficultyStatus, 'IMPOSSIBLE'>, { base: number; perPc: number }> = {
  Trivial: { base: 40, perPc: 10 },
  Low: { base: 60, perPc: 20 },
  Moderate: { base: 80, perPc: 20 },
  Severe: { base: 120, perPc: 30 },
  Extreme: { base: 160, perPc: 40 },
};

const DIFFICULTY_ORDER: Exclude<EncounterDifficultyStatus, 'IMPOSSIBLE'>[] = ['Trivial', 'Low', 'Moderate', 'Severe', 'Extreme'];

export function encounterBudget(status: Exclude<EncounterDifficultyStatus, 'IMPOSSIBLE'>, partySize: number) {
  const row = BUDGET_BY_DIFFICULTY[status];
  return row.base + (partySize - 4) * row.perPc;
}

function isInEncounterDifficulty(combatant: EncounterDifficultyCombatant) {
  if (combatant.out === 'dead' || combatant.out === 'incapacitated') return false;
  if (combatant.type === 'HAZARD' && combatant.hazard_state?.disabled) return false;
  return true;
}

function combatantLevel(combatant: EncounterDifficultyCombatant) {
  if (combatant.type === 'HAZARD' && combatant.hazard) return combatant.hazard.level;
  return combatant.data ? getEntityLevel(combatant.data) : undefined;
}

function combatantName(combatant: EncounterDifficultyCombatant) {
  if (combatant.type === 'HAZARD' && combatant.hazard) return combatant.hazard.name;
  return combatant.data?.name ?? 'Combatant';
}

export function shouldDisplayEncounterDifficulty(combatants: EncounterDifficultyCombatant[]) {
  const active = combatants.filter(isInEncounterDifficulty);
  return active.length > 0 && active.some((c) => c.ally) && active.some((c) => !c.ally);
}

export function calculateDifficulty(encounter: Encounter, combatants: EncounterDifficultyCombatant[]): EncounterDifficulty {
  const active = combatants.filter(isInEncounterDifficulty);
  const alliesInEncounter = active.filter((c) => c.ally);
  const partyLevelFromEncounter = encounter.meta_data.party_level != null;
  const partySizeFromEncounter = encounter.meta_data.party_size != null;
  const partyLevel = encounter.meta_data.party_level ?? mean(alliesInEncounter.map((p) => combatantLevel(p)).filter((level): level is number => level != null)) ?? 0;
  const partySize = encounter.meta_data.party_size ?? alliesInEncounter.length;

  const lines = active
    .filter((entity) => !entity.ally)
    .map((entity) => {
      const level = combatantLevel(entity) ?? 0;
      const delta = level - partyLevel;
      const xp = xpForLevelDelta(delta) * (entity.type === 'HAZARD' && entity.hazard ? getHazardXpMultiplier(entity.hazard) : 1);
      return { name: combatantName(entity), level, delta, xp };
    });
  const xpBudget = lines.reduce((sum, line) => sum + line.xp, 0);
  const xp = Math.floor(xpBudget);

  const budgets = {
    Trivial: encounterBudget('Trivial', partySize),
    Low: encounterBudget('Low', partySize),
    Moderate: encounterBudget('Moderate', partySize),
    Severe: encounterBudget('Severe', partySize),
    Extreme: encounterBudget('Extreme', partySize),
  };
  const impossibleMin = budgets.Extreme + 40;

  const thresholds: EncounterDifficultyThreshold[] = [
    { status: 'Trivial', min: 0 },
    { status: 'Low', min: budgets.Low },
    { status: 'Moderate', min: budgets.Moderate },
    { status: 'Severe', min: budgets.Severe },
    { status: 'Extreme', min: budgets.Extreme },
    { status: 'IMPOSSIBLE', min: impossibleMin },
  ];

  let status: EncounterDifficultyStatus = 'Trivial';
  let color: EncounterDifficultyColor = 'blue';
  if (xpBudget >= impossibleMin) {
    status = 'IMPOSSIBLE';
    color = 'dark';
  } else if (xpBudget >= budgets.Extreme) {
    status = 'Extreme';
    color = 'red';
  } else if (xpBudget >= budgets.Severe) {
    status = 'Severe';
    color = 'orange';
  } else if (xpBudget >= budgets.Moderate) {
    status = 'Moderate';
    color = 'yellow';
  } else if (xpBudget >= budgets.Low) {
    status = 'Low';
    color = 'green';
  }

  const budget = status === 'IMPOSSIBLE' ? impossibleMin : budgets[status];
  const nextBudget = status === 'IMPOSSIBLE' ? null : status === 'Extreme' ? impossibleMin : budgets[DIFFICULTY_ORDER[DIFFICULTY_ORDER.indexOf(status) + 1]];
  const awardStatus = status === 'IMPOSSIBLE' ? 'Extreme' : status;

  return {
    status,
    color,
    xp,
    budget,
    exceedsBudget: nextBudget != null && xp > budget && xp < nextBudget,
    awardXp: BUDGET_BY_DIFFICULTY[awardStatus].base,
    partyLevel,
    partySize,
    partyLevelFromEncounter,
    partySizeFromEncounter,
    lines,
    thresholds,
  };
}

export function formatLevelDelta(delta: number) {
  if (delta === 0) return 'party level';
  const rounded = Number.isInteger(delta) ? String(delta) : delta.toFixed(1);
  return delta > 0 ? `party +${rounded}` : `party ${rounded}`;
}
