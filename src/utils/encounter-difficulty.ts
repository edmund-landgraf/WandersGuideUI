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
  const partySizeDiff = partySize - 4;

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

  const thresholds: EncounterDifficultyThreshold[] = [
    { status: 'Trivial', min: 0 },
    { status: 'Low', min: 50 + partySizeDiff * 15 },
    { status: 'Moderate', min: 70 + partySizeDiff * 20 },
    { status: 'Severe', min: 100 + partySizeDiff * 30 },
    { status: 'Extreme', min: 140 + partySizeDiff * 40 },
    { status: 'IMPOSSIBLE', min: 200 + partySizeDiff * 40 },
  ];

  let status: EncounterDifficultyStatus = 'Trivial';
  let color: EncounterDifficultyColor = 'blue';
  if (xpBudget >= 200 + partySizeDiff * 40) {
    status = 'IMPOSSIBLE';
    color = 'dark';
  } else if (xpBudget >= 140 + partySizeDiff * 40) {
    status = 'Extreme';
    color = 'red';
  } else if (xpBudget >= 100 + partySizeDiff * 30) {
    status = 'Severe';
    color = 'orange';
  } else if (xpBudget >= 70 + partySizeDiff * 20) {
    status = 'Moderate';
    color = 'yellow';
  } else if (xpBudget >= 50 + partySizeDiff * 15) {
    status = 'Low';
    color = 'green';
  }

  return {
    status,
    color,
    xp,
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
