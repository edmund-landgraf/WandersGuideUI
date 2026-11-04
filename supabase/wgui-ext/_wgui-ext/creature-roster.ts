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

function healthBonus(creature: Record<string, unknown>): number | null {
  const operations = Array.isArray(creature.operations) ? creature.operations : [];
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') continue;
    const data = (operation as { data?: { variable?: unknown; value?: unknown } }).data;
    if (data?.variable !== 'MAX_HEALTH_BONUS') continue;
    const raw = data.value;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/** Catalog rows often store hp_current 0 and the real max on MAX_HEALTH_BONUS. Start those at full HP. */
export function creatureForEncounter(row: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(row);
  const current = copy.hp_current;
  if (typeof current === 'number' && Number.isFinite(current) && current > 0) return copy;
  const meta = copy.meta_data && typeof copy.meta_data === 'object' ? { ...(copy.meta_data as Record<string, unknown>) } : {};
  const stats = meta.calculated_stats && typeof meta.calculated_stats === 'object'
    ? { ...(meta.calculated_stats as Record<string, unknown>) }
    : {};
  const storedMax = typeof stats.hp_max === 'number' && stats.hp_max > 0 ? stats.hp_max : null;
  const max = storedMax ?? healthBonus(copy);
  if (max == null) return copy;
  copy.hp_current = max;
  if (typeof copy.hp_temp !== 'number') copy.hp_temp = 0;
  stats.hp_max = max;
  meta.calculated_stats = stats;
  copy.meta_data = meta;
  return copy;
}
