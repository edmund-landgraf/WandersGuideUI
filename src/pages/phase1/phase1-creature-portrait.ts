import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { lookupMonsterArt, monsterArtStaleTime, monsterArtUrl } from './phase1-monster-image';

/** A render error can occur after a successful image probe. One bounded recovery
 * per base query result avoids retry loops while permitting a new source or
 * explicit query invalidation (including art unlock) to recover. */
export function useCreaturePortrait(name: string, portrait: string, enabled = true) {
  const identity = JSON.stringify([name, portrait]);
  const active = enabled && Boolean(name.trim() || portrait);
  const art = useQuery({
    queryKey: ['phase1-creature-picker-art', name, portrait],
    queryFn: () => lookupMonsterArt(name, portrait || undefined, 'thumb'),
    enabled: active,
    staleTime: monsterArtStaleTime,
  });
  const [failure, setFailure] = useState<{ identity: string; updated: number; src: string; exhausted: boolean } | null>(null);
  const failed = failure?.identity === identity && failure.updated === art.dataUpdatedAt ? failure : null;
  // If we already verified a catalog identity, don't search again by name.
  const recoverySource = art.data?.monsterId != null ? monsterArtUrl(art.data.monsterId) : portrait;
  const recovery = useQuery({
    queryKey: ['phase1-creature-picker-art', name, portrait, 'render-recovery', art.dataUpdatedAt, failed?.src],
    queryFn: () => lookupMonsterArt(name, recoverySource || undefined, 'thumb', failed?.src),
    enabled: active && Boolean(failed),
    staleTime: monsterArtStaleTime,
    gcTime: 60_000,
  });
  const resolved = failed ? recovery.data : art.data;
  const src = active && !failed?.exhausted && resolved?.thumbSrc !== failed?.src ? resolved?.thumbSrc : undefined;
  const fullSrc = src ? (resolved?.fullSrc !== failed?.src ? resolved?.fullSrc || src : src) : undefined;
  function onError() {
    if (!src) return;
    if (failed) setFailure({ ...failed, exhausted: true });
    else setFailure({ identity, updated: art.dataUpdatedAt, src, exhausted: false });
  }
  return { src, fullSrc, onError, rejectedSrc: failed?.src, lookupSource: failed ? recoverySource : portrait };
}
