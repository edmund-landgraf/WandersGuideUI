import { describe, expect, it } from 'vitest';
import { loadMonsterArtVariant, monsterArtPath, monsterArtStaleTime, pickMonsterRow, storedMonsterArtId } from './phase1-monster-image';

describe('PF2 creature art identity', () => {
  it('routes custom signed IDs to user-monsters for both image sizes', () => {
    expect(monsterArtPath(-1011)).toBe('/api/user-monsters/1011/image');
    expect(monsterArtPath(-1011, 'thumb')).toBe('/api/user-monsters/1011/image/thumb');
  });
  it('preserves canonical positive IDs', () => {
    expect(monsterArtPath(42)).toBe('/api/monsters/42/image');
    expect(monsterArtPath(42, 'thumb')).toBe('/api/monsters/42/image/thumb');
  });
  it('recognizes canonical, custom, and historical negative URLs', () => {
    expect(storedMonsterArtId('https://pf2.unwhelm.online/api/user-monsters/1011/image')).toBe(-1011);
    expect(storedMonsterArtId('/api/monsters/-1011/image/thumb')).toBe(-1011);
    expect(storedMonsterArtId('/api/monsters/42/image')).toBe(42);
    expect(storedMonsterArtId('https://example.org/portraits/coal.png')).toBeNull();
    expect(storedMonsterArtId('/api/monsters/0/image')).toBeNull();
  });
  it.each([0, NaN, 1.5, Infinity])('rejects invalid ID %s', (id) => {
    expect(() => monsterArtPath(id)).toThrow();
  });
});

describe('verified creature portrait recovery', () => {
  it('never chooses a partial name or a same-name different identity', () => {
    expect(pickMonsterRow([{ MonsterId: 42, Name: 'Greater Wolf' }], 'Wolf')).toBeNull();
    expect(pickMonsterRow([{ MonsterId: 42, Name: 'Wolf' }, { MonsterId: -42, Name: 'Wolf' }], 'Wolf')).toBeNull();
    expect(pickMonsterRow([{ MonsterId: 42, Name: 'Wolf' }, { MonsterId: 42, Name: 'Wolf', ImageUrl: '/wolf' }], 'Wolf')?.ImageUrl).toBe('/wolf');
  });
  it('uses a valid requested variant without fetching a second image', async () => {
    const calls: string[] = [];
    const result = await loadMonsterArtVariant('thumb', async size => { calls.push(size); return 'thumb-bytes'; });
    expect(result).toEqual({ size: 'thumb', src: 'thumb-bytes' });
    expect(calls).toEqual(['thumb']);
  });
  it('tries the same creature full image after a missing thumbnail', async () => {
    const calls: string[] = [];
    const result = await loadMonsterArtVariant('thumb', async size => { calls.push(size); return size === 'full' ? 'full-bytes' : null; });
    expect(result).toEqual({ size: 'full', src: 'full-bytes' });
    expect(calls).toEqual(['thumb', 'full']);
  });
  it('falls back to the same creature thumbnail after a full image request rejects', async () => {
    const result = await loadMonsterArtVariant('full', async size => {
      if (size === 'full') throw Error('network unavailable');
      return 'thumb-bytes';
    });
    expect(result).toEqual({ size: 'thumb', src: 'thumb-bytes' });
  });
  it('returns no image when both variants fail', async () => {
    expect(await loadMonsterArtVariant('thumb', async () => null)).toBeNull();
  });
  it('expires missing artwork sooner than verified artwork', () => {
    expect(monsterArtStaleTime({ state: { data: null } })).toBe(30_000);
    expect(monsterArtStaleTime({ state: { data: { monsterId: 42 } } })).toBe(300_000);
  });
});
