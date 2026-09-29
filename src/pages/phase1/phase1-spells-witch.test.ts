import { describe, expect, it } from 'vitest';
import type { Spell } from '@schemas/content';
import { buildCastingSourceEntries, focusGrantsInPool, focusSpellCastState, innateSpellCastState, keepPreparedListSection, spellbookEntriesForSource, spellCastSkipsResources, spellCatalogSourceIds } from './phase1-spells';

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

  it('keeps unprepared familiar spells in the spellbook, not on the sheet', () => {
    const acidGrip = spell(500, 'Acid Grip');
    const entries = buildCastingSourceEntries(
      { name: 'Witch', type: 'PREPARED-LIST' },
      'PREPARED',
      [{ id: 'slot-1', rank: 1, source: 'Witch', spell_id: null }],
      [{ spell_id: 500, rank: 1, source: 'Witch' }],
      new Map([[500, acidGrip]]),
      new Map(),
    );
    expect(entries.some((entry) => entry.spell?.name === 'Acid Grip')).toBe(false);
    expect(entries.some((entry) => entry.empty && entry.slotId === 'slot-1')).toBe(true);
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
    expect(entries[0]?.slotId).toBeUndefined();
    expect(entries[0]?.available).toBe(true);
  });

  it('lets sorcerer repertoire spells be cast even when that rank has no slots yet', () => {
    const acidGrip = spell(500, 'Acid Grip');
    const entries = buildCastingSourceEntries(
      { name: 'Sorcerer', type: 'SPONTANEOUS-REPERTOIRE' },
      'SPONTANEOUS',
      [],
      [{ spell_id: 500, rank: 1, source: 'Sorcerer' }],
      new Map([[500, acidGrip]]),
      new Map(),
    );
    expect(entries[0]?.available).toBe(true);
    expect(entries[0]?.exhausted).toBe(false);
  });

  it('marks sorcerer rank spells exhausted only after those rank slots are spent', () => {
    const acidGrip = spell(500, 'Acid Grip');
    const entries = buildCastingSourceEntries(
      { name: 'Sorcerer', type: 'SPONTANEOUS-REPERTOIRE' },
      'SPONTANEOUS',
      [{ id: 'slot-1', rank: 1, source: 'Sorcerer', spell_id: null, exhausted: true }],
      [{ spell_id: 500, rank: 1, source: 'Sorcerer' }],
      new Map([[500, acidGrip]]),
      new Map(),
    );
    expect(entries[0]?.available).toBe(false);
    expect(entries[0]?.exhausted).toBe(true);
  });

  it('treats prepared cantrips as always available', () => {
    const stabilize = { ...spell(1, 'Stabilize'), rank: 0 };
    const arc = { ...spell(2, 'Electric Arc'), rank: 0 };
    const entries = buildCastingSourceEntries(
      { name: 'Cleric', type: 'PREPARED-TRADITION' },
      'PREPARED',
      [
        { id: 'c1', rank: 0, source: 'Cleric', spell_id: 1, exhausted: false },
        { id: 'c2', rank: 0, source: 'Cleric', spell_id: 2, exhausted: true },
      ],
      [],
      new Map([[1, stabilize], [2, arc]]),
      new Map(),
    );
    expect(entries.every((entry) => entry.available)).toBe(true);
    expect(entries.every((entry) => !entry.exhausted)).toBe(true);
  });

  it('keeps prepared cantrips available even when every cantrip slot is marked spent', () => {
    const stabilize = { ...spell(1, 'Stabilize'), rank: 0 };
    const entries = buildCastingSourceEntries(
      { name: 'Cleric', type: 'PREPARED-TRADITION' },
      'PREPARED',
      [
        { id: 'c1', rank: 0, source: 'Cleric', spell_id: 1, exhausted: true },
        { id: 'c2', rank: 0, source: 'Cleric', spell_id: 1, exhausted: true },
      ],
      [],
      new Map([[1, stabilize]]),
      new Map(),
    );
    expect(entries.every((entry) => entry.available)).toBe(true);
    expect(entries.every((entry) => !entry.exhausted)).toBe(true);
  });

  it('counts cantrip slots including empties, not the whole spellbook', () => {
    const daze = { ...spell(10, 'Daze'), rank: 0 };
    const detect = { ...spell(11, 'Detect Magic'), rank: 0 };
    const eatFire = { ...spell(12, 'Eat Fire'), rank: 0 };
    const slots = [
      { id: 'c1', rank: 0, source: 'Magus', spell_id: 10 },
      { id: 'c2', rank: 0, source: 'Magus', spell_id: 11 },
      { id: 'c3', rank: 0, source: 'Magus', spell_id: null },
      { id: 'c4', rank: 0, source: 'Magus', spell_id: null },
      { id: 'c5', rank: 0, source: 'Magus', spell_id: null },
    ];
    const book = [
      { spell_id: 10, rank: 0, source: 'Magus' },
      { spell_id: 11, rank: 0, source: 'Magus' },
      { spell_id: 12, rank: 0, source: 'Magus' },
    ];
    const spells = new Map([[10, daze], [11, detect], [12, eatFire]]);
    const sheet = buildCastingSourceEntries({ name: 'Magus', type: 'PREPARED-LIST' }, 'PREPARED', slots, book, spells, new Map());
    expect(sheet.filter((entry) => entry.rank === 0)).toHaveLength(5);
    expect(sheet.map((entry) => entry.spell?.name ?? 'empty')).toEqual(['Daze', 'Detect Magic', 'empty', 'empty', 'empty']);
    expect(spellbookEntriesForSource(book, 'Magus', [daze, detect, eatFire], []).map((entry) => entry.spell.name)).toEqual([
      'Daze',
      'Detect Magic',
      'Eat Fire',
    ]);
  });

  it('shows only prepared ranked slots on the sheet and leaves the rest in the spellbook', () => {
    const objectReading = spell(20, 'Object Reading');
    const fear = spell(21, 'Fear');
    const bless = spell(22, 'Bless');
    const slots = [
      { id: 's1', rank: 1, source: 'Magus', spell_id: 20, exhausted: false },
      { id: 's2', rank: 1, source: 'Magus', spell_id: null },
    ];
    const book = [
      { spell_id: 20, rank: 1, source: 'Magus' },
      { spell_id: 21, rank: 1, source: 'Magus' },
      { spell_id: 22, rank: 1, source: 'Magus' },
    ];
    const spells = new Map([[20, objectReading], [21, fear], [22, bless]]);
    const sheet = buildCastingSourceEntries({ name: 'Magus', type: 'PREPARED-LIST' }, 'PREPARED', slots, book, spells, new Map());
    expect(sheet.map((entry) => entry.spell?.name ?? 'empty')).toEqual(['Object Reading', 'empty']);
    expect(sheet.every((entry) => Boolean(entry.slotId))).toBe(true);
    expect(sheet.find((entry) => entry.spell?.name === 'Object Reading')?.exhausted).toBe(false);
    expect(spellbookEntriesForSource(book, 'Magus', [objectReading, fear, bless], []).map((entry) => entry.spell.name)).toEqual([
      'Bless',
      'Fear',
      'Object Reading',
    ]);
  });

  it('still exhausts a ranked prepared slot, not the whole rank', () => {
    const fear = spell(21, 'Fear');
    const bless = spell(22, 'Bless');
    const entries = buildCastingSourceEntries(
      { name: 'Cleric', type: 'PREPARED-TRADITION' },
      'PREPARED',
      [
        { id: 's1', rank: 1, source: 'Cleric', spell_id: 21, exhausted: true },
        { id: 's2', rank: 1, source: 'Cleric', spell_id: 22, exhausted: false },
      ],
      [],
      new Map([[21, fear], [22, bless]]),
      new Map(),
    );
    expect(entries.find((entry) => entry.spell?.name === 'Fear')).toMatchObject({ available: false, exhausted: true });
    expect(entries.find((entry) => entry.spell?.name === 'Bless')).toMatchObject({ available: true, exhausted: false });
  });

  it('keeps spontaneous cantrips available after every cantrip slot is spent', () => {
    const daze = { ...spell(10, 'Daze'), rank: 0 };
    const entries = buildCastingSourceEntries(
      { name: 'Sorcerer', type: 'SPONTANEOUS-REPERTOIRE' },
      'SPONTANEOUS',
      [
        { id: 'c1', rank: 0, source: 'Sorcerer', spell_id: null, exhausted: true },
        { id: 'c2', rank: 0, source: 'Sorcerer', spell_id: null, exhausted: true },
      ],
      [{ spell_id: 10, rank: 0, source: 'Sorcerer' }],
      new Map([[10, daze]]),
      new Map(),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ available: true, exhausted: false, cantrip: true });
  });

  it('keeps rank 0 cantrips at-will for every other caster, even when those slots are spent', () => {
    const casters: Array<{ name: string; type: string; mode: 'PREPARED' | 'SPONTANEOUS' }> = [
      { name: 'Wizard', type: 'PREPARED-TRADITION', mode: 'PREPARED' },
      { name: 'Cleric', type: 'PREPARED-TRADITION', mode: 'PREPARED' },
      { name: 'Druid', type: 'PREPARED-TRADITION', mode: 'PREPARED' },
      { name: 'Witch', type: 'PREPARED-LIST', mode: 'PREPARED' },
      { name: 'Magus', type: 'PREPARED-TRADITION', mode: 'PREPARED' },
      { name: 'Sorcerer', type: 'SPONTANEOUS-REPERTOIRE', mode: 'SPONTANEOUS' },
      { name: 'Bard', type: 'SPONTANEOUS-REPERTOIRE', mode: 'SPONTANEOUS' },
      { name: 'Oracle', type: 'SPONTANEOUS-REPERTOIRE', mode: 'SPONTANEOUS' },
      { name: 'Psychic', type: 'SPONTANEOUS-REPERTOIRE', mode: 'SPONTANEOUS' },
    ];
    for (const caster of casters) {
      const cantrip = { ...spell(1, 'Shield'), rank: 0 };
      const entries = buildCastingSourceEntries(
        { name: caster.name, type: caster.type },
        caster.mode,
        [{ id: 'c1', rank: 0, source: caster.name, spell_id: caster.mode === 'PREPARED' ? 1 : null, exhausted: true }],
        [{ spell_id: 1, rank: 0, source: caster.name }],
        new Map([[1, cantrip]]),
        new Map(),
      );
      const shield = entries.find((entry) => entry.spell?.name === 'Shield');
      expect(shield, caster.name).toMatchObject({ cantrip: true, available: true, exhausted: false, rank: 0 });
    }
  });

  it('spends a focus point for a rank 0 focus spell unless it has the cantrip trait', () => {
    expect(focusSpellCastState(0, [], { current: 1, max: 1 })).toMatchObject({ cantrip: false, available: true, exhausted: false, usesCurrent: 1, usesMax: 1 });
    expect(focusSpellCastState(0, [], { current: 0, max: 1 })).toMatchObject({ cantrip: false, available: false, exhausted: true });
    expect(focusSpellCastState(0, ['Cantrip'], { current: 0, max: 0 })).toEqual({
      cantrip: true,
      available: true,
      exhausted: false,
      usesCurrent: undefined,
      usesMax: undefined,
    });
    expect(focusSpellCastState(1, ['Focus', 'Cantrip'], { current: 2, max: 2 }).cantrip).toBe(true);
    const grants = [
      { spell_id: 1, rank: 0 },
      { spell_id: 2, rank: 0 },
      { spell_id: 3, rank: 1 },
    ];
    const traits = new Map<number, string[]>([[1, ['Cantrip']], [2, ['Healing']], [3, ['Cantrip']]]);
    expect(focusGrantsInPool(grants, (id) => traits.get(id) ?? []).map((grant) => grant.spell_id)).toEqual([2]);
  });

  it('leaves an innate cantrip and an innate spell with no daily maximum available', () => {
    expect(innateSpellCastState(['Cantrip'], 1, 1)).toMatchObject({ cantrip: true, available: true, exhausted: false });
    expect(innateSpellCastState([], 0, 0)).toMatchObject({ cantrip: false, available: true, exhausted: false });
    expect(innateSpellCastState([], 1, 1)).toMatchObject({ cantrip: false, available: false, exhausted: true, usesCurrent: 0 });
  });

  it('still spends a wand daily use and a ranked staff charge when the spell is a cantrip', () => {
    expect(spellCastSkipsResources({ cantrip: true, mode: 'WAND', rank: 0 })).toBe(false);
    expect(spellCastSkipsResources({ cantrip: true, mode: 'STAFF', rank: 1 })).toBe(false);
    expect(spellCastSkipsResources({ cantrip: true, mode: 'STAFF', rank: 0 })).toBe(true);
    expect(spellCastSkipsResources({ cantrip: true, mode: 'FOCUS', rank: 1 })).toBe(true);
    expect(spellCastSkipsResources({ cantrip: false, mode: 'FOCUS', rank: 0 })).toBe(false);
  });
});
