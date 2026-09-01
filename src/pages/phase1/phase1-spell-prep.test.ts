import { describe, expect, it } from 'vitest';
import type { Spell } from '@schemas/content';
import {
  applyDivineFontToSpellState,
  isDivinePreparedSource,
  isWitchFamiliarSource,
  keepPreparedListSection,
  spellbookEntriesForSource,
  spellbookLocksTradition,
  spellFitsSlot,
  spellManageMode,
} from './phase1-spells';

function spell(id: number, name: string, rank = 1, traditions: string[] = ['occult']): Spell {
  return { id, name, rank, traditions, traits: [], description: '' } as unknown as Spell;
}

describe('spellManageMode: prepared vs Charisma spontaneous', () => {
  it('lets tradition prepared casters pick into slots (wizard/cleric/druid)', () => {
    expect(spellManageMode('PREPARED-TRADITION', 'Cleric')).toBe('SLOTS-ONLY');
    expect(spellbookLocksTradition('SLOTS-ONLY', 'Cleric')).toBe(true);
  });

  it('lets Charisma spontaneous casters learn a repertoire, not prepare slots', () => {
    expect(spellManageMode('SPONTANEOUS-REPERTOIRE', 'Sorcerer')).toBe('LIST-ONLY');
    expect(spellbookLocksTradition('LIST-ONLY', 'Sorcerer')).toBe(true);
  });

  it('does not open a spellbook until a casting source exists (no patron / no class spells)', () => {
    expect(spellManageMode(undefined, undefined)).toBeNull();
    expect(spellManageMode('-', 'Witch')).toBeNull();
  });
});

describe('witch patron and familiar', () => {
  it('treats the familiar as PREPARED-LIST only after patron defines that source', () => {
    expect(isWitchFamiliarSource({ type: 'PREPARED-LIST', name: 'Witch' })).toBe(true);
    expect(isWitchFamiliarSource({ type: 'PREPARED-LIST', name: 'Familiar' })).toBe(true);
    expect(spellManageMode('PREPARED-LIST', 'Witch')).toBe('SLOTS-AND-LIST');
    expect(spellbookLocksTradition('SLOTS-AND-LIST', 'Witch')).toBe(false);
  });

  it('does not treat a witch as a familiar caster without PREPARED-LIST (patron not picked)', () => {
    expect(isWitchFamiliarSource({ type: 'PREPARED-TRADITION', name: 'Witch' })).toBe(false);
    expect(isWitchFamiliarSource({ type: 'SPONTANEOUS-REPERTOIRE', name: 'Witch' })).toBe(false);
    expect(isWitchFamiliarSource({ name: 'Witch' })).toBe(false);
  });

  it('keeps the familiar section reachable before any spells are written into the book', () => {
    expect(keepPreparedListSection('PREPARED-LIST', 0, 0, false)).toBe(true);
  });

  it('shows patron/lesson spells only from the merged ops list, not an empty saved character.spells.list', () => {
    const patronLesson = [{ spell_id: 42, rank: 1, source: 'Witch' }];
    const catalog = [spell(42, 'Phase Familiar')];
    expect(spellbookEntriesForSource([], 'Witch', catalog, []).length).toBe(0);
    expect(spellbookEntriesForSource(patronLesson, 'Witch', catalog, []).map((entry) => entry.spell.name)).toEqual(['Phase Familiar']);
    expect(spellbookEntriesForSource(patronLesson, 'Cleric', catalog, []).length).toBe(0);
  });
});

describe('Divine Font (Heal/Harm from Charisma extra slots)', () => {
  it('is offered on divine prepared sources, not occult witch or arcane wizard', () => {
    expect(isDivinePreparedSource({ tradition: 'divine', name: 'Cleric' })).toBe(true);
    expect(isDivinePreparedSource({ tradition: 'DIVINE', name: 'Cloistered Cleric' })).toBe(true);
    expect(isDivinePreparedSource({ tradition: 'occult', name: 'Witch' })).toBe(false);
    expect(isDivinePreparedSource({ tradition: 'arcane', name: 'Wizard' })).toBe(false);
  });

  it('fills empty ranked slots with Heal or Harm and leaves cantrips and filled slots alone', () => {
    const heal = { id: 9 };
    const next = applyDivineFontToSpellState(
      {
        slots: [
          { id: 'c', rank: 0, source: 'Cleric', spell_id: null },
          { id: 'a', rank: 1, source: 'Cleric', spell_id: null },
          { id: 'b', rank: 1, source: 'Cleric', spell_id: 3 },
          { id: 'd', rank: 2, source: 'Cleric', spell_id: null },
        ],
        list: [],
      },
      'Cleric',
      heal,
    );
    expect(next.slots.map((slot) => slot.spell_id)).toEqual([null, 9, 3, 9]);
    expect(next.list).toEqual([
      { spell_id: 9, rank: 1, source: 'Cleric' },
      { spell_id: 9, rank: 2, source: 'Cleric' },
    ]);
  });

  it('does not apply font when there are no ranked slots', () => {
    expect(() => applyDivineFontToSpellState({ slots: [{ rank: 0, source: 'Cleric', spell_id: null }], list: [] }, 'Cleric', { id: 9 })).toThrow(
      /Divine Font/,
    );
  });
});

describe('preparing a spell into a slot', () => {
  it('allows heightening a ranked spell into a higher slot, but not a cantrip into a ranked slot', () => {
    const magicMissile = spell(1, 'Magic Missile', 1, ['arcane']);
    const shield = spell(2, 'Shield', 0, ['arcane']);
    expect(spellFitsSlot(magicMissile, 2)).toBe(true);
    expect(spellFitsSlot(magicMissile, 0)).toBe(false);
    expect(spellFitsSlot(shield, 0)).toBe(true);
    expect(spellFitsSlot(shield, 1)).toBe(false);
  });
});
