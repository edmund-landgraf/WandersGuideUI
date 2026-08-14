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

  return overlayStoredStats({
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

function resolveMaxHp(computed: number, entity: { hp_current?: number | null; meta_data?: { calculated_stats?: { hp_max?: number } } | null }) {
  if (computed > 0) return computed;
  const stored = entity.meta_data?.calculated_stats?.hp_max;
  if (typeof stored === 'number' && stored > 0) return stored;
  return entity.hp_current ?? computed;
}

function overlayStoredStats(live: Phase1CreatureStatus, entity: { hp_current?: number | null; meta_data?: { calculated_stats?: { hp_max?: number; ac?: number; profs?: Record<string, { total: number }> } } | null }): Phase1CreatureStatus {
  const stored = entity.meta_data?.calculated_stats;
  const profs = stored?.profs;
  const pick = (liveValue: number, storedValue: number | undefined, empty = 0) =>
    liveValue !== empty ? liveValue : storedValue ?? liveValue;
  return {
    ...live,
    maxHp: live.maxHp > 0 ? live.maxHp : stored?.hp_max || entity.hp_current || 0,
    ac: live.ac > 10 ? live.ac : stored?.ac ?? live.ac,
    fortitude: pick(live.fortitude, profs?.SAVE_FORT?.total),
    reflex: pick(live.reflex, profs?.SAVE_REFLEX?.total),
    will: pick(live.will, profs?.SAVE_WILL?.total),
    classDc: live.classDc !== 10 ? live.classDc : profs?.CLASS_DC?.total ?? live.classDc,
    perception: pick(live.perception, profs?.PERCEPTION?.total),
  };
}
