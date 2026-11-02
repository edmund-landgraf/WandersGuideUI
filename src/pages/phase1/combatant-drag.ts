import type { DragEvent as ReactDragEvent } from 'react';

export const COMBATANT_DRAG_TYPE = 'application/x-wanderers-guide-player';
export type CombatantDragPayload = { source: 'bench' | 'encounter' | 'out' | 'party'; combatantId?: string; characterId?: number };

let activeCombatantDrag: CombatantDragPayload | null = null;

export function writeCombatantDrag(event: ReactDragEvent, payload: CombatantDragPayload) {
  activeCombatantDrag = payload;
  event.dataTransfer.effectAllowed = 'move';
  const serialized = JSON.stringify(payload);
  event.dataTransfer.setData(COMBATANT_DRAG_TYPE, serialized);
  event.dataTransfer.setData('text/plain', serialized);
}

export function clearCombatantDrag() {
  activeCombatantDrag = null;
}

export function readCombatantDrag(event: ReactDragEvent): CombatantDragPayload | null {
  if (activeCombatantDrag) return activeCombatantDrag;
  try {
    const value = event.dataTransfer.getData(COMBATANT_DRAG_TYPE) || event.dataTransfer.getData('text/plain');
    return value ? JSON.parse(value) as CombatantDragPayload : null;
  } catch {
    return null;
  }
}

export function hasCombatantDrag(_event?: ReactDragEvent) {
  return activeCombatantDrag != null;
}
