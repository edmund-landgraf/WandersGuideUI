import { collectEntityAbilityBlocks } from '@content/collect-content';
import { getSelectedCustomOption } from '@operations/operation-utils';
import type { AbilityBlock, Creature, LivingEntity } from '@schemas/content';
import type { OperationSelectOptionCustom } from '@schemas/operations';
import { hashData } from '@utils/numbers';
import { flattenDeep, uniqBy } from 'lodash-es';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

export type Phase1Ability = AbilityBlock & {
  traitNames: string[];
  source: 'Base' | 'Added' | 'Character' | 'Catalog' | 'Creature' | 'Weapon';
};

export async function loadEntityAbilities(combatant: Phase1EntityCombatant): Promise<Phase1Ability[]> {
  const { entity, content, storeId, kind } = await preparePhase1Entity(combatant);
  const traits = new Map(content.traits.map((trait) => [trait.id, trait.name]));

  if (kind === 'CREATURE') {
    const creature = entity as Creature;
    const base = creature.abilities_base ?? [];
    const added = (creature.abilities_added ?? [])
      .map((id) => content.abilityBlocks.find((ability) => ability.id === id))
      .filter((ability): ability is AbilityBlock => Boolean(ability));
    return [
      ...base.map((ability) => enrich(ability, 'Base', traits)),
      ...added.map((ability) => enrich(ability, 'Added', traits)),
    ];
  }

  const collected = flattenDeep(
    Object.values(collectEntityAbilityBlocks(storeId, entity, content.abilityBlocks, { filterBasicClassFeatures: true }))
  ) as AbilityBlock[];
  const withNested = [...collected, ...collectSelectedCustomAbilities(entity, collected)];
  return uniqBy(withNested, (ability) => `${ability.id}:${ability.name}`)
    .map((ability) => enrich(ability, 'Character', traits))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Nested picks like Mercy of Grace live on a parent feat's custom select operation.
 * They are stored in operation_data.selections and never added to FEAT_IDS, so the
 * normal ability-block collect misses them.
 */
export function collectSelectedCustomAbilities(entity: LivingEntity, abilities: AbilityBlock[]): AbilityBlock[] {
  const extra: AbilityBlock[] = [];
  const seen = new Set<string>();

  function walk(ability: AbilityBlock) {
    for (const operation of ability.operations ?? []) {
      const selected = getSelectedCustomOption(entity, operation);
      if (!selected || seen.has(selected.id)) continue;
      seen.add(selected.id);
      const nested = abilityFromCustomOption(selected, ability);
      extra.push(nested);
      walk(nested);
    }
  }

  for (const ability of abilities) walk(ability);
  return extra;
}

function abilityFromCustomOption(option: OperationSelectOptionCustom, parent: AbilityBlock): AbilityBlock {
  return {
    id: hashData({ customSelect: option.id }),
    created_at: parent.created_at,
    operations: option.operations ?? null,
    name: option.title,
    actions: null,
    level: parent.level,
    rarity: parent.rarity,
    availability: parent.availability,
    prerequisites: null,
    frequency: null,
    cost: null,
    trigger: null,
    requirements: null,
    access: null,
    description: option.description,
    special: null,
    type: parent.type,
    meta_data: parent.meta_data,
    traits: parent.traits,
    content_source_id: parent.content_source_id,
    version: parent.version,
  };
}

function enrich(ability: AbilityBlock, source: Phase1Ability['source'], traits: Map<number, string>): Phase1Ability {
  return {
    ...ability,
    source,
    traitNames: (ability.traits ?? []).map((id) => traits.get(id)).filter((name): name is string => Boolean(name)),
  };
}
