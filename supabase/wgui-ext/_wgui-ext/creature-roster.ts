// Numbering and starting HP for a creature copied onto an encounter.
// Same rules as the campaign UI. No imports, so Node tests can load it.

export type RosterCombatant = {
  _id?: string;
  type?: string;
  ally?: boolean;
  creature?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
};

const NUMBERED_CREATURE_NAME = /^(.*) \((\d+)\)$/;

export function creatureNameParts(name: string): { base: string; number: number | null } {
  const match = name.match(NUMBERED_CREATURE_NAME);
  if (!match) return { base: name, number: null };
  return { base: match[1], number: Number.parseInt(match[2], 10) };
}

function creatureName(combatant: RosterCombatant): string | undefined {
  if (combatant.type !== 'CREATURE') return undefined;
  const named = combatant.creature?.name ?? combatant.data?.name;
  return typeof named === 'string' && named !== '' ? named : undefined;
}

function withCreatureName(combatant: RosterCombatant, name: string): RosterCombatant {
  const next = structuredClone(combatant);
  if (next.creature) next.creature = { ...next.creature, name };
  if (next.data) next.data = { ...next.data, name };
  return next;
}

function nextCloneName(sourceName: string, roster: RosterCombatant[]): string {
  const { base } = creatureNameParts(sourceName);
  const used = new Set<number>();
  for (const combatant of roster) {
    const name = creatureName(combatant);
    if (!name) continue;
    const parts = creatureNameParts(name);
    if (parts.base !== base) continue;
    used.add(parts.number ?? 1);
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return `${base} (${next})`;
}

/** The second copy of a creature becomes "(2)" and the unnumbered first copy becomes "(1)". */
export function placeCreature(list: RosterCombatant[], incoming: RosterCombatant): RosterCombatant[] {
  const sourceName = creatureName(incoming) ?? 'Creature';
  const { base } = creatureNameParts(sourceName);
  const sameType = list.filter((item) => {
    const name = creatureName(item);
    return Boolean(name && creatureNameParts(name).base === base);
  });
  const only = sameType.length === 1 ? sameType[0] : undefined;
  const onlyName = only ? creatureName(only) : undefined;
  const firstOfType = Boolean(only && onlyName && creatureNameParts(onlyName).number === null);
  if (firstOfType && only) {
    const renamed = list.map((item) => (item._id === only._id ? withCreatureName(item, `${base} (1)`) : item));
    return [...renamed, withCreatureName(incoming, `${base} (2)`)];
  }
  if (sameType.length > 0) return [...list, withCreatureName(incoming, nextCloneName(sourceName, list))];
  return [...list, incoming];
}

function numericValue(raw: unknown): number | null {
  if (raw && typeof raw === 'object') raw = (raw as { value?: unknown }).value;
  if (typeof raw === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(raw.trim())) raw = Number(raw);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** Mirror the static HP formula used by getFinalHealthValue for catalog creatures.
 * MAX_HEALTH_BONUS is a remainder, not the published maximum. Do not evaluate
 * arbitrary operation expressions here; a trusted calculated max is the fallback.
 */
export function catalogCreatureMaxHp(creature: Record<string, unknown>): number | null {
  const stats = (creature.meta_data as { calculated_stats?: { hp_max?: unknown } } | null)?.calculated_stats;
  const stored = numericValue(stats?.hp_max);
  const keys = new Set(['MAX_HEALTH_ANCESTRY', 'MAX_HEALTH_CLASS_PER_LEVEL', 'MAX_HEALTH_BONUS', 'ATTRIBUTE_CON']);
  const values = new Map<string, number>();
  let unknown = false;
  for (const operation of Array.isArray(creature.operations) ? creature.operations : []) {
    if (!operation || typeof operation !== 'object') continue;
    const { type, data } = operation as { type?: string; data?: { variable?: string; value?: unknown } };
    if (!data?.variable || !keys.has(data.variable)) continue;
    // Some old catalog fixtures omit the operation type for an adjustment.
    if (type !== undefined && type !== 'setValue' && type !== 'adjValue' && type !== 'addBonusToValue') continue;
    const value = numericValue(data.value);
    if (value === null) {
      if (data.value != null) unknown = true;
      continue;
    }
    values.set(data.variable, type === 'setValue' ? value : (values.get(data.variable) ?? 0) + value);
  }
  const bonus = values.get('MAX_HEALTH_BONUS');
  const level = numericValue(creature.level) ?? 0;
  if (!unknown && level !== -100 && (bonus !== undefined || values.has('MAX_HEALTH_CLASS_PER_LEVEL') || values.has('MAX_HEALTH_ANCESTRY'))) {
    const computed = (values.get('MAX_HEALTH_ANCESTRY') ?? 0) + (bonus ?? 0)
      + ((values.get('MAX_HEALTH_CLASS_PER_LEVEL') ?? 0) + (values.get('ATTRIBUTE_CON') ?? 0)) * level;
    // Preserve an independently stored maximum; replace only a missing or
    // identifiable raw-remainder cache.
    if (computed > 0 && (stored == null || stored <= 0 || stored === bonus)) return computed;
  }
  return stored != null && stored > 0 ? stored : null;
}

/** Only call when copying a catalog row into a NEW encounter combatant.
 * Existing encounter HP (including zero) must never be reinitialized here.
 */
export function creatureForEncounter(row: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(row);
  const max = catalogCreatureMaxHp(copy);
  if (max == null) return copy;
  const meta = copy.meta_data && typeof copy.meta_data === 'object' ? { ...(copy.meta_data as Record<string, unknown>) } : {};
  const stats = meta.calculated_stats && typeof meta.calculated_stats === 'object'
    ? { ...(meta.calculated_stats as Record<string, unknown>) }
    : {};
  copy.hp_current = max;
  copy.hp_temp = 0;
  stats.hp_max = max;
  meta.calculated_stats = stats;
  copy.meta_data = meta;
  return copy;
}
