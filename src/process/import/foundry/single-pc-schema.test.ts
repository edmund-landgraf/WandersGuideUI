import { describe, expect, it } from 'vitest';
import { CharacterSchema } from '@schemas/content';
import { findImportedCharacter, planImportWrite, planSinglePc } from './single-pc';

function character(meta: Record<string, unknown> | null, id = 9) {
  return {
    id,
    created_at: '2020-01-01T00:00:00Z',
    name: 'Reed',
    level: 3,
    experience: 0,
    hero_points: 1,
    hp_current: 20,
    hp_temp: 0,
    stamina_current: 0,
    resolve_current: 0,
    campaign_id: null,
    user_id: 'user-1',
    inventory: null,
    notes: null,
    roll_history: null,
    spells: { slots: [], list: [], focus_point_current: 1, innate_casts: [] },
    operation_data: { selections: { class: 'wizard-feat' }, notes: { sheet: 'kept' } },
    details: { info: { pronouns: 'they' } },
    custom_operations: null,
    options: null,
    variants: null,
    content_sources: null,
    companions: null,
    meta_data: meta,
  };
}

const deepLeftovers = {
  'items[0].system.rules[0].key': 'FlatModifier',
  'items[0].system.rules[0].value': { nested: ['a', 1, null, { ok: true }] },
};

describe('CharacterSchema foundry meta', () => {
  it('keeps the world link, deep leftovers, and sibling stats through a real parse', () => {
    const raw = character({
      reset_hp: false,
      calculated_stats: { hp_max: 24, profs: { acrobatics: { total: 5, type: 'T' } } },
      stray: 'not a sheet field',
      foundry: {
        worldId: 'world-a',
        actorId: 'actor1',
        leftovers: deepLeftovers,
        ledger: [{ path: 'items[0].system.rules[0].key', status: 'leftover-preserved', reason: 'not interpreted' }],
      },
    });
    const parsed = CharacterSchema.parse(JSON.parse(JSON.stringify(raw)));
    expect(parsed.meta_data?.foundry?.worldId).toBe('world-a');
    expect(parsed.meta_data?.foundry?.actorId).toBe('actor1');
    expect(parsed.meta_data?.foundry?.leftovers).toEqual(deepLeftovers);
    expect(parsed.meta_data?.calculated_stats?.hp_max).toBe(24);
    expect(parsed.meta_data?.reset_hp).toBe(false);
    expect(parsed.meta_data).not.toHaveProperty('stray');
    expect(parsed.spells?.focus_point_current).toBe(1);
    expect(parsed.operation_data?.selections?.class).toBe('wizard-feat');
    expect(parsed.details?.info?.pronouns).toBe('they');
  });

  it('still parses a character that has never been imported from Foundry', () => {
    const parsed = CharacterSchema.parse(character({ calculated_stats: { hp_max: 10, profs: {} }, reset_hp: true }));
    expect(parsed.meta_data?.foundry).toBeUndefined();
    expect(parsed.meta_data?.calculated_stats?.hp_max).toBe(10);
    expect(CharacterSchema.parse(character(null)).meta_data).toBeNull();
  });

  it('rejects a non-JSON leftover instead of keeping the rest of meta unchecked', () => {
    const raw = character({
      foundry: { worldId: 'world-a', actorId: 'actor1', leftovers: { n: Number.POSITIVE_INFINITY } },
    });
    expect(() => CharacterSchema.parse(raw)).toThrow();
  });

  it('reimports by world and actor after the parsed character is written back', () => {
    const stored = CharacterSchema.parse(
      JSON.parse(
        JSON.stringify(
          character(
            {
              calculated_stats: { hp_max: 24, profs: {} },
              foundry: { worldId: 'world-a', actorId: 'actor1', leftovers: { 'items[0].name': 'Longsword' } },
            },
            9,
          ),
        ),
      ),
    );
    const otherWorld = CharacterSchema.parse(
      JSON.parse(
        JSON.stringify(
          character({ foundry: { worldId: 'world-b', actorId: 'actor1', leftovers: { 'items[0].name': 'Other' } } }, 10),
        ),
      ),
    );
    const plan = planSinglePc(
      {
        name: 'Reed',
        _id: 'actor1',
        system: { details: { level: { value: 4 } } },
        items: [{ system: { rules: [{ key: 'FlatModifier' }] } }],
      },
      'world-a',
    );
    expect(findImportedCharacter([stored, otherWorld], 'world-b', 'actor1')?.id).toBe(10);
    const match = findImportedCharacter([stored, otherWorld], plan.worldId, plan.actorId);
    expect(match?.id).toBe(9);
    const write = planImportWrite(plan, {
      id: match!.id!,
      name: match!.name,
      meta_data: match!.meta_data as Record<string, unknown>,
    });
    expect(write.action).toBe('update');
    if (write.action !== 'update') return;
    expect(write.body).not.toHaveProperty('spells');
    expect(write.body).not.toHaveProperty('details');
    expect(write.body).not.toHaveProperty('operation_data');
    expect(write.body).not.toHaveProperty('hp_current');

    const returned = CharacterSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...stored,
          meta_data: write.body.meta_data,
          level: write.body.level,
        }),
      ),
    );
    expect(returned.spells?.focus_point_current).toBe(1);
    expect(returned.operation_data?.notes?.sheet).toBe('kept');
    expect(returned.details?.info?.pronouns).toBe('they');
    expect(returned.hp_current).toBe(20);
    expect(returned.meta_data?.calculated_stats?.hp_max).toBe(24);
    expect(returned.meta_data?.foundry?.worldId).toBe('world-a');
    expect(returned.meta_data?.foundry?.leftovers?.['items[0].name']).toBe('Longsword');
    expect(returned.meta_data?.foundry?.leftovers?.['items[0].system.rules[0].key']).toBe('FlatModifier');
    expect(findImportedCharacter([returned, otherWorld], 'world-a', 'actor1')?.id).toBe(9);
    expect(findImportedCharacter([returned, otherWorld], 'world-b', 'actor1')?.id).toBe(10);
  });
});
