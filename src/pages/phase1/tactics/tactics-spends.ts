const PREFIX = 'wgui-tactics-spends';

export function spendKey(campaignId: number, encounterId: number, combatantId: string, abilityId: string) {
  return `${PREFIX}:${campaignId}:${encounterId}:${combatantId}:${abilityId}`;
}

export function readSpend(campaignId: number, encounterId: number, combatantId: string, abilityId: string): number {
  try {
    const raw = localStorage.getItem(spendKey(campaignId, encounterId, combatantId, abilityId));
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function confirmSpend(campaignId: number, encounterId: number, combatantId: string, abilityId: string) {
  const next = readSpend(campaignId, encounterId, combatantId, abilityId) + 1;
  localStorage.setItem(spendKey(campaignId, encounterId, combatantId, abilityId), String(next));
  return next;
}

export function listSpends(campaignId: number, encounterId: number): { combatantId: string; abilityId: string; used: number }[] {
  const spends: { combatantId: string; abilityId: string; used: number }[] = [];
  const prefix = `${PREFIX}:${campaignId}:${encounterId}:`;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const [, , , combatantId, abilityId] = key.split(':');
      const used = Number(localStorage.getItem(key));
      if (combatantId && abilityId && used > 0) spends.push({ combatantId, abilityId, used });
    }
  } catch {
    return spends;
  }
  return spends;
}
