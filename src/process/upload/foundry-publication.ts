type PublicationSource = { name: string; foundry_id: string | null; user_id: string | null };

/** Foundry's current NPCs put publication under details, older ones under source. */
export function foundryPublicationTitle(json: Record<string, any>): string {
  return json.system?.details?.publication?.title || json.system?.publication?.title ||
    json.system?.details?.source?.value || json.system?.source?.value || '';
}

function normalized(title: string): string {
  return title.trim().replace(/^Pathfinder\s+/i, '').toLowerCase();
}

export function matchesFoundryPublication(source: PublicationSource, json: Record<string, any>, creature: boolean): boolean {
  const title = foundryPublicationTitle(json);
  if (!title) return false;
  if (source.foundry_id === title) return true;
  // Only official creature sources may use the book-title fallback. Never
  // route a homebrew file or an unrelated publication into a core source.
  return creature && source.user_id === null &&
    normalized(source.foundry_id ?? source.name) === normalized(title);
}
