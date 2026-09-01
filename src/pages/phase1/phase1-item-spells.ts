import { collectEntitySpellcasting } from '@content/collect-content';
import { filterByTraitType, isItemBroken } from '@items/inv-utils';
import type { InventoryItem, LivingEntity, Spell, SpellSlotRecord } from '@schemas/content';
import { detectSpells } from '@spells/spell-utils';
import { cloneDeep } from 'lodash-es';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';
import type { Phase1SpellEntry, Phase1SpellSection } from './phase1-spells';

const DEFAULT_WAND_HP = 2;

export type StaffCastOption = 'NORMAL' | 'SLOT-CONSUME';

function namesFor(spell: Spell, traits: Map<number, string>) {
  return (spell.traits ?? []).map((id) => traits.get(id)).filter((name): name is string => Boolean(name));
}

function isCantrip(traitNames: string[], rank: number) {
  return rank === 0 || traitNames.some((name) => name.toLowerCase() === 'cantrip');
}

function patchInventoryItem(entity: LivingEntity, itemId: string, map: (item: InventoryItem) => InventoryItem): LivingEntity {
  if (!entity.inventory) return entity;
  return {
    ...entity,
    inventory: {
      ...entity.inventory,
      items: entity.inventory.items.map((item) => (item.id === itemId ? map(item) : item)),
    },
  };
}

function withCharges(item: InventoryItem, charges: { current?: number; max?: number }): InventoryItem {
  return {
    ...item,
    item: {
      ...item.item,
      meta_data: {
        ...item.item.meta_data!,
        charges: {
          ...item.item.meta_data?.charges,
          current: charges.current ?? item.item.meta_data?.charges?.current,
          max: charges.max ?? item.item.meta_data?.charges?.max,
        },
      },
    },
  };
}

export function staffCastingKind(sources: Array<{ type: string }>): 'PREPARED' | 'SPONTANEOUS' | 'NONE' {
  if (sources.some((source) => source.type.startsWith('PREPARED-'))) return 'PREPARED';
  if (sources.some((source) => source.type.startsWith('SPONTANEOUS-'))) return 'SPONTANEOUS';
  return 'NONE';
}

function applyWandRankFromName(itemName: string, spells: Array<{ spell: Spell; rank: number }>) {
  const rankMatches = [...itemName.matchAll(/(\d)..-rank/gi)];
  if (rankMatches.length === 0) return spells;
  const rank = parseInt(rankMatches[0][1]);
  if (!Number.isFinite(rank)) return spells;
  return spells.map((record) => ({ spell: { ...record.spell, rank }, rank }));
}

export function collectItemSpellSections(
  entity: LivingEntity,
  allSpells: Spell[],
  traitById: Map<number, string>,
  spellData: ReturnType<typeof collectEntitySpellcasting>,
): Phase1SpellSection[] {
  const items = entity.inventory?.items ?? [];
  const sections: Phase1SpellSection[] = [];
  const kind = staffCastingKind(spellData.sources);
  const greatestSlotRank = spellData.slots.reduce((max, slot) => Math.max(max, slot.rank), 0);

  const staff = filterByTraitType(items, 'STAFF').find((item) => item.is_equipped);
  if (staff) {
    const detected = detectSpells(staff.item.description, allSpells);
    const maxCharges = Math.max(staff.item.meta_data?.charges?.max ?? 0, greatestSlotRank);
    const currentCharges = staff.item.meta_data?.charges?.current ?? 0;
    const entries: Phase1SpellEntry[] = detected.map((record, index) => {
      const rank = record.rank;
      const traitNames = namesFor(record.spell, traitById);
      const cantrip = isCantrip(traitNames, rank);
      const exhausted = !cantrip && (kind === 'SPONTANEOUS' ? currentCharges + 1 > maxCharges : currentCharges + rank > maxCharges);
      return {
        key: `STAFF-${staff.id}-${rank}-${record.spell.id}-${index}`,
        spell: record.spell,
        rank,
        traitNames,
        sourceName: staff.item.name,
        mode: 'STAFF',
        cantrip,
        available: cantrip || !exhausted,
        exhausted,
        usesCurrent: currentCharges,
        usesMax: maxCharges,
        itemId: staff.id,
        itemKind: 'STAFF',
        staffCasting: kind,
      };
    });
    sections.push({
      key: `STAFF-${staff.id}`,
      label: staff.item.name,
      mode: 'STAFF',
      entries,
      slots: [],
      charges: { current: currentCharges, max: maxCharges },
      canAddStaffCharges: kind === 'PREPARED' && (staff.item.meta_data?.charges?.max ?? 0) <= greatestSlotRank && greatestSlotRank > 0,
      staffSlots: unusedSpellSlots(spellData.slots).map((slot) => ({ id: slot.id, rank: slot.rank, source: slot.source })),
    });
  }

  const wands = filterByTraitType(items, 'WAND');
  if (wands.length) {
    const entries: Phase1SpellEntry[] = [];
    for (const wand of wands) {
      const detected = applyWandRankFromName(wand.item.name, detectSpells(wand.item.description, allSpells, true));
      const record = detected[0];
      if (!record) continue;
      const maxCharges = wand.item.meta_data?.charges?.max || 1;
      const currentCharges = wand.item.meta_data?.charges?.current ?? 0;
      const broken = isItemBroken(wand.item);
      const traitNames = namesFor(record.spell, traitById);
      const cantrip = isCantrip(traitNames, record.rank);
      entries.push({
        key: `WAND-${wand.id}-${record.spell.id}`,
        spell: record.spell,
        rank: record.rank,
        traitNames,
        sourceName: wand.item.name,
        mode: 'WAND',
        cantrip,
        available: !broken,
        exhausted: broken,
        usesCurrent: currentCharges,
        usesMax: maxCharges,
        itemId: wand.id,
        itemKind: 'WAND',
      });
    }
    if (entries.length) {
      sections.push({ key: 'WANDS', label: 'Wands', mode: 'WAND', entries, slots: [] });
    }
  }

  const hearts = filterByTraitType(items, 'SPELLHEART');
  if (hearts.length) {
    const entries: Phase1SpellEntry[] = [];
    for (const heart of hearts) {
      const detected = applyWandRankFromName(heart.item.name, detectSpells(heart.item.description, allSpells, true));
      const record = detected[0];
      if (!record) continue;
      const traitNames = namesFor(record.spell, traitById);
      const cantrip = isCantrip(traitNames, record.rank);
      const broken = isItemBroken(heart.item);
      entries.push({
        key: `SPELLHEART-${heart.id}-${record.spell.id}`,
        spell: record.spell,
        rank: record.rank,
        traitNames,
        sourceName: heart.item.name,
        mode: 'SPELLHEART',
        cantrip,
        available: !broken,
        exhausted: broken,
        itemId: heart.id,
        itemKind: 'SPELLHEART',
      });
    }
    sections.push({
      key: 'SPELLHEARTS',
      label: 'Spellhearts',
      mode: 'SPELLHEART',
      entries,
      slots: [],
    });
  }

  return sections;
}

export function unusedSpellSlots(slots: SpellSlotRecord[]) {
  return slots.filter((slot) => slot.rank > 0 && !slot.exhausted);
}

export async function setStaffCharges(combatant: Phase1EntityCombatant, itemId: string, current: number): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  return patchInventoryItem(raw, itemId, (item) => withCharges(item, { current: Math.max(0, current) }));
}

export async function addStaffChargesFromSlot(combatant: Phase1EntityCombatant, itemId: string, slotId: string): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  const { entity, storeId } = await preparePhase1Entity(combatant);
  const data = collectEntitySpellcasting(storeId, entity);
  const slot = data.slots.find((entry) => entry.id === slotId);
  if (!slot || slot.exhausted) throw new Error('Select an unused spell slot to add charges.');
  const staff = (raw.inventory?.items ?? []).find((item) => item.id === itemId);
  if (!staff) throw new Error('Staff not found.');
  const spells = {
    slots: data.slots.map((entry) => (entry.id === slotId ? { ...entry, exhausted: true } : entry)),
    list: [...(raw.spells?.list ?? [])],
    focus_point_current: data.focus.length ? (raw.spells?.focus_point_current ?? 0) : raw.spells?.focus_point_current,
    innate_casts: [...(raw.spells?.innate_casts ?? data.innate)],
  };
  const next = {
    ...raw,
    spells,
    inventory: raw.inventory,
  };
  return patchInventoryItem(next, itemId, (item) => withCharges(item, {
    max: (item.item.meta_data?.charges?.max ?? 0) + slot.rank,
  }));
}

export async function setStaffSpellCast(
  combatant: Phase1EntityCombatant,
  entry: Phase1SpellEntry,
  cast: boolean,
  option: StaffCastOption = 'NORMAL',
  slotRank?: number,
): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  if (!entry.itemId || !entry.spell) return raw;
  const staff = (raw.inventory?.items ?? []).find((item) => item.id === entry.itemId);
  if (!staff) return raw;
  const current = staff.item.meta_data?.charges?.current ?? 0;
  const max = staff.item.meta_data?.charges?.max ?? 0;
  const rank = entry.rank;

  if (cast && option === 'SLOT-CONSUME') {
    const { entity, storeId } = await preparePhase1Entity(combatant);
    const data = collectEntitySpellcasting(storeId, entity);
    let added = false;
    const slots = data.slots.map((slot) => {
      if (!added && slot.rank === slotRank && slot.exhausted !== true) {
        added = true;
        return { ...slot, exhausted: true };
      }
      return slot;
    });
    if (!added) throw new Error('No unused slot of that rank.');
    const next = {
      ...raw,
      spells: {
        slots,
        list: [...(raw.spells?.list ?? [])],
        focus_point_current: raw.spells?.focus_point_current,
        innate_casts: [...(raw.spells?.innate_casts ?? [])],
      },
    };
    return patchInventoryItem(next, entry.itemId, (item) => withCharges(item, { current: Math.min(current + 1, max) }));
  }

  const change = (cast ? 1 : -1) * rank;
  return patchInventoryItem(raw, entry.itemId, (item) => withCharges(item, {
    current: Math.max(Math.min(current + change, item.item.meta_data?.charges?.max ?? max), 0),
  }));
}

export function wandNeedsOvercharge(entry: Phase1SpellEntry) {
  return entry.mode === 'WAND' && !entry.exhausted && (entry.usesCurrent ?? 0) >= (entry.usesMax ?? 1);
}

export async function setWandSpellCast(combatant: Phase1EntityCombatant, entry: Phase1SpellEntry, cast: boolean, overcharge = false): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  if (!entry.itemId) return raw;
  const wand = (raw.inventory?.items ?? []).find((item) => item.id === entry.itemId);
  if (!wand) return raw;
  const maxCharges = wand.item.meta_data?.charges?.max || 1;
  const current = wand.item.meta_data?.charges?.current ?? 0;

  if (!cast) {
    return patchInventoryItem(raw, entry.itemId, (item) => ({
      ...item,
      item: {
        ...item.item,
        meta_data: {
          ...item.item.meta_data!,
          charges: { ...item.item.meta_data?.charges, current: 0, max: maxCharges },
          hp_max: item.item.meta_data?.hp_max || DEFAULT_WAND_HP,
          hp: item.item.meta_data?.hp_max || DEFAULT_WAND_HP,
          broken_threshold: Math.floor((Number(item.item.meta_data?.hp_max) || DEFAULT_WAND_HP) / 2),
        },
      },
    }));
  }

  if (current >= maxCharges) {
    if (!overcharge) throw new Error('OVERCHARGE_WAND');
    return patchInventoryItem(raw, entry.itemId, (item) => ({
      ...item,
      item: {
        ...item.item,
        meta_data: {
          ...item.item.meta_data!,
          charges: { ...item.item.meta_data?.charges, current: maxCharges, max: maxCharges },
          hp_max: item.item.meta_data?.hp_max || DEFAULT_WAND_HP,
          hp: Math.floor((Number(item.item.meta_data?.hp_max) || DEFAULT_WAND_HP) / 2),
          broken_threshold: Math.floor((Number(item.item.meta_data?.hp_max) || DEFAULT_WAND_HP) / 2),
        },
      },
    }));
  }

  return patchInventoryItem(raw, entry.itemId, (item) => withCharges(item, { current: current + 1, max: maxCharges }));
}

export async function setWandCharges(combatant: Phase1EntityCombatant, itemId: string, current: number): Promise<LivingEntity> {
  const raw = cloneDeep(combatant.data);
  return patchInventoryItem(raw, itemId, (item) => withCharges(item, { current: Math.max(0, current), max: item.item.meta_data?.charges?.max || 1 }));
}
