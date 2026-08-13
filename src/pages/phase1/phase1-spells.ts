import { collectEntitySpellcasting, getFocusPoints } from '@content/collect-content';
import { getFinalProfValue } from '@variables/variable-helpers';
import type { CastingSource, LivingEntity, Spell } from '@schemas/content';
import { cloneDeep } from 'lodash-es';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

export type Phase1SpellMode = 'PREPARED' | 'SPONTANEOUS' | 'FOCUS' | 'INNATE';

export type Phase1SpellEntry = {
  key: string;
  spell: Spell;
  rank: number;
  traitNames: string[];
  sourceName: string;
  mode: Phase1SpellMode;
  cantrip: boolean;
  available: boolean;
  usesCurrent?: number;
  usesMax?: number;
};

export type Phase1SpellSection = {
  key: string;
  label: string;
  mode: Phase1SpellMode;
  source?: CastingSource;
  attack?: number;
  dc?: number;
  entries: Phase1SpellEntry[];
  slots: Array<{ rank: number; exhausted: boolean }>;
};

export async function loadEntitySpells(combatant: Phase1EntityCombatant): Promise<Phase1SpellSection[]> {
  const { entity, content, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spellById = new Map(content.spells.map((spell) => [spell.id, spell]));
  const traitById = new Map(content.traits.map((trait) => [trait.id, trait.name]));
  const sections: Phase1SpellSection[] = [];
  const attack = safeProf(storeId, 'SPELL_ATTACK');
  const dc = safeProf(storeId, 'SPELL_DC', true);

  for (const source of data.sources) {
    const mode = source.type.startsWith('PREPARED-') ? 'PREPARED' : source.type.startsWith('SPONTANEOUS-') ? 'SPONTANEOUS' : null;
    if (mode) {
      const sourceSlots = data.slots.filter((slot) => slot.source === source.name);
      const records = mode === 'PREPARED'
        ? sourceSlots.filter((slot) => slot.spell_id != null).map((slot, index) => ({ spell_id: slot.spell_id!, rank: slot.rank, exhausted: Boolean(slot.exhausted), index }))
        : data.list.filter((entry) => entry.source === source.name).map((entry, index) => ({ ...entry, exhausted: false, index }));
      const entries = records.flatMap((record) => {
        const spell = spellById.get(record.spell_id);
        if (!spell) return [];
        const traitNames = namesFor(spell, traitById);
        const cantrip = traitNames.some((name) => name.toLowerCase() === 'cantrip');
        const rankSlots = sourceSlots.filter((slot) => slot.rank === record.rank);
        return [makeEntry(spell, record.rank, traitNames, source.name, mode, cantrip, cantrip || (mode === 'PREPARED' ? !record.exhausted : rankSlots.some((slot) => !slot.exhausted)), record.index)];
      });
      if (entries.length || sourceSlots.length) sections.push({ key: `${mode}-${source.name}`, label: source.name, mode, source, attack, dc, entries, slots: sourceSlots.map((slot) => ({ rank: slot.rank, exhausted: Boolean(slot.exhausted) })) });
    }

    const focusRecords = data.focus.filter((entry) => entry.source === source.name);
    if (focusRecords.length) {
      const points = getFocusPoints(storeId, entity, data.focus);
      const entries = focusRecords.flatMap((record, index) => {
        const spell = spellById.get(record.spell_id);
        if (!spell) return [];
        return [makeEntry(spell, record.rank ?? spell.rank, namesFor(spell, traitById), source.name, 'FOCUS', false, points.current > 0, index, points.current, points.max)];
      });
      sections.push({ key: `FOCUS-${source.name}`, label: `${source.name} Focus Spells`, mode: 'FOCUS', source, attack, dc, entries, slots: [] });
    }
  }

  if (data.innate.length) {
    const entries = data.innate.flatMap((record, index) => {
      const spell = spellById.get(record.spell_id);
      if (!spell) return [];
      const traitNames = namesFor(spell, traitById);
      const cantrip = traitNames.some((name) => name.toLowerCase() === 'cantrip');
      const remaining = Math.max(record.casts_max - record.casts_current, 0);
      return [makeEntry(spell, record.rank, traitNames, 'Innate', 'INNATE', cantrip, cantrip || remaining > 0, index, remaining, record.casts_max)];
    });
    sections.push({ key: 'INNATE', label: 'Innate Spells', mode: 'INNATE', attack, dc, entries, slots: [] });
  }

  return sections;
}

export async function castEntitySpell(combatant: Phase1EntityCombatant, entry: Phase1SpellEntry): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  if (entry.cantrip) return raw;
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = { slots: [...data.slots], list: [...(raw.spells?.list ?? [])], focus_point_current: raw.spells?.focus_point_current ?? 0, innate_casts: [...data.innate] };

  if (entry.mode === 'PREPARED') {
    const index = spells.slots.findIndex((slot) => slot.spell_id === entry.spell.id && slot.rank === entry.rank && slot.source === entry.sourceName && !slot.exhausted);
    if (index >= 0) spells.slots[index] = { ...spells.slots[index], exhausted: true };
  } else if (entry.mode === 'SPONTANEOUS') {
    const index = spells.slots.findIndex((slot) => slot.rank === entry.rank && slot.source === entry.sourceName && !slot.exhausted);
    if (index >= 0) spells.slots[index] = { ...spells.slots[index], exhausted: true };
  } else if (entry.mode === 'FOCUS') {
    spells.focus_point_current = Math.max(spells.focus_point_current - 1, 0);
  } else if (entry.mode === 'INNATE') {
    spells.innate_casts = spells.innate_casts.map((innate) => innate.spell_id === entry.spell.id && innate.rank === entry.rank ? { ...innate, casts_current: Math.min(innate.casts_current + 1, innate.casts_max) } : innate);
  }

  return { ...raw, spells };
}

function makeEntry(spell: Spell, rank: number, traitNames: string[], sourceName: string, mode: Phase1SpellMode, cantrip: boolean, available: boolean, index: number, usesCurrent?: number, usesMax?: number): Phase1SpellEntry {
  return { key: `${mode}-${sourceName}-${rank}-${spell.id}-${index}`, spell, rank, traitNames, sourceName, mode, cantrip, available, usesCurrent, usesMax };
}

function namesFor(spell: Spell, traits: Map<number, string>) {
  return (spell.traits ?? []).map((id) => traits.get(id)).filter((name): name is string => Boolean(name));
}

function safeProf(storeId: string, name: string, dc = false): number | undefined {
  try {
    const value = Number(getFinalProfValue(storeId, name, dc));
    return Number.isFinite(value) ? value : undefined;
  } catch { return undefined; }
}
