import { collectEntityAbilityBlocks } from '@content/collect-content';
import type { AbilityBlock, Creature } from '@schemas/content';
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

  const collected = flattenDeep(Object.values(collectEntityAbilityBlocks(storeId, entity, content.abilityBlocks))) as AbilityBlock[];
  return uniqBy(collected, (ability) => `${ability.id}:${ability.name}`)
    .map((ability) => enrich(ability, 'Character', traits))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
}

function enrich(ability: AbilityBlock, source: Phase1Ability['source'], traits: Map<number, string>): Phase1Ability {
  return {
    ...ability,
    source,
    traitNames: (ability.traits ?? []).map((id) => traits.get(id)).filter((name): name is string => Boolean(name)),
  };
}
