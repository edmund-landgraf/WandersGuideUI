import { describe, expect, it } from 'vitest';
import type { Spell } from '@schemas/content';
import { buildCastingSourceEntries, keepPreparedListSection, spellbookEntriesForSource, spellCatalogSourceIds } from './phase1-spells';

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

  it('shows catalog-added familiar spells on the sheet even before they are prepared into a slot', () => {
    const acidGrip = spell(500, 'Acid Grip');
    const entries = buildCastingSourceEntries(
      { name: 'Witch', type: 'PREPARED-LIST' },
      'PREPARED',
      [{ id: 'slot-1', rank: 1, source: 'Witch', spell_id: null }],
      [{ spell_id: 500, rank: 1, source: 'Witch' }],
      new Map([[500, acidGrip]]),
      new Map(),
    );
    expect(entries.some((entry) => entry.spell?.name === 'Acid Grip' && !entry.slotId)).toBe(true);
  });

  it('shows spontaneous repertoire spells from the saved list', () => {
    const acidGrip = spell(500, 'Acid Grip');
    const entries = buildCastingSourceEntries(
      { name: 'Sorcerer', type: 'SPONTANEOUS-REPERTOIRE' },
      'SPONTANEOUS',
      [{ id: 'slot-1', rank: 1, source: 'Sorcerer', spell_id: null }],
      [{ spell_id: 500, rank: 1, source: 'Sorcerer' }],
      new Map([[500, acidGrip]]),
      new Map(),
    );
    expect(entries.map((entry) => entry.spell?.name)).toEqual(['Acid Grip']);
  });
});
