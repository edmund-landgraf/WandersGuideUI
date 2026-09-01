import { COMMON_CORE_ID } from '@constants/data';
import { collectEntitySpellcasting, getFocusPoints } from '@content/collect-content';
import { getFinalProfValue } from '@variables/variable-helpers';
import type { CastingSource, LivingEntity, Spell } from '@schemas/content';
import { cloneDeep, uniq } from 'lodash-es';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

export type Phase1SpellMode = 'PREPARED' | 'SPONTANEOUS' | 'FOCUS' | 'INNATE' | 'RITUAL';
export type Phase1SpellManageMode = 'LIST-ONLY' | 'SLOTS-AND-LIST' | 'SLOTS-ONLY';

export function spellManageMode(sourceType?: string, sourceName?: string, sectionMode?: Phase1SpellMode): Phase1SpellManageMode | null {
  if (sectionMode === 'FOCUS' || sectionMode === 'INNATE') return null;
  if (sourceName === 'RITUALS' || sectionMode === 'RITUAL') return 'LIST-ONLY';
  if (sourceType?.startsWith('SPONTANEOUS-')) return 'LIST-ONLY';
  if (sourceType === 'PREPARED-LIST') return 'SLOTS-AND-LIST';
  if (sourceType?.startsWith('PREPARED-')) return 'SLOTS-ONLY';
  return null;
}

export function isWitchFamiliarSource(source?: { name?: string; type?: string }) {
  if (source?.type !== 'PREPARED-LIST') return false;
  const name = (source.name ?? '').toLowerCase();
  return name.includes('witch') || name.includes('familiar');
}

export type Phase1SpellEntry = {
  key: string;
  spell?: Spell;
  rank: number;
  traitNames: string[];
  sourceName: string;
  mode: Phase1SpellMode;
  cantrip: boolean;
  available: boolean;
  exhausted: boolean;
  usesCurrent?: number;
  usesMax?: number;
  slotId?: string;
  empty?: boolean;
};

export type Phase1SpellbookEntry = {
  key: string;
  spell: Spell;
  rank: number;
  sourceName: string;
  traitNames: string[];
  cantrip: boolean;
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
  focusPoints?: { current: number; max: number };
};

export type Phase1SpellLoad = {
  sections: Phase1SpellSection[];
  list: Array<{ spell_id: number; rank: number; source: string }>;
};

export function keepPreparedListSection(sourceType: string, entries: number, slots: number, hasFamiliarList: boolean) {
  return entries > 0 || slots > 0 || hasFamiliarList || sourceType === 'PREPARED-LIST';
}

export function spellCatalogSourceIds(enabled?: number[] | null) {
  return uniq([COMMON_CORE_ID, ...(enabled ?? [])]);
}

export async function loadEntitySpells(combatant: Phase1EntityCombatant): Promise<Phase1SpellLoad> {
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
      const entries = mode === 'PREPARED'
        ? sourceSlots.flatMap((slot, index) => {
            if (slot.spell_id == null) {
              return [makeEmptyEntry(source.name, slot.rank, slot.id, Boolean(slot.exhausted))];
            }
            const spell = spellById.get(slot.spell_id);
            if (!spell) return [makeEmptyEntry(source.name, slot.rank, slot.id, Boolean(slot.exhausted))];
            const traitNames = namesFor(spell, traitById);
            const cantrip = isCantrip(traitNames, slot.rank);
            return [makeEntry(spell, slot.rank, traitNames, source.name, mode, cantrip, cantrip || !slot.exhausted, Boolean(slot.exhausted), index, undefined, undefined, slot.id)];
          })
        : data.list.filter((entry) => entry.source === source.name).flatMap((record, index) => {
            const spell = spellById.get(record.spell_id);
            if (!spell) return [];
            const traitNames = namesFor(spell, traitById);
            const cantrip = isCantrip(traitNames, record.rank);
            const rankSlots = sourceSlots.filter((slot) => slot.rank === record.rank);
            const exhausted = cantrip ? false : !rankSlots.some((slot) => !slot.exhausted);
            const available = cantrip || rankSlots.some((slot) => !slot.exhausted);
            return [makeEntry(spell, record.rank, traitNames, source.name, mode, cantrip, available, exhausted, index)];
          });
      const hasFamiliarList = mode === 'PREPARED' && source.type === 'PREPARED-LIST'
        && data.list.some((entry) => entry.source === source.name);
      if (keepPreparedListSection(source.type, entries.length, sourceSlots.length, hasFamiliarList)) {
        sections.push({
          key: `${mode}-${source.name}`,
          label: source.name,
          mode,
          source,
          attack,
          dc,
          entries,
          slots: sourceSlots.map((slot) => ({ rank: slot.rank, exhausted: Boolean(slot.exhausted) })),
        });
      }
    }

    const focusRecords = data.focus.filter((entry) => entry.source === source.name);
    if (focusRecords.length) {
      const points = getFocusPoints(storeId, entity, data.focus);
      const focusExhausted = points.current <= 0;
      const entries = focusRecords.flatMap((record, index) => {
        const spell = spellById.get(record.spell_id);
        if (!spell) return [];
        return [makeEntry(spell, record.rank ?? spell.rank, namesFor(spell, traitById), source.name, 'FOCUS', false, points.current > 0, focusExhausted, index, points.current, points.max)];
      });
      sections.push({
        key: `FOCUS-${source.name}`,
        label: `${source.name} Focus Spells`,
        mode: 'FOCUS',
        source,
        attack,
        dc,
        entries,
        slots: [],
        focusPoints: points,
      });
    }
  }

  if (data.innate.length) {
    const entries = data.innate.flatMap((record, index) => {
      const spell = spellById.get(record.spell_id);
      if (!spell) return [];
      const traitNames = namesFor(spell, traitById);
      const cantrip = traitNames.some((name) => name.toLowerCase() === 'cantrip');
      const remaining = Math.max(record.casts_max - record.casts_current, 0);
      const exhausted = !cantrip && remaining <= 0;
      return [makeEntry(spell, record.rank, traitNames, 'Innate', 'INNATE', cantrip, cantrip || remaining > 0, exhausted, index, remaining, record.casts_max)];
    });
    sections.push({ key: 'INNATE', label: 'Innate Spells', mode: 'INNATE', attack, dc, entries, slots: [] });
  }

  const ritualRecords = data.list.filter((entry) => entry.source === 'RITUALS');
  const ritualEntries = ritualRecords.flatMap((record, index) => {
    const spell = spellById.get(record.spell_id);
    if (!spell) return [];
    const traitNames = namesFor(spell, traitById);
    const cantrip = isCantrip(traitNames, record.rank);
    return [makeEntry(spell, record.rank, traitNames, 'RITUALS', 'RITUAL', cantrip, true, false, index)];
  });
  sections.push({
    key: 'RITUALS',
    label: 'Rituals',
    mode: 'RITUAL',
    source: { name: 'RITUALS', type: 'RITUAL', tradition: '', attribute: '' },
    entries: ritualEntries,
    slots: [],
  });

  return { sections, list: data.list };
}

export function spellbookEntriesForSource(
  list: Array<{ spell_id: number; rank: number; source: string }>,
  sourceName: string,
  spells: Spell[],
  traits: Array<{ id: number; name: string }>,
): Phase1SpellbookEntry[] {
  const spellById = new Map(spells.map((spell) => [spell.id, spell]));
  const traitById = new Map(traits.map((trait) => [trait.id, trait.name]));
  return list
    .filter((entry) => entry.source === sourceName)
    .flatMap((entry, index) => {
      const spell = spellById.get(entry.spell_id);
      if (!spell) return [];
      const traitNames = namesFor(spell, traitById);
      return [{
        key: `${sourceName}-${entry.spell_id}-${entry.rank}-${index}`,
        spell,
        rank: entry.rank,
        sourceName,
        traitNames,
        cantrip: isCantrip(traitNames, entry.rank),
      }];
    })
    .sort((a, b) => a.rank - b.rank || a.spell.name.localeCompare(b.spell.name));
}

/** @deprecated Use setEntitySpellCast instead */
export async function castEntitySpell(combatant: Phase1EntityCombatant, entry: Phase1SpellEntry): Promise<LivingEntity> {
  return setEntitySpellCast(combatant, entry, true);
}

export async function setEntitySpellCast(combatant: Phase1EntityCombatant, entry: Phase1SpellEntry, cast: boolean): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  if (entry.cantrip || entry.empty || !entry.spell) return raw;

  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);

  if (entry.mode === 'PREPARED') {
    const index = spells.slots.findIndex(
      (slot) =>
        slot.spell_id === entry.spell!.id &&
        slot.rank === entry.rank &&
        slot.source === entry.sourceName &&
        Boolean(slot.exhausted) === !cast,
    );
    if (index >= 0) spells.slots[index] = { ...spells.slots[index], exhausted: cast };
  } else if (entry.mode === 'SPONTANEOUS') {
    let updated = false;
    spells.slots = spells.slots.map((slot) => {
      if (!updated && slot.rank === entry.rank && slot.source === entry.sourceName && Boolean(slot.exhausted) === !cast) {
        updated = true;
        return { ...slot, exhausted: cast };
      }
      return slot;
    });
  } else if (entry.mode === 'FOCUS') {
    spells.focus_point_current = Math.max((spells.focus_point_current ?? 0) + (cast ? -1 : 1), 0);
  } else if (entry.mode === 'INNATE') {
    spells.innate_casts = spells.innate_casts.map((innate) =>
      innate.spell_id === entry.spell!.id && innate.rank === entry.rank
        ? {
            ...innate,
            casts_current: cast
              ? Math.min(innate.casts_current + 1, innate.casts_max)
              : Math.max(innate.casts_current - 1, 0),
          }
        : innate,
    );
  }

  return { ...raw, spells };
}

export async function setEntitySpellRankSpent(
  combatant: Phase1EntityCombatant,
  sourceName: string,
  rank: number,
  spentCount: number,
): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);
  let count = 0;

  spells.slots = spells.slots.map((slot) => {
    if (slot.rank !== rank || slot.source !== sourceName) return slot;
    const exhausted = count < spentCount;
    count++;
    return { ...slot, exhausted };
  });

  return { ...raw, spells };
}

export async function setEntityPreparedEntrySpent(
  combatant: Phase1EntityCombatant,
  entry: Phase1SpellEntry,
  spent: boolean,
): Promise<LivingEntity> {
  return setEntitySpellCast(combatant, entry, spent);
}

export async function setEntityFocusSpent(
  combatant: Phase1EntityCombatant,
  maxPoints: number,
  spentCount: number,
): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);
  spells.focus_point_current = Math.max(maxPoints - spentCount, 0);
  return { ...raw, spells };
}

export async function setEntityInnateSpent(
  combatant: Phase1EntityCombatant,
  spellId: number,
  rank: number,
  castsCurrent: number,
): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);

  spells.innate_casts = spells.innate_casts.map((innate) =>
    innate.spell_id === spellId && innate.rank === rank
      ? { ...innate, casts_current: Math.max(0, Math.min(castsCurrent, innate.casts_max)) }
      : innate,
  );

  return { ...raw, spells };
}

export async function addEntitySpellToList(
  combatant: Phase1EntityCombatant,
  sourceName: string,
  spell: Spell,
  rank: number,
): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);
  const exists = spells.list.some((entry) => entry.spell_id === spell.id && entry.rank === rank && entry.source === sourceName);
  if (!exists) spells.list.push({ spell_id: spell.id, rank, source: sourceName });
  return { ...raw, spells };
}

export async function removeEntitySpellFromList(
  combatant: Phase1EntityCombatant,
  sourceName: string,
  spellId: number,
  rank?: number,
): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);
  spells.list = spells.list.filter((entry) => {
    if (entry.spell_id !== spellId || entry.source !== sourceName) return true;
    return rank != null && entry.rank !== rank;
  });
  spells.slots = spells.slots.map((slot) =>
    slot.source === sourceName && slot.spell_id === spellId && (rank == null || slot.rank === rank)
      ? { ...slot, spell_id: undefined }
      : slot,
  );
  return { ...raw, spells };
}

export async function prepareEntitySpellSlot(
  combatant: Phase1EntityCombatant,
  sourceName: string,
  slotId: string | undefined,
  spell: Spell,
  rank: number,
): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);
  const slotRank = rank;
  let index = slotId
    ? spells.slots.findIndex((slot) => slot.id === slotId && slot.source === sourceName && slot.rank === slotRank)
    : -1;
  if (index < 0) {
    index = spells.slots.findIndex((slot) => slot.source === sourceName && slot.rank === slotRank && slot.spell_id == null);
  }
  if (index < 0) {
    throw new Error(`No empty ${slotRank === 0 ? 'cantrip' : `rank ${slotRank}`} slot left for ${sourceName}.`);
  }
  spells.slots[index] = { ...spells.slots[index], spell_id: spell.id };
  const exists = spells.list.some((entry) => entry.spell_id === spell.id && entry.rank === rank && entry.source === sourceName);
  if (!exists) spells.list.push({ spell_id: spell.id, rank, source: sourceName });
  return { ...raw, spells };
}

export async function applyEntityDivineFont(
  combatant: Phase1EntityCombatant,
  sourceName: string,
  choice: 'heal' | 'harm',
): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, content, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);
  const target = content.spells.find((spell) => spell.name.toLowerCase() === choice);
  if (!target) throw new Error(`Could not find the ${choice} spell in your content sources.`);
  const ranks = [...new Set(spells.slots.filter((slot) => slot.source === sourceName && slot.rank > 0).map((slot) => slot.rank))];
  if (!ranks.length) throw new Error('No ranked spell slots to fill with Divine Font.');
  for (const rank of ranks) {
    const exists = spells.list.some((entry) => entry.spell_id === target.id && entry.rank === rank && entry.source === sourceName);
    if (!exists) spells.list.push({ spell_id: target.id, rank, source: sourceName });
    spells.slots = spells.slots.map((slot) =>
      slot.source === sourceName && slot.rank === rank && slot.spell_id == null ? { ...slot, spell_id: target.id } : slot,
    );
  }
  return { ...raw, spells };
}

export function isDivinePreparedSource(source?: { name?: string; tradition?: string; type?: string }) {
  if (!source) return false;
  const tradition = (source.tradition ?? '').toLowerCase();
  const name = (source.name ?? '').toLowerCase();
  return tradition === 'divine' || name.includes('divine');
}

export async function clearEntitySpellSlot(combatant: Phase1EntityCombatant, slotId: string): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const spells = buildSpellState(raw, data);
  spells.slots = spells.slots.map((slot) => (slot.id === slotId ? { ...slot, spell_id: undefined } : slot));
  return { ...raw, spells };
}

function buildSpellState(raw: LivingEntity, data: ReturnType<typeof collectEntitySpellcasting>) {
  return {
    slots: [...data.slots],
    list: [...(raw.spells?.list ?? [])],
    focus_point_current: raw.spells?.focus_point_current ?? 0,
    innate_casts: [...data.innate],
  };
}

function makeEntry(
  spell: Spell,
  rank: number,
  traitNames: string[],
  sourceName: string,
  mode: Phase1SpellMode,
  cantrip: boolean,
  available: boolean,
  exhausted: boolean,
  index: number,
  usesCurrent?: number,
  usesMax?: number,
  slotId?: string,
): Phase1SpellEntry {
  return { key: `${mode}-${sourceName}-${rank}-${spell.id}-${slotId ?? index}`, spell, rank, traitNames, sourceName, mode, cantrip, available, exhausted, usesCurrent, usesMax, slotId };
}

function makeEmptyEntry(sourceName: string, rank: number, slotId: string, exhausted: boolean): Phase1SpellEntry {
  return {
    key: `PREPARED-${sourceName}-${rank}-empty-${slotId}`,
    rank,
    traitNames: [],
    sourceName,
    mode: 'PREPARED',
    cantrip: rank === 0,
    available: true,
    exhausted,
    slotId,
    empty: true,
  };
}

function isCantrip(traitNames: string[], rank: number) {
  return rank === 0 || traitNames.some((name) => name.toLowerCase() === 'cantrip');
}

export function spellFitsSlot(spell: Spell, slotRank: number, listRank?: number) {
  const rank = listRank ?? spell.rank;
  const isCantripSpell = rank === 0;
  if (slotRank === 0) return isCantripSpell;
  return !isCantripSpell && rank <= slotRank;
}

export function heightenRanksFor(spell: Spell) {
  const base = Math.max(spell.rank, 1);
  return Array.from({ length: 11 - base }, (_, index) => base + index);
}

function namesFor(spell: Spell, traits: Map<number, string>) {
  return (spell.traits ?? []).map((id) => traits.get(id)).filter((name): name is string => Boolean(name));
}

function safeProf(storeId: string, name: string, dc = false): number | undefined {
  try {
    const value = Number(getFinalProfValue(storeId, name, dc));
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
