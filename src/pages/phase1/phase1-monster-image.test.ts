import { describe, expect, it } from 'vitest';
import { monsterArtPath, storedMonsterArtId } from './phase1-monster-image';

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
