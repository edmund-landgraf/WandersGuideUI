import { describe, expect, it } from 'vitest';
import type { Spell } from '@schemas/content';
import { keepPreparedListSection, spellbookEntriesForSource, spellCatalogSourceIds } from './phase1-spells';

function spell(id: number, name: string): Spell {
  return { id, name, rank: 1, traditions: ['occult'], traits: [], description: '' } as unknown as Spell;
}

describe('witch familiar spell load', () => {
  it('keeps a PREPARED-LIST section even with no slots or saved list', () => {
    expect(keepPreparedListSection('PREPARED-LIST', 0, 0, false)).toBe(true);
    expect(keepPreparedListSection('PREPARED-TRADITION', 0, 0, false)).toBe(false);
  });

  it('resolves patron/lesson ids from the merged list, not an empty saved list', () => {
    const merged = [{ spell_id: 42, rank: 1, source: 'Witch' }];
    const saved: typeof merged = [];
    expect(spellbookEntriesForSource(saved, 'Witch', [spell(42, 'Phase Familiar')], []).length).toBe(0);
    expect(spellbookEntriesForSource(merged, 'Witch', [spell(42, 'Phase Familiar')], []).map((entry) => entry.spell.name)).toEqual([
      'Phase Familiar',
    ]);
  });

  it('includes common core plus character books for the catalog fetch', () => {
    expect(spellCatalogSourceIds([1, 2])).toEqual([3, 1, 2]);
  });
});
