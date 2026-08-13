import { collectEntityAbilityBlocks } from '@content/collect-content';
import type { AbilityBlock, InventoryItem } from '@schemas/content';
import type { VariableProf } from '@schemas/variables';
import { getBonusText, getFinalProfValue, getProfValueParts } from '@variables/variable-helpers';
import { getAllSkillVariables, getVariableBonuses, getVariableHistory } from '@variables/variable-manager';
import { compileProficiencyType, isProficiencyValue, labelToVariable, proficiencyTypeToLabel, variableToLabel } from '@variables/variable-utils';
import { flattenDeep, uniqBy } from 'lodash-es';
import { collectSelectedCustomAbilities, type Phase1Ability } from './phase1-abilities';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';
import { getPhase1SkillDescription } from './phase1-skill-descriptions';

export type Phase1SkillBreakdownTerm = { label: string; value: number; detail: string; sources?: Array<{ amount: number; source: string }> };
export type Phase1SkillTimelineItem = { type: 'BONUS' | 'ADJUSTMENT'; title: string; description: string; timestamp: number };
export type Phase1Skill = {
  name: string;
  variableName: string;
  modifier: number;
  rank: string;
  description: string;
  actions: Phase1Ability[];
  breakdown: { final: number; terms: Phase1SkillBreakdownTerm[]; conditionals: Array<{ text: string; source: string }> };
  timeline: Phase1SkillTimelineItem[];
};
export type Phase1ActionGroup = { id: string; label: string; actions: Phase1Ability[] };
export type Phase1SkillsActions = { skills: Phase1Skill[]; groups: Phase1ActionGroup[] };

export async function loadEntitySkillsActions(combatant: Phase1EntityCombatant): Promise<Phase1SkillsActions> {
  const { entity, content, storeId, kind } = await preparePhase1Entity(combatant);
  const traitNames = new Map(content.traits.map((trait) => [trait.id, trait.name]));
  const catalog = content.abilityBlocks
    .filter((ability) => ability.type === 'action')
    .map((ability) => enrich(ability, 'Catalog', traitNames))
    .sort((a, b) => a.name.localeCompare(b.name));
  const collected = flattenDeep(
    Object.values(collectEntityAbilityBlocks(storeId, entity, content.abilityBlocks, { filterBasicClassFeatures: true }))
  ) as AbilityBlock[];
  const withNested = [...collected, ...collectSelectedCustomAbilities(entity, collected)];
  const entityAbilities = uniqBy(withNested, (ability) => `${ability.id}:${ability.name}`)
    .map((ability) => enrich(ability, kind === 'CHARACTER' ? 'Character' : 'Creature', traitNames));

  return {
    skills: getAllSkillVariables(storeId)
      .filter((skill) => skill.name !== 'SKILL_LORE____')
      .map((skill) => buildSkill(skill, storeId, catalog)),
    groups: [
      { id: 'weapon-attacks', label: 'Weapon Attacks', actions: weaponAbilities(entity.inventory?.items ?? []) },
      { id: 'feats', label: 'Feats (with Actions)', actions: entityAbilities.filter((ability) => ability.actions !== null) },
      { id: 'basic-actions', label: 'Basic Actions', actions: catalog.filter((ability) => !ability.meta_data?.skill && !ability.requirements?.trim() && !hasTrait(ability, 'Exploration') && !hasTrait(ability, 'Downtime')) },
      { id: 'skill-actions', label: 'Skill Actions', actions: catalog.filter((ability) => Boolean(ability.meta_data?.skill)) },
      { id: 'speciality-basics', label: 'Speciality Basics', actions: catalog.filter((ability) => !ability.meta_data?.skill && Boolean(ability.requirements?.trim())) },
      { id: 'exploration-activities', label: 'Exploration Activities', actions: catalog.filter((ability) => hasTrait(ability, 'Exploration')) },
      { id: 'downtime-activities', label: 'Downtime Activities', actions: catalog.filter((ability) => hasTrait(ability, 'Downtime')) },
    ].filter((group) => group.actions.length > 0),
  };
}

function buildSkill(variable: VariableProf, storeId: string, catalog: Phase1Ability[]): Phase1Skill {
  const rank = compileProficiencyType(variable.value);
  const rankLabel = proficiencyTypeToLabel(rank);
  const parts = getProfValueParts(storeId, variable.name);
  const terms: Phase1SkillBreakdownTerm[] = [];

  if (parts) {
    terms.push({ label: `${rankLabel} proficiency`, value: parts.profValue, detail: `${rankLabel} grants a ${signedText(parts.profValue)} proficiency bonus.` });
    terms.push({ label: 'Level', value: parts.level, detail: rank === 'U' ? 'Untrained proficiencies normally do not add your level.' : 'Your level is added because you are trained or better.' });
    if (parts.attributeMod !== null) {
      const attribute = (variable.value.attribute ?? 'Associated attribute').replace(/^ATTRIBUTE_/, '').replaceAll('_', ' ').toLowerCase();
      terms.push({ label: `${titleCase(attribute)} modifier`, value: parts.attributeMod, detail: `This skill uses your ${attribute} modifier.` });
    }
    for (const [label, bonus] of parts.breakdown.bonuses.entries()) {
      terms.push({ label, value: bonus.value, detail: label.startsWith('untyped ') ? 'All untyped modifiers are combined.' : 'Only the greatest modifier of this type is applied.', sources: bonus.composition });
    }
  }

  const history = getVariableHistory(storeId, variable.name).map((entry) => {
    const from = isProficiencyValue(entry.from) ? proficiencyTypeToLabel(compileProficiencyType(entry.from)) : String(entry.from ?? '');
    const to = isProficiencyValue(entry.to) ? proficiencyTypeToLabel(compileProficiencyType(entry.to)) : String(entry.to);
    return { type: 'ADJUSTMENT' as const, title: from && from !== to ? `${from} to ${to}` : to, description: `From ${entry.source}`, timestamp: entry.timestamp };
  }).filter((entry) => entry.title);
  const bonuses = getVariableBonuses(storeId, variable.name).map((bonus) => ({
    type: 'BONUS' as const,
    title: getBonusText(bonus),
    description: `From ${bonus.source}`,
    timestamp: bonus.timestamp,
  }));

  return {
    name: variableToLabel(variable).replace(/^Skill /, ''),
    variableName: variable.name,
    modifier: parseSigned(getFinalProfValue(storeId, variable.name)),
    rank,
    description: getPhase1SkillDescription(variable.name),
    actions: catalog.filter((ability) => matchesSkill(ability, variable.name)),
    breakdown: { final: parseSigned(getFinalProfValue(storeId, variable.name)), terms, conditionals: parts?.breakdown.conditionals ?? [] },
    timeline: [...history, ...bonuses].sort((a, b) => a.timestamp - b.timestamp),
  };
}

function matchesSkill(ability: Phase1Ability, variableName: string) {
  const raw = ability.meta_data?.skill;
  if (!raw) return false;
  const skills = (Array.isArray(raw) ? raw : [raw]).map((skill) => {
    const value = String(skill);
    return value.startsWith('SKILL_') ? value : `SKILL_${labelToVariable(value)}`;
  });
  return skills.includes(variableName) || (skills.includes('SKILL_LORE') && variableName.startsWith('SKILL_LORE_'));
}

function signedText(value: number) { return value >= 0 ? `+${value}` : String(value); }
function titleCase(value: string) { return value.replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function enrich(ability: AbilityBlock, source: Phase1Ability['source'], traits: Map<number, string>): Phase1Ability {
  return { ...ability, source, traitNames: (ability.traits ?? []).map((id) => traits.get(id)).filter((name): name is string => Boolean(name)) };
}
function weaponAbilities(items: InventoryItem[]): Phase1Ability[] {
  return items.filter((entry) => entry.is_equipped && entry.item.group === 'WEAPON').map((entry, index) => ({
    id: -(index + 1000), created_at: '', name: entry.item.name, actions: 'ONE-ACTION', level: entry.item.level,
    rarity: entry.item.rarity, availability: null, prerequisites: null, frequency: null, cost: null, trigger: null,
    requirements: null, access: null, description: entry.item.description || 'Equipped weapon attack.', special: null,
    type: 'action', meta_data: entry.item.meta_data?.image_url ? { image_url: entry.item.meta_data.image_url } : {},
    traits: entry.item.traits ?? [], operations: entry.item.operations, content_source_id: entry.item.content_source_id,
    version: entry.item.version, traitNames: [], source: 'Weapon',
  }));
}
function hasTrait(ability: Phase1Ability, name: string) { return ability.traitNames.some((trait) => trait.toLowerCase() === name.toLowerCase()); }
function parseSigned(value: string) { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? parsed : 0; }
