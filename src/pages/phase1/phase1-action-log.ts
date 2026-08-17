import type { ActionCost, Combatant, CombatantActionLogEntry, CombatantActionLogKind, InitiativeRoundLog } from '@schemas/content';
import { abilityNameAndCost } from '@utils/actions';
import type { Phase1Ability } from './phase1-abilities';

const EXECUTABLE_COSTS = new Set<string>([
  'ONE-ACTION',
  'TWO-ACTIONS',
  'THREE-ACTIONS',
  'ONE-TO-TWO-ACTIONS',
  'ONE-TO-THREE-ACTIONS',
  'TWO-TO-THREE-ACTIONS',
]);

const MOVE_NAMES = new Set(['stride', 'step', 'crawl', 'climb', 'swim', 'fly', 'burrow', 'leap']);

export type ActionLogDraft = {
  name: string;
  cost: ActionCost;
  kind: CombatantActionLogKind;
  extra?: string | null;
  round?: number;
};

export function currentActionRound(initiativeLog?: InitiativeRoundLog[]): number {
  if (!initiativeLog?.length) return 1;
  return Math.max(...initiativeLog.map((entry) => entry.round));
}

export function actionCostCount(cost: ActionCost | string | null | undefined): number {
  if (cost === 'THREE-ACTIONS') return 3;
  if (cost === 'TWO-ACTIONS' || cost === 'TWO-TO-THREE-ACTIONS') return 2;
  if (cost === 'ONE-ACTION' || cost === 'ONE-TO-TWO-ACTIONS' || cost === 'ONE-TO-THREE-ACTIONS') return 1;
  return 0;
}

export function roundActionTotal(entries: CombatantActionLogEntry[] | undefined, round: number): number {
  return (entries ?? [])
    .filter((entry) => (entry.round ?? 1) === round)
    .reduce((sum, entry) => sum + actionCostCount(entry.cost), 0);
}

export function wouldExceedRoundActions(entries: CombatantActionLogEntry[] | undefined, round: number, cost: ActionCost): boolean {
  const added = actionCostCount(cost);
  if (added <= 0) return false;
  return roundActionTotal(entries, round) + added > 3;
}

export function groupActionLogByRound(entries: CombatantActionLogEntry[] | undefined): Array<{ round: number; entries: CombatantActionLogEntry[]; spent: number }> {
  const groups = new Map<number, CombatantActionLogEntry[]>();
  for (const entry of entries ?? []) {
    const round = entry.round ?? 1;
    const list = groups.get(round) ?? [];
    list.push(entry);
    groups.set(round, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([round, roundEntries]) => ({
      round,
      entries: [...roundEntries].reverse(),
      spent: roundActionTotal(roundEntries, round),
    }));
}

export function isExecutableActionCost(cost: string | null | undefined): cost is NonNullable<ActionCost> {
  return Boolean(cost && EXECUTABLE_COSTS.has(cost));
}

export function isMovementAbility(ability: Pick<Phase1Ability, 'name' | 'traitNames'>): boolean {
  if (ability.traitNames.some((trait) => trait.toLowerCase() === 'move')) return true;
  const { name } = abilityNameAndCost(ability.name, null);
  return MOVE_NAMES.has(name.trim().toLowerCase());
}

export function isLoggableAbility(ability: Phase1Ability): boolean {
  return isExecutableActionCost(ability.actions) && !isMovementAbility(ability);
}

export function abilityLogKind(ability: Phase1Ability): CombatantActionLogKind {
  return ability.source === 'Weapon' ? 'attack' : 'action';
}

export function draftFromAbility(ability: Phase1Ability): ActionLogDraft {
  const { name } = abilityNameAndCost(ability.name, ability.actions);
  return {
    name,
    cost: ability.actions,
    kind: abilityLogKind(ability),
  };
}

export function createActionLogEntry(draft: ActionLogDraft, round: number): CombatantActionLogEntry {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    name: draft.name,
    cost: draft.cost,
    kind: draft.kind,
    extra: draft.extra?.trim() ? draft.extra.trim() : null,
    round,
  };
}

export function appendActionLog(combatant: Combatant, entry: CombatantActionLogEntry): Combatant {
  return {
    ...combatant,
    action_log: [...(combatant.action_log ?? []), entry],
  };
}

export function removeActionLogEntry(combatant: Combatant, entryId: string): Combatant {
  return {
    ...combatant,
    action_log: (combatant.action_log ?? []).filter((entry) => entry.id !== entryId),
  };
}
