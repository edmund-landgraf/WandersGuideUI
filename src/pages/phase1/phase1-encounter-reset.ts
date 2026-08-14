import { compileTraits } from '@items/inv-utils';
import type { Combatant, Creature, Inventory, InventoryItem, LivingEntity } from '@schemas/content';
import { hasTraitType } from '@utils/traits';

/** PF2e focus-point cap; the sheet clamps this down to the caster's actual max. */
const FOCUS_POINT_CAP = 3;

export function resetSpellUsage(spells: LivingEntity['spells']): LivingEntity['spells'] {
  if (!spells) return spells;
  return {
    ...spells,
    slots: spells.slots.map((slot) => ({ ...slot, exhausted: false })),
    innate_casts: spells.innate_casts.map((entry) => ({ ...entry, casts_current: 0 })),
    focus_point_current: FOCUS_POINT_CAP,
  };
}

function numericOrUndefined(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : undefined;
}

function greatestSpellSlotRank(spells: LivingEntity['spells']): number {
  return spells?.slots.reduce((max, slot) => Math.max(max, slot.rank ?? 0), 0) ?? 0;
}

function restoreInventoryItemPools(entry: InventoryItem, staffChargeMax: number): InventoryItem {
  const traits = compileTraits(entry.item);
  const isStaff = hasTraitType('STAFF', traits);
  const isWand = hasTraitType('WAND', traits);
  const meta = entry.item.meta_data;
  let item = entry.item;
  if (meta || isStaff || isWand) {
    const nextMeta = { bulk: {}, ...(meta ?? {}) };
    let changed = false;
    const hpMax = numericOrUndefined(nextMeta.hp_max);
    const hp = numericOrUndefined(nextMeta.hp);
    if (hpMax != null && hpMax > 0 && hp !== hpMax) {
      nextMeta.hp = hpMax;
      changed = true;
    }
    const existingMax = numericOrUndefined(nextMeta.charges?.max);
    const chargeMax = isWand ? 1 : isStaff && staffChargeMax > 0 ? staffChargeMax : existingMax;
    if (chargeMax != null || nextMeta.charges?.current) {
      nextMeta.charges = {
        ...nextMeta.charges,
        current: 0,
        ...(chargeMax != null ? { max: chargeMax } : {}),
      };
      changed = true;
    }
    if (changed) item = { ...entry.item, meta_data: nextMeta };
  }
  return {
    ...entry,
    item,
    container_contents: entry.container_contents.map((child) => restoreInventoryItemPools(child, staffChargeMax)),
  };
}

function restoreInventoryPools(
  inventory: Inventory | null | undefined,
  staffChargeMax: number
): Inventory | null | undefined {
  if (!inventory) return inventory;
  return {
    ...inventory,
    items: inventory.items.map((entry) => restoreInventoryItemPools(entry, staffChargeMax)),
  };
}

export function resolveResetMaxHp(entity: LivingEntity, calculatedMax?: number | null): number {
  const stored = entity.meta_data?.calculated_stats?.hp_max;
  const values = [stored, calculatedMax, entity.hp_current].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  return values.length > 0 ? Math.max(...values) : 0;
}

export function resetEntityCombatState<T extends LivingEntity>(entity: T, maxHp: number): T {
  return {
    ...entity,
    hp_current: maxHp,
    hp_temp: 0,
    spells: resetSpellUsage(entity.spells),
    details: entity.details ? { ...entity.details, conditions: [] } : entity.details,
  };
}

/** Fill HP and restore encounter consumables (spells, focus, wands/staves, item HP) without clearing conditions. */
export function maxEntityStats<T extends LivingEntity>(entity: T, maxHp: number): T {
  const staminaMax = entity.meta_data?.calculated_stats?.stamina_max;
  const resolveMax = entity.meta_data?.calculated_stats?.resolve_max;
  const spells = resetSpellUsage(entity.spells);
  return {
    ...entity,
    hp_current: maxHp,
    stamina_current: staminaMax != null && staminaMax > 0 ? staminaMax : entity.stamina_current,
    resolve_current: resolveMax != null && resolveMax > 0 ? resolveMax : entity.resolve_current,
    spells,
    inventory: restoreInventoryPools(entity.inventory, greatestSpellSlotRank(spells)) ?? entity.inventory,
  };
}

export function resetCombatant(combatant: Combatant, maxHp: number): Combatant {
  const next: Combatant = {
    ...combatant,
    initiative: undefined,
    initiative_roll: undefined,
    change_log: [],
  };
  if (combatant.type === 'CREATURE' && combatant.creature) {
    next.creature = resetEntityCombatState(combatant.creature, maxHp) as Creature;
  }
  return next;
}

export function maxCombatantStats(combatant: Combatant, maxHp: number): Combatant {
  if (combatant.type === 'CREATURE' && combatant.creature) {
    return { ...combatant, creature: maxEntityStats(combatant.creature, maxHp) as Creature };
  }
  return combatant;
}
