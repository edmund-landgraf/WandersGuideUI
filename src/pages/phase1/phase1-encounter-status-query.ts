import { queryOptions } from '@tanstack/react-query';
import { isHazardCombatant } from '@utils/encounter-hazard';
import { calculateEntityStatus, type Phase1CreatureStatus } from './phase1-stats';
import type { Phase1EntityCombatant } from './phase1-entity';
import { encounterStatusQueryKey } from './phase1-encounter-status-key';
import { fallbackStatus, hasFullEntityDetails, statsFor, type PopulatedCombatant } from './phase1-entity-panels';

type CombatantStatusMap = Record<string, Phase1CreatureStatus | null>;

/** Single query contract used by the mounted encounter and its integration tests. */
export function encounterStatusQueryOptions(encounterId: number | null, combatants: PopulatedCombatant[]) {
  return queryOptions({
    queryKey: encounterStatusQueryKey(encounterId, combatants),
    enabled: encounterId !== null && combatants.length > 0,
    queryFn: async () => {
      const result: CombatantStatusMap = {};
      for (const combatant of combatants) {
        if (isHazardCombatant(combatant) || combatant.access?.details_revealed === false || !hasFullEntityDetails(combatant) || !combatant.data) continue;
        try {
          result[combatant._id] = await calculateEntityStatus(combatant as Phase1EntityCombatant);
        } catch {
          const stored = statsFor(combatant.data);
          result[combatant._id] = stored.defensesKnown ? fallbackStatus(combatant.data) : null;
        }
      }
      return result;
    },
    staleTime: 30_000,
  });
}
