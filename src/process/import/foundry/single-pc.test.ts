import { describe, expect, it, vi } from 'vitest';
import { findImportedCharacter, foundryRelayRead, planImportWrite, planSinglePc } from './single-pc';

describe('planSinglePc', () => {
  it('maps name and level and keeps the rest', () => {
    const plan = planSinglePc(
      {
        name: 'Reed',
        _id: 'actor1',
        system: { details: { level: { value: 3 }, biography: { value: 'secret' } } },
        items: [{ name: 'Longsword' }],
      },
      'world1',
    );
    expect(plan.name).toBe('Reed');
    expect(plan.level).toBe(3);
    expect(plan.rows.find((row) => row.path === 'name')?.status).toBe('mapped');
    expect(plan.rows.find((row) => row.path === 'system.details.level.value')?.status).toBe('mapped');
    expect(plan.rows.find((row) => row.path === 'system.details.biography.value')?.status).toBe('dropped');
    expect(plan.leftovers['items[0].name']).toBe('Longsword');
    expect(plan.rows.some((row) => row.status === 'mapped' && row.path.startsWith('items'))).toBe(false);
  });

  it('leaves a missing name unresolved', () => {
    const plan = planSinglePc({ _id: 'actor1', system: { details: { level: { value: 1 } } } }, 'world1');
    expect(plan.rows.find((row) => row.path === 'name')?.status).toBe('unresolved');
  });

  it('keeps a name or level that is the wrong type', () => {
    const plan = planSinglePc(
      { name: 4, _id: 'actor1', system: { details: { level: { value: '3' } } } },
      'world1',
    );
    expect(plan.name).toBeNull();
    expect(plan.level).toBeNull();
    expect(plan.leftovers.name).toBe(4);
    expect(plan.leftovers['system.details.level.value']).toBe('3');
  });

  it('keeps fields nested past the old depth cutoff', () => {
    const plan = planSinglePc(
      {
        name: 'Reed',
        _id: 'actor1',
        system: { details: { level: { value: 1 } } },
        items: [{ system: { rules: [{ key: 'FlatModifier' }] } }],
      },
      'world1',
    );
    expect(plan.leftovers['items[0].system.rules[0].key']).toBe('FlatModifier');
  });
});

describe('foundryRelayRead', () => {
  const relay = 'http://127.0.0.1:8787';

  it('uses one sentence for a missing read, a server error, a non-JSON body, and a network failure', async () => {
    const sentence = 'The Foundry world did not answer.';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response('missing', { status: 404 });
    }));
    await expect(foundryRelayRead(relay, 'http://localhost:30000', 'code', 'list')).rejects.toThrow(sentence);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(foundryRelayRead(relay, 'http://localhost:30000', 'code', 'list')).rejects.toThrow(sentence);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));
    await expect(foundryRelayRead(relay, 'http://localhost:30000', 'code', 'list')).rejects.toThrow(sentence);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(foundryRelayRead(relay, 'http://localhost:30000', 'code', 'list')).rejects.toThrow(sentence);
    expect(calls.every((url) => url.startsWith(`${relay}/foundry-relay/`) && !url.includes('/modules/'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('uses the rejection sentence for 401 and 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    await expect(foundryRelayRead(relay, 'http://localhost:30000', 'code', 'actor', 'actor1')).rejects.toThrow('Connection code rejected.');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
    await expect(foundryRelayRead(relay, 'http://localhost:30000', 'code', 'actor', 'actor1')).rejects.toThrow('Connection code rejected.');
    vi.unstubAllGlobals();
  });
});

describe('planImportWrite', () => {
  const actor = { name: 'Reed', _id: 'actor1', system: { details: { level: { value: 3 } } }, items: [{ name: 'Longsword' }] };

  it('refuses to create when the name or level is absent or the wrong type', () => {
    const missing = planSinglePc({ _id: 'actor1', system: { details: { level: { value: 1 } } } }, 'world1');
    expect(planImportWrite(missing, undefined).action).toBe('reject');
    const wrong = planSinglePc({ name: '   ', _id: 'actor1', system: { details: { level: { value: '3' } } } }, 'world1');
    expect(wrong.name).toBeNull();
    expect(wrong.level).toBeNull();
    expect(planImportWrite(wrong, undefined).action).toBe('reject');
  });

  it('creates when name and level are valid, including level 0', () => {
    const plan = planSinglePc({ name: 'Reed', _id: 'actor1', system: { details: { level: { value: 0 } } } }, 'world1');
    const write = planImportWrite(plan, undefined);
    expect(write.action).toBe('create');
    if (write.action !== 'create') return;
    expect(write.body.name).toBe('Reed');
    expect(write.body.level).toBe(0);
    expect(write.body).not.toHaveProperty('campaign_id');
  });

  it('does not treat the same actor id in another world as the same character', () => {
    const stored = [
      { id: 1, name: 'A', meta_data: { foundry: { worldId: 'world-a', actorId: 'actor1' } } },
      { id: 2, name: 'B', meta_data: { foundry: { worldId: 'world-b', actorId: 'actor1' } } },
    ];
    expect(findImportedCharacter(stored, 'world-b', 'actor1')?.id).toBe(2);
    expect(findImportedCharacter(stored, 'world-c', 'actor1')).toBeUndefined();
    expect(findImportedCharacter(stored, '', 'actor1')).toBeUndefined();
    const plan = planSinglePc(actor, 'world-c');
    const write = planImportWrite(plan, findImportedCharacter(stored, plan.worldId, plan.actorId));
    expect(write.action).toBe('create');
  });

  it('updates a matching world and actor without sending unrelated Wanderer\'s Guide fields', () => {
    const plan = planSinglePc(
      {
        _id: 'actor1',
        items: [{ system: { rules: [{ key: 'FlatModifier' }] } }],
      },
      'world1',
    );
    expect(plan.name).toBeNull();
    expect(plan.level).toBeNull();
    const previous = {
      id: 9,
      name: 'Kept',
      meta_data: {
        calculated_stats: { hp_max: 20 },
        reset_hp: false,
        foundry: {
          worldId: 'world1',
          actorId: 'actor1',
          leftovers: { 'items[0].name': 'Longsword' },
        },
      },
    };
    const write = planImportWrite(plan, previous);
    expect(write.action).toBe('update');
    if (write.action !== 'update') return;
    expect(write.body.id).toBe(9);
    expect(write.body).not.toHaveProperty('name');
    expect(write.body).not.toHaveProperty('level');
    expect(write.body).not.toHaveProperty('details');
    expect(write.body).not.toHaveProperty('spells');
    expect(write.body).not.toHaveProperty('inventory');
    expect(write.body).not.toHaveProperty('hp_current');
    expect(write.body).not.toHaveProperty('operation_data');
    const meta = write.body.meta_data as {
      calculated_stats: { hp_max: number };
      reset_hp: boolean;
      foundry: { leftovers: Record<string, unknown> };
    };
    expect(meta.calculated_stats).toEqual({ hp_max: 20 });
    expect(meta.reset_hp).toBe(false);
    expect(meta.foundry.leftovers['items[0].name']).toBe('Longsword');
    expect(meta.foundry.leftovers['items[0].system.rules[0].key']).toBe('FlatModifier');
  });
});
