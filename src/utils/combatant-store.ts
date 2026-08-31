import type { Combatant } from '@schemas/content';

export function getCombatantStoreID(combatant: Combatant) {
  if (combatant.type === 'CHARACTER') {
    return `CHARACTER_${combatant._id}`;
  } else if (combatant.type === 'CREATURE') {
    return `CREATURE_${combatant._id}`;
  } else {
    return '';
  }
}
