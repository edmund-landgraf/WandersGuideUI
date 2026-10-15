import { useAuthSession } from '@auth/useAuthSession';
import { useEffect } from 'react';
import { loadTacticsBundle } from './tactics-bundle';
import { postCombatSnapshot } from './tactics-export';
import { listSpends } from './tactics-spends';

export function TacticsPublisher({ campaignId, encounterId, revision }: { campaignId: number; encounterId: number; revision: string }) {
  const session = useAuthSession();
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadTacticsBundle(campaignId, encounterId, userId)
        .then((bundle) => {
          if (cancelled) return;
          const enemy = bundle.enemies[0];
          void postCombatSnapshot({
            snapshotId: `${campaignId}:${encounterId}:${bundle.round}:${enemy?.id ?? 'none'}:${revision}`,
            campaignId,
            encounterId,
            round: bundle.round,
            enemyId: enemy?.id ?? '',
            combatants: bundle.combatants,
            spends: listSpends(campaignId, encounterId),
            choices: [],
          });
        })
        .catch(() => undefined);
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [campaignId, encounterId, revision, userId]);
  return null;
}
