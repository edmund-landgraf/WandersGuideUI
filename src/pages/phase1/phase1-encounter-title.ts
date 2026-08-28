/** Middle-dot / dash titles like "Random Encounter · Lost Wizard's Vault". */
const TITLE_SPLIT = /\s*[·•|–—]\s*| - /;

function isEncounterCategory(segment: string) {
  return /^(random\s+)?([\w'/]+\s+)*encounter$/i.test(segment.trim());
}

/** Show the location/scene name without a leading encounter-kind prefix. */
export function encounterDisplayName(name: string) {
  const trimmed = name.trim();
  const parts = trimmed.split(TITLE_SPLIT).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return trimmed;
  if (isEncounterCategory(parts[0])) return parts.slice(1).join(' · ');
  return trimmed;
}

export function encounterNameKey(name: string) {
  return encounterDisplayName(name).trim().toLowerCase();
}

export function encounterNamesMatch(a: string | undefined, b: string | undefined) {
  if (!a?.trim() || !b?.trim()) return false;
  return encounterNameKey(a) === encounterNameKey(b);
}
