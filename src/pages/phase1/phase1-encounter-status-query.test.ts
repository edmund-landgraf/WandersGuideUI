import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { Character, ContentPackage, Creature } from '@schemas/content';
import type { Operation } from '@schemas/operations';
import { COMMON_CORE_ID } from '@constants/data';
import * as contentStore from '@content/content-store';
import { resetVariables } from '@variables/variable-manager';
import { adjustCreature } from '@utils/creature';
import { encounterStatusQueryOptions } from './phase1-encounter-status-query';
import { defensesForRow, type PopulatedCombatant } from './phase1-entity-panels';
import { calculateEntityStatus } from './phase1-stats';

const catalog = (): ContentPackage => ({
  ancestries: [], backgrounds: [], classes: [], abilityBlocks: [], items: [],
  languages: [], spells: [], traits: [], creatures: [], archetypes: [],
  versatileHeritages: [], classArchetypes: [], sources: [],
  defaultSources: { PAGE: [COMMON_CORE_ID], INFO: [COMMON_CORE_ID] },
});

function operations(ac: number, hp: number, fort: number, reflex: number, will: number, speed: number): Operation[] {
  const adj = (variable: string, value: number) => ({
    id: 'fixture-' + variable, type: 'adjValue', data: { variable, value },
  });
  const bonus = (variable: string, value: number) => ({
    id: 'fixture-' + variable, type: 'addBonusToValue', data: { variable, value: '+' + value, text: '' },
  });
  return [adj('AC_BONUS', ac - 10), adj('MAX_HEALTH_BONUS', hp), adj('SPEED', speed),
    bonus('SAVE_FORT', fort), bonus('SAVE_REFLEX', reflex), bonus('SAVE_WILL', will)] as Operation[];
}
function monster(): Creature {
  return {
    id: -670, name: 'Regression creature', level: 2, rarity: 'COMMON',
    hp_current: 30, hp_temp: 0, details: { description: '', conditions: [] },
    abilities_base: [], abilities_added: [], operations: operations(18, 35, 8, 7, 4, 25),
    operation_data: { selections: {} }, meta_data: {},
  } as unknown as Creature;
}
function pc(): Character {
  return {
    id: 671, name: 'Regression PC', user_id: 'fixture-user', created_at: '2026-01-01T00:00:00Z',
    level: 2, hp_current: 24, hp_temp: 0, details: { conditions: [] },
    options: { custom_operations: true }, custom_operations: operations(17, 30, 6, 5, 7, 25),
    content_sources: { enabled: [COMMON_CORE_ID] }, operation_data: { selections: {} }, meta_data: {},
  } as unknown as Character;
}
const creatureRow = (data: Creature): PopulatedCombatant => ({
  _id: 'same-creature-uuid', type: 'CREATURE', ally: false, creature: data, data,
  access: { can_edit: true, details_revealed: true },
});
const pcRow = (data: Character): PopulatedCombatant => ({
  _id: 'same-pc-uuid', type: 'CHARACTER', ally: true, character: data.id, data,
  access: { can_edit: true, details_revealed: true },
});
const stats = (ac: number, maxHp: number, fortitude: number, reflex: number, will: number, speed: number) =>
  ({ ac, maxHp, fortitude, reflex, will, speed });

describe('encounter status query with the real operation engine (#67)', () => {
  beforeEach(() => {
    resetVariables();
    // Only replace remote catalog retrieval. Operations, variable stores, status
    // calculation, fallback policy and the query observer are production code.
    vi.spyOn(contentStore, 'fetchContentPackage').mockImplementation(async () => catalog());
    vi.spyOn(contentStore, 'fetchContentSources').mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetVariables();
  });

  it('updates an existing observer after corrected imports, adjustments and PC edits without a page reload', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const original = [creatureRow(monster()), pcRow(pc())];
    const options = (rows: PopulatedCombatant[]) => encounterStatusQueryOptions(67, rows);
    const observer = new QueryObserver(client, options(original));
    const unsubscribe = observer.subscribe(() => {});
    const read = async () => {
      await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true), { timeout: 5000 });
      return observer.getCurrentResult().data!;
    };
    try {
      const initial = await read();
      expect(initial[original[0]._id]).toMatchObject(stats(18, 35, 8, 7, 4, 25));
      expect(initial[original[1]._id]).toMatchObject(stats(17, 30, 6, 5, 7, 25));
      expect(contentStore.fetchContentPackage).toHaveBeenCalledTimes(2);

      const irrelevant = structuredClone(original);
      irrelevant[0].initiative = 19;
      observer.setOptions(options(irrelevant));
      expect(await read()).toBe(initial);
      expect(contentStore.fetchContentPackage).toHaveBeenCalledTimes(2);

      const corrected = structuredClone(original);
      const fixed = corrected[0].data as Creature;
      fixed.operations = operations(20, 42, 10, 9, 6, 35);
      observer.setOptions(options(corrected));
      const updated = await read();
      expect(updated[corrected[0]._id]).toMatchObject(stats(20, 42, 10, 9, 6, 35));
      expect(corrected[0]._id).toBe(original[0]._id);
      expect(fixed.hp_current).toBe(30);
      expect(fixed.hp_temp).toBe(0);
      expect(contentStore.fetchContentPackage).toHaveBeenCalledTimes(4);

      // The roster presentation uses defensesForRow; independently calculate
      // the same full entity to check that the cached result is not a stale
      // or fallback projection.
      expect(defensesForRow(updated[corrected[0]._id], fixed)).toEqual(await calculateEntityStatus(creatureRow(fixed) as Parameters<typeof calculateEntityStatus>[0]));

      for (const [adjustment, modifier] of [['ELITE', 1], ['WEAK', -1]] as const) {
        const adjusted = adjustCreature(fixed, adjustment);
        adjusted.hp_current = fixed.hp_current;
        observer.setOptions(options([creatureRow(adjusted), corrected[1]]));
        const result = await read();
        expect(result[corrected[0]._id]).toMatchObject(stats(20 + 2 * modifier, 42 + 10 * modifier, 10 + 2 * modifier, 9 + 2 * modifier, 6 + 2 * modifier, 35));
        expect(adjusted.hp_current).toBe(30);
      }

      const changedPc = structuredClone(corrected[1].data) as Character;
      changedPc.custom_operations = operations(19, 38, 8, 7, 9, 30);
      observer.setOptions(options([creatureRow(fixed), pcRow(changedPc)]));
      const final = await read();
      expect(final[corrected[0]._id]).toMatchObject(stats(20, 42, 10, 9, 6, 35));
      expect(final[corrected[1]._id]).toMatchObject(stats(19, 38, 8, 7, 9, 30));
      expect(changedPc.hp_current).toBe(24);

      // Revealed -> masked cannot reuse an authorized cached status.
      observer.setOptions(options([creatureRow(fixed), { ...pcRow(changedPc), access: { can_edit: false, details_revealed: false } }]));
      const masked = await read();
      expect(masked[corrected[1]._id]).toBeUndefined();
    } finally {
      unsubscribe();
      observer.destroy();
      client.clear();
    }
  }, 20000);
});
