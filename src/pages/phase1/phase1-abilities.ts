import { collectEntityAbilityBlocks, isProgressionPlaceholder } from '@content/collect-content';
import { getFlatInvItems, isItemRangedWeapon, isItemWeapon } from '@items/inv-utils';
import { getWeaponStats, parseOtherDamage } from '@items/weapon-handler';
import { getSelectedCustomOption } from '@operations/operation-utils';
import type { AbilityBlock, Creature, InventoryItem, LivingEntity } from '@schemas/content';
import { isCharacter } from '@utils/type-fixing';
import type { OperationSelectOptionCustom } from '@schemas/operations';
import { hashData, sign } from '@utils/numbers';
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
    return collectCreatureAbilities(entity as Creature, content.abilityBlocks, storeId, traits);
  }

  const collected = flattenDeep(
    Object.values(collectEntityAbilityBlocks(storeId, entity, content.abilityBlocks, { filterBasicClassFeatures: true }))
  ) as AbilityBlock[];
  const classNames = isCharacter(entity) ? [entity.details?.class?.name, entity.details?.class_2?.name] : [];
  const usable = collected.filter(
    (ability) =>
      ability.type !== 'heritage' &&
      ability.type !== 'sense' &&
      !isProgressionPlaceholder(ability, classNames)
  );
  const withNested = [...usable, ...collectSelectedCustomAbilities(entity, usable)];
  return uniqBy(withNested, (ability) => `${ability.id}:${ability.name}`)
    .map((ability) => enrich(ability, 'Character', traits))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Creature attacks and specials live in two places: ability blocks on the creature,
 * and inventory weapons. Search both and merge, dropping a weapon Strike when an
 * ability already covers the same name.
 */
export function collectCreatureAbilities(
  creature: Creature,
  catalog: AbilityBlock[],
  storeId: string,
  traits: Map<number, string>
): Phase1Ability[] {
  const fromBlocks = [
    ...(creature.abilities_base ?? []).map((ability) => enrich(ability, 'Base', traits)),
    ...(creature.abilities_added ?? [])
      .map((id) => catalog.find((ability) => ability.id === id))
      .filter((ability): ability is AbilityBlock => Boolean(ability))
      .map((ability) => enrich(ability, 'Added', traits)),
  ];
  const covered = new Set(fromBlocks.map((ability) => abilityKey(ability.name)));
  const fromWeapons = weaponAbilities(creature.inventory?.items ?? [], storeId, traits).filter(
    (ability) => !covered.has(abilityKey(ability.name))
  );
  return [...fromWeapons, ...fromBlocks];
}

function abilityKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
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

export function weaponAbilities(items: InventoryItem[], storeId?: string, traits?: Map<number, string>): Phase1Ability[] {
  const inventory = { coins: { cp: 0, sp: 0, gp: 0, pp: 0 }, items };
  return getFlatInvItems(inventory)
    .filter((entry) => isItemWeapon(entry.item))
    .map((entry, index) => {
      const ranged = isItemRangedWeapon(entry.item);
      const stats = storeId ? getWeaponStats(storeId, entry.item) : null;
      const damage = stats
        ? `${stats.damage.dice}${stats.damage.die}${stats.damage.bonus.total > 0 ? ` + ${stats.damage.bonus.total}` : ''} ${stats.damage.damageType}${parseOtherDamage(stats.damage.other).join('')}${stats.damage.extra ? ` + ${stats.damage.extra}` : ''}`
        : null;
      const strike = stats
        ? `${ranged ? 'Ranged' : 'Melee'} Strike ${sign(stats.attack_bonus.total[0])}, Damage ${damage}`
        : ranged
          ? 'Ranged weapon Strike.'
          : 'Melee weapon Strike.';
      return {
        id: -(index + 1000),
        created_at: '',
        name: entry.item.name,
        actions: 'ONE-ACTION' as const,
        level: entry.item.level,
        rarity: entry.item.rarity,
        availability: null,
        prerequisites: null,
        frequency: null,
        cost: null,
        trigger: null,
        requirements: null,
        access: null,
        description: strike,
        special: null,
        type: 'action' as const,
        meta_data: entry.item.meta_data?.image_url ? { image_url: entry.item.meta_data.image_url } : {},
        traits: entry.item.traits ?? [],
        operations: entry.item.operations,
        content_source_id: entry.item.content_source_id,
        version: entry.item.version,
        traitNames: (entry.item.traits ?? []).map((id) => traits?.get(id)).filter((name): name is string => Boolean(name)),
        source: 'Weapon' as const,
      };
    });
}
