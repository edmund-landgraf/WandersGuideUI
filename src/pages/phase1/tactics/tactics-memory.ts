const PREFIX = 'wgui-tactics-memory';

export function memoryKey(campaignId: number, encounterId: number, combatantId: string) {
  return `${PREFIX}:${campaignId}:${encounterId}:${combatantId}`;
}

export function readMemory(campaignId: number, encounterId: number, combatantId: string): string {
  try {
    return localStorage.getItem(memoryKey(campaignId, encounterId, combatantId)) ?? '';
  } catch {
    return '';
  }
}

export function writeMemory(campaignId: number, encounterId: number, combatantId: string, notes: string) {
  const trimmed = notes.trim();
  try {
    if (!trimmed) localStorage.removeItem(memoryKey(campaignId, encounterId, combatantId));
    else localStorage.setItem(memoryKey(campaignId, encounterId, combatantId), trimmed);
  } catch {
    // The window can still finish this request without persisting the notes.
  }
}
