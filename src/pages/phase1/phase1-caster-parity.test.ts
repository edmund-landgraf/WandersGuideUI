import { describe, expect, it } from 'vitest';
import type { LivingEntity, Spell } from '@schemas/content';
import { staffCastingKind, wandNeedsOvercharge } from './phase1-item-spells';
import { isFocusCastBlocked, keepPreparedListSection, spellCastsWithoutPreparedSlot, type Phase1SpellEntry } from './phase1-spells';

describe('caster parity helpers', () => {
  it('keeps witch familiar sections empty', () => {
    expect(keepPreparedListSection('PREPARED-LIST', 0, 0, false)).toBe(true);
  });

  it('classifies staff casting from source types not names', () => {
    expect(staffCastingKind([{ type: 'PREPARED-LIST' }])).toBe('PREPARED');
    expect(staffCastingKind([{ type: 'SPONTANEOUS-REPERTOIRE' }])).toBe('SPONTANEOUS');
  });

  it('flags wand overcharge when daily charge is spent', () => {
    const entry = { mode: 'WAND', exhausted: false, usesCurrent: 1, usesMax: 1 } as Phase1SpellEntry;
    expect(wandNeedsOvercharge(entry)).toBe(true);
  });

  it('blocks focus spells above half level rounded up', () => {
    const spell = { rank: 3, traits: [], meta_data: { focus: true } } as unknown as Spell;
    expect(isFocusCastBlocked(spell, { level: 3 } as LivingEntity)).toBe(true);
    expect(isFocusCastBlocked(spell, { level: 5 } as LivingEntity)).toBe(false);
  });

  it('treats sorcerer, focus, and innate as castable without a prepared slot', () => {
    expect(spellCastsWithoutPreparedSlot({ cantrip: false, mode: 'SPONTANEOUS' })).toBe(true);
    expect(spellCastsWithoutPreparedSlot({ cantrip: false, mode: 'FOCUS' })).toBe(true);
    expect(spellCastsWithoutPreparedSlot({ cantrip: false, mode: 'INNATE' })).toBe(true);
    expect(spellCastsWithoutPreparedSlot({ cantrip: true, mode: 'PREPARED' })).toBe(true);
    expect(spellCastsWithoutPreparedSlot({ cantrip: false, mode: 'PREPARED' })).toBe(false);
  });
});
