import { applyConditions } from '@conditions/condition-handler';
import { COMMON_CORE_ID } from '@constants/data';
import {
  defineDefaultSources,
  fetchContentById,
  fetchContentPackage,
  fetchContentSources,
  getDefaultSources,
} from '@content/content-store';
import { isItemEquippable, isItemImplantable, isItemInvestable, isItemWeapon } from '@items/inv-utils';
import { executeOperations } from '@operations/operations.main';
import type { Character, Combatant, ContentPackage, Creature, InventoryItem, Item } from '@schemas/content';
import type { VariableListStr } from '@schemas/variables';
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

    let creature = await hydrateCreatureRecord(cloneDeep(combatant.data as Creature));
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
    return { entity: creature, content, storeId, kind: 'CREATURE' };
  } finally {
    defineDefaultSources('PAGE', previousPage);
    defineDefaultSources('INFO', previousInfo);
  }
}

async function hydrateCreatureRecord(creature: Creature): Promise<Creature> {
  if (!creature.id || creature.id <= 0) return creature;
  const hasAbilities = Boolean(creature.abilities_base?.length || creature.abilities_added?.length);
  const hasWeapons = (creature.inventory?.items ?? []).some((entry) => isItemWeapon(entry.item));
  if (hasAbilities || hasWeapons) return creature;
  const full = await fetchContentById<Creature>('creature', creature.id, { skipCache: true });
  if (!full) return creature;
  return {
    ...full,
    hp_current: creature.hp_current ?? full.hp_current,
    hp_temp: creature.hp_temp,
    details: {
      ...full.details,
      ...creature.details,
      conditions: creature.details?.conditions ?? full.details.conditions,
    },
    notes: creature.notes ?? full.notes,
  };
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
