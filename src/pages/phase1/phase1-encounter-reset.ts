import type { Combatant, Creature, LivingEntity } from '@schemas/content';

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
