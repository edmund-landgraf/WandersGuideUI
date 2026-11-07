import { describe, expect, it, vi } from 'vitest';
import { foundryGet, planSinglePc } from './single-pc';

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

describe('foundryGet', () => {
  it('reports that the world did not answer when the read is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
    await expect(foundryGet('http://localhost:30000', 'code', '/modules/foundry-wanderersguide-import/export/characters')).rejects.toThrow(
      'The Foundry world did not answer.',
    );
    vi.unstubAllGlobals();
  });
});
