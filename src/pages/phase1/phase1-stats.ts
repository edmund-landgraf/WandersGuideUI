import { getBestArmor } from '@items/inv-utils';
import type { Creature, Rarity } from '@schemas/content';
import type { VariableListStr } from '@schemas/variables';
import { getDcForLevel } from '@utils/numbers';
import { getResistWeaks } from '@utils/resist-weaks';
import { displayPrimaryVisionSense } from '@utils/senses';
import { toLabel } from '@utils/strings';
import {
  getFinalAcValue,
  getFinalHealthValue,
  getFinalProfValue,
  getFinalVariableValue,
  getSpeedValue,
} from '@variables/variable-helpers';
import { getAllSpeedVariables, getVariable } from '@variables/variable-manager';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

export type Phase1CreatureStatus = {
  maxHp: number;
  ac: number;
  fortitude: number;
  reflex: number;
  will: number;
  classDc: number;
  perception: number;
  speed: number;
  otherSpeeds: string[];
  vision: string;
  attributes: Record<'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma', number>;
  conditions: string[];
  resistances: string[];
  weaknesses: string[];
  immunities: string[];
  recallKnowledge: null | { trait: string; rarity: string | null; skill: string; dc: number };
};

const KNOWLEDGE_SKILLS: Record<string, string> = {
  aberration: 'Occultism', animal: 'Nature', astral: 'Occultism', beast: 'Arcana or Nature', celestial: 'Religion',
  construct: 'Arcana or Crafting', dragon: 'Arcana', dream: 'Occultism', elemental: 'Arcana or Nature', ethereal: 'Occultism',
  fey: 'Nature', fiend: 'Religion', fungus: 'Nature', 'fungus (creature)': 'Nature', humanoid: 'Society', monitor: 'Religion',
  ooze: 'Occultism', plant: 'Nature', 'plant (creature)': 'Nature', shade: 'Religion', spirit: 'Occultism', time: 'Occultism', undead: 'Religion',
};

export async function calculateEntityStatus(combatant: Phase1EntityCombatant): Promise<Phase1CreatureStatus> {
  const { entity, content, storeId, kind } = await preparePhase1Entity(combatant);
  const speeds = getAllSpeedVariables(storeId)
    .map((variable) => ({ name: variable.name, value: getSpeedValue(storeId, variable, entity).total }))
    .filter((speed) => speed.value > 0);
  const landSpeed = speeds.find((speed) => speed.name === 'SPEED') ?? speeds[0];
  let recallKnowledge: Phase1CreatureStatus['recallKnowledge'] = null;

  if (kind === 'CREATURE') {
    const creature = entity as Creature;
    const traitIds = (creature.operations ?? [])
      .filter((operation) => operation.type === 'giveTrait')
      .map((operation) => (operation as any).data.traitId as number);
    const knowledgeTrait = content.traits
      .filter((trait) => traitIds.includes(trait.id))
      .find((trait) => KNOWLEDGE_SKILLS[trait.name.toLowerCase()]);
    const rarity = creature.rarity as Rarity;
    if (knowledgeTrait) {
      recallKnowledge = {
        trait: knowledgeTrait.name.toLowerCase(),
        rarity: rarity !== 'COMMON' ? rarity.toLowerCase() : null,
        skill: KNOWLEDGE_SKILLS[knowledgeTrait.name.toLowerCase()],
        dc: getDcForLevel(creature.level, rarity),
      };
    }
  }

  return applyStoredCreatureStats({
    maxHp: resolveMaxHp(getFinalHealthValue(storeId), entity),
    ac: getFinalAcValue(storeId, getBestArmor(storeId, entity.inventory)?.item),
    fortitude: parseSigned(getFinalProfValue(storeId, 'SAVE_FORT')),
    reflex: parseSigned(getFinalProfValue(storeId, 'SAVE_REFLEX')),
    will: parseSigned(getFinalProfValue(storeId, 'SAVE_WILL')),
    classDc: parseSigned(getFinalProfValue(storeId, 'CLASS_DC', true)),
    perception: parseSigned(getFinalProfValue(storeId, 'PERCEPTION')),
    speed: landSpeed?.value ?? 0,
    otherSpeeds: speeds.filter((speed) => speed !== landSpeed).map((speed) => `${toLabel(speed.name.replace('SPEED_', ''))} ${speed.value} ft.`),
    vision: displayPrimaryVisionSense(storeId) || 'Normal vision',
    attributes: {
      strength: getFinalVariableValue(storeId, 'ATTRIBUTE_STR').total,
      dexterity: getFinalVariableValue(storeId, 'ATTRIBUTE_DEX').total,
      constitution: getFinalVariableValue(storeId, 'ATTRIBUTE_CON').total,
      intelligence: getFinalVariableValue(storeId, 'ATTRIBUTE_INT').total,
      wisdom: getFinalVariableValue(storeId, 'ATTRIBUTE_WIS').total,
      charisma: getFinalVariableValue(storeId, 'ATTRIBUTE_CHA').total,
    },
    conditions: (entity.details?.conditions ?? []).map((condition) => condition.value ? `${condition.name} ${condition.value}` : condition.name),
    resistances: getResistWeaks(storeId, 'RESISTANCES'),
    weaknesses: getResistWeaks(storeId, 'WEAKNESSES'),
    immunities: (getVariable<VariableListStr>(storeId, 'IMMUNITIES')?.value ?? []).map((value) => toLabel(value)),
    recallKnowledge,
  }, entity);
}

function parseSigned(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

type StoredCreature = {
  hp_current?: number | null;
  operations?: Array<{ type?: string; data?: { variable?: string; value?: unknown } | null }> | null;
  meta_data?: { calculated_stats?: { hp_max?: number; ac?: number; profs?: Record<string, { total?: number }> } | null } | null;
};

const ATTRIBUTE_VARIABLES = {
  strength: 'ATTRIBUTE_STR',
  dexterity: 'ATTRIBUTE_DEX',
  constitution: 'ATTRIBUTE_CON',
  intelligence: 'ATTRIBUTE_INT',
  wisdom: 'ATTRIBUTE_WIS',
  charisma: 'ATTRIBUTE_CHA',
} as const;

function operationNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

function setValueNumber(entity: StoredCreature, variable: string): number | undefined {
  for (const operation of entity.operations ?? []) {
    if (operation.type !== 'setValue' || operation.data?.variable !== variable) continue;
    const value = operationNumber(operation.data.value);
    if (value != null) return value;
  }
  return undefined;
}

function adjStrings(entity: StoredCreature, variable: string): string[] {
  const values: string[] = [];
  for (const operation of entity.operations ?? []) {
    if (operation.type !== 'adjValue' || operation.data?.variable !== variable) continue;
    if (typeof operation.data.value === 'string' && operation.data.value.trim()) values.push(operation.data.value.trim());
  }
  return values;
}

function resolveMaxHp(computed: number, entity: { hp_current?: number | null; meta_data?: { calculated_stats?: { hp_max?: number } } | null }) {
  const stored = entity.meta_data?.calculated_stats?.hp_max;
  if (computed > 1) return computed;
  if (typeof stored === 'number' && stored > 1) return stored;
  if (computed > 0) return computed;
  if (typeof stored === 'number' && stored > 0) return stored;
  return entity.hp_current ?? computed;
}

export function applyStoredCreatureStats(live: Phase1CreatureStatus, entity: StoredCreature): Phase1CreatureStatus {
  const stored = entity.meta_data?.calculated_stats;
  const profs = stored?.profs;
  const attributes = { ...live.attributes };
  const liveAttributesBlank = Object.values(live.attributes).every((value) => value === 0);
  if (liveAttributesBlank) {
    for (const [key, variable] of Object.entries(ATTRIBUTE_VARIABLES)) {
      const value = setValueNumber(entity, variable);
      if (value != null) attributes[key as keyof Phase1CreatureStatus['attributes']] = value;
    }
  }
  const recoveredAttributes = Object.values(attributes).some((value) => value !== 0);
  const preferExported = liveAttributesBlank && recoveredAttributes;
  const pick = (liveValue: number, storedValue: number | undefined, empty = 0) => {
    if (preferExported && storedValue != null) return storedValue;
    return liveValue !== empty ? liveValue : storedValue ?? liveValue;
  };
  const storedHp = typeof stored?.hp_max === 'number' ? stored.hp_max : undefined;
  const speed = live.speed > 0 ? live.speed : setValueNumber(entity, 'SPEED') ?? live.speed;
  const otherSpeeds = live.otherSpeeds.length > 0 ? live.otherSpeeds : ['FLY', 'CLIMB', 'BURROW', 'SWIM'].flatMap((name) => {
    const value = setValueNumber(entity, `SPEED_${name}`);
    return value != null && value > 0 ? [`${name[0]}${name.slice(1).toLowerCase()} ${value} ft.`] : [];
  });
  return {
    ...live,
    attributes,
    maxHp: live.maxHp > 1 ? live.maxHp : storedHp && storedHp > 1 ? storedHp : live.maxHp || storedHp || entity.hp_current || 0,
    ac: preferExported && stored?.ac != null ? stored.ac : live.ac > 10 ? live.ac : stored?.ac ?? live.ac,
    fortitude: pick(live.fortitude, profs?.SAVE_FORT?.total),
    reflex: pick(live.reflex, profs?.SAVE_REFLEX?.total),
    will: pick(live.will, profs?.SAVE_WILL?.total),
    classDc: live.classDc !== 10 ? live.classDc : profs?.CLASS_DC?.total ?? live.classDc,
    perception: pick(live.perception, profs?.PERCEPTION?.total),
    speed,
    otherSpeeds,
    resistances: live.resistances.length > 0 ? live.resistances : adjStrings(entity, 'RESISTANCES'),
    weaknesses: live.weaknesses.length > 0 ? live.weaknesses : adjStrings(entity, 'WEAKNESSES'),
    immunities: live.immunities.length > 0 ? live.immunities : adjStrings(entity, 'IMMUNITIES'),
  };
}
