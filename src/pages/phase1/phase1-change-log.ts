import type { Combatant, CombatantChangeLogEntry, CombatantChangeLogField, Condition, Encounter, LivingEntity } from '@schemas/content';
import { evaluate } from 'mathjs';

export function createChangeLogEntry(
  field: CombatantChangeLogField,
  from: unknown,
  to: unknown,
  note?: string | null
): CombatantChangeLogEntry {
  const trimmed = note?.trim();
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    field,
    from,
    to,
    note: trimmed ? trimmed : null,
  };
}

export function appendChangeLog(combatant: Combatant, entry: CombatantChangeLogEntry): Combatant {
  return {
    ...combatant,
    change_log: [...(combatant.change_log ?? []), entry],
  };
}

export function updateEncounterCombatant(encounter: Encounter, combatantId: string, next: Combatant): Encounter {
  return {
    ...encounter,
    combatants: {
      list: encounter.combatants.list.map((combatant) => (combatant._id === combatantId ? next : combatant)),
    },
  };
}

export function formatChangeLogField(field: CombatantChangeLogField): string {
  if (field === 'hp_current') return 'HP';
  if (field === 'hp_temp') return 'Temp HP';
  return 'Conditions';
}

export function conditionSummary(conditions: Condition[]): string {
  if (conditions.length === 0) return 'none';
  return conditions
    .map((condition) => (condition.value != null ? `${condition.name} ${condition.value}` : condition.name))
    .join(', ');
}

export function formatChangeLogValue(field: CombatantChangeLogField, value: unknown): string {
  if (field === 'conditions') return conditionSummary(Array.isArray(value) ? (value as Condition[]) : []);
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

export function formatChangeLogTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function parseNumericInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—') return null;
  let result = Number.NaN;
  try {
    result = evaluate(trimmed);
  } catch {
    result = Number.parseInt(trimmed, 10);
  }
  if (!Number.isFinite(result)) return null;
  return Math.floor(result);
}

export function parseHpInput(raw: string, maxHp: number): number {
  const parsed = parseNumericInput(raw);
  let result = parsed ?? 0;
  if (result < 0) result = 0;
  if (maxHp > 0 && result > maxHp) result = maxHp;
  return result;
}

export function parseTempHpInput(raw: string): number {
  const parsed = parseNumericInput(raw);
  let result = parsed ?? 0;
  if (result < 0) result = 0;
  return result;
}

export type CharacterCombatFields = {
  hp_current?: number;
  hp_temp?: number;
  details?: LivingEntity['details'];
};

export function characterCombatFieldsFromEntity(entity: LivingEntity): CharacterCombatFields {
  return {
    hp_current: entity.hp_current,
    hp_temp: entity.hp_temp,
    details: entity.details,
  };
}
