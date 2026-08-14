import { applyConditions } from '@conditions/condition-handler';
import { COMMON_CORE_ID } from '@constants/data';
import {
  defineDefaultSources,
  fetchContentById,
  fetchContentPackage,
  fetchContentSources,
  getDefaultSources,
} from '@content/content-store';
import { isItemEquippable, isItemImplantable, isItemInvestable } from '@items/inv-utils';
import { executeOperations } from '@operations/operations.main';
import type { Character, Combatant, ContentPackage, Creature, InventoryItem, Item } from '@schemas/content';
import type { VariableListStr } from '@schemas/variables';
import { adjustCreature } from '@utils/creature';
import { getFinalHealthValue } from '@variables/variable-helpers';
import { exportVariableStore, getVariable, importVariableStore } from '@variables/variable-manager';
import { cloneDeep, uniq, uniqBy } from 'lodash-es';

export type Phase1EntityCombatant = Combatant & { data: Character | Creature };
export type PreparedPhase1Entity = {
  entity: Character | Creature;
  content: ContentPackage;
  storeId: string;
  kind: 'CHARACTER' | 'CREATURE';
};

let prepareChain: Promise<unknown> = Promise.resolve();

function enqueuePrepare<T>(work: () => Promise<T>): Promise<T> {
  const run = prepareChain.then(work, work);
  prepareChain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Character operations always mutate the shared CHARACTER store, and creature
 * operations import into it. Phase 1 prepares many combatants in parallel
 * (roster stats, abilities, skills, spells), so without a queue those runs
 * clobber each other — Fortitude drops to the Constitution modifier and
 * FEAT_IDS is empty when abilities are collected.
 */
export async function preparePhase1Entity(combatant: Phase1EntityCombatant): Promise<PreparedPhase1Entity> {
  return enqueuePrepare(() => preparePhase1EntityNow(combatant));
}

async function preparePhase1EntityNow(combatant: Phase1EntityCombatant): Promise<PreparedPhase1Entity> {
  const previousPage = getDefaultSources('PAGE');
  const previousInfo = getDefaultSources('INFO');
  try {
    if (combatant.type === 'CHARACTER') {
      const character = cloneDeep(combatant.data as Character);
      if (!character.user_id || !character.created_at) throw new Error('Full character details are unavailable.');
      const sources = uniq([COMMON_CORE_ID, ...(character.content_sources?.enabled ?? [])]);
      await fetchContentSources(sources);
      const content = await fetchContentPackage(sources, { fetchSources: true, fetchCreatures: false });
      content.defaultSources = { PAGE: sources, INFO: sources };
      await executeOperations({
        type: 'CHARACTER',
        data: { character, content, context: 'CHARACTER-SHEET' },
      }, { directExecution: true });
      applyConditions('CHARACTER', character.details?.conditions ?? []);
      const storeId = `CHARACTER_${combatant._id}`;
      importVariableStore(storeId, exportVariableStore('CHARACTER'));
      return { entity: character, content, storeId, kind: 'CHARACTER' };
    }

    let creature = await hydrateCreatureForCombat(cloneDeep(combatant.data as Creature));
    const storeId = `CREATURE_${combatant._id}`;
    const content = await fetchContentPackage(getDefaultSources('PAGE'), {
      fetchSources: false,
      fetchCreatures: false,
    });
    await executeOperations({
      type: 'CREATURE',
      data: { id: storeId, creature, content },
    }, { directExecution: true });
    creature = applyGivenItems(storeId, content.items, creature);
    applyConditions(storeId, creature.details?.conditions ?? []);
    creature = fillCurrentHp(creature, getFinalHealthValue(storeId));
    return { entity: creature, content, storeId, kind: 'CREATURE' };
  } finally {
    defineDefaultSources('PAGE', previousPage);
    defineDefaultSources('INFO', previousInfo);
  }
}

/**
 * The original drawer always loads the catalog row by id. Encounter JSON and the
 * creature list cache can keep abilities while dropping HP/AC/attribute ops, and
 * `meta_data.calculated_stats` is often null on official monsters. Skip the in-memory
 * content cache so we do not reuse a truncated list record.
 */
export async function hydrateCreatureForCombat(creature: Creature, adjustment?: 'ELITE' | 'WEAK'): Promise<Creature> {
  const { creature: base, replacedFromCatalog } = await hydrateCreatureRecord(creature);
  const applyAdjustment = adjustment ?? (replacedFromCatalog ? creature.details.adjustment : undefined);
  const next = applyAdjustment ? adjustCreature(structuredClone(base), applyAdjustment) : base;
  return fillCurrentHp(next);
}

async function hydrateCreatureRecord(creature: Creature): Promise<{ creature: Creature; replacedFromCatalog: boolean }> {
  if (!creature.id || creature.id <= 0) {
    return { creature: fillCurrentHp(creature), replacedFromCatalog: false };
  }

  const catalog = await fetchContentById<Creature>('creature', creature.id, { skipCache: true });
  if (!catalog) return { creature: fillCurrentHp(creature), replacedFromCatalog: false };

  return {
    replacedFromCatalog: true,
    creature: fillCurrentHp({
      ...catalog,
      hp_current: creature.hp_current || catalog.hp_current,
      hp_temp: creature.hp_temp,
      details: {
        ...catalog.details,
        conditions: creature.details?.conditions ?? catalog.details.conditions,
        image_url: creature.details?.image_url ?? catalog.details.image_url,
        adjustment: creature.details.adjustment,
      },
      notes: creature.notes ?? catalog.notes,
      meta_data: {
        ...catalog.meta_data,
        ...creature.meta_data,
        calculated_stats: hasUsefulCalculatedStats(creature.meta_data?.calculated_stats)
          ? creature.meta_data?.calculated_stats
          : catalog.meta_data?.calculated_stats,
      },
    }),
  };
}

function hasUsefulCalculatedStats(stats?: { hp_max?: number; ac?: number } | null) {
  return Boolean(stats && ((typeof stats.hp_max === 'number' && stats.hp_max > 0) || (typeof stats.ac === 'number' && stats.ac > 10)));
}

function fillCurrentHp(creature: Creature, computedMax?: number) {
  if (creature.hp_current) return creature;
  const stored = creature.meta_data?.calculated_stats?.hp_max;
  const maxHp = typeof computedMax === 'number' && computedMax > 0
    ? computedMax
    : typeof stored === 'number' && stored > 0
      ? stored
      : 0;
  if (maxHp <= 0) return creature;
  return { ...creature, hp_current: maxHp };
}

function applyGivenItems(storeId: string, items: Item[], creature: Creature): Creature {
  const extraItemIds = getVariable<VariableListStr>(storeId, 'EXTRA_ITEM_IDS')?.value ?? [];
  const given = new Set(creature.meta_data?.given_item_ids ?? []);
  const extraItems: InventoryItem[] = [];
  for (const itemId of extraItemIds) {
    const item = items.find((entry) => `${entry.id}` === itemId);
    if (!item || given.has(item.id)) continue;
    extraItems.push({
      id: `extra-item-${itemId}`,
      item,
      is_formula: false,
      is_equipped: isItemEquippable(item),
      is_invested: isItemInvestable(item),
      is_implanted: isItemImplantable(item),
      container_contents: [],
    });
  }
  if (extraItems.length === 0) return creature;
  return {
    ...creature,
    inventory: {
      ...(creature.inventory ?? { coins: { cp: 0, sp: 0, gp: 0, pp: 0 }, items: [] }),
      items: uniqBy([...(creature.inventory?.items ?? []), ...extraItems], 'id'),
    },
    meta_data: {
      ...creature.meta_data,
      given_item_ids: uniq([...(creature.meta_data?.given_item_ids ?? []), ...extraItems.map((entry) => entry.item.id)]),
    },
  };
}
