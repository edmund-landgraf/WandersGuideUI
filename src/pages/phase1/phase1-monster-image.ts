const PATHFINDER_API_ORIGIN = import.meta.env.VITE_PATHFINDER_API_ORIGIN || 'http://localhost:3333';

type MonsterRow = {
  MonsterId?: number;
  Name?: string;
  ImageUrl?: string | null;
};

export type Phase1MonsterArt = {
  monsterId: number | null;
  fullSrc: string;
  thumbSrc: string;
};

function normalizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\((elite|weak)\)\s*$/i, '')
    .replace(/,?\s+(elite|weak)$/i, '');
}

async function searchCreatures(path: '/api/monsters' | '/api/npcs', name: string): Promise<MonsterRow[]> {
  const url = `${PATHFINDER_API_ORIGIN}${path}?name=${encodeURIComponent(name)}&limit=25`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Monster lookup failed (${response.status})`);
  const payload = (await response.json()) as { rows?: MonsterRow[] };
  return payload.rows ?? [];
}

function pickMonsterRow(rows: MonsterRow[], name: string) {
  const needle = normalizeName(name);
  const exact = rows.filter((row) => normalizeName(row.Name ?? '') === needle);
  const pool = exact.length ? exact : rows;
  return pool.find((row) => row.ImageUrl) ?? null;
}

function resolveImageUrl(imageUrl: string) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith('/')) return `${PATHFINDER_API_ORIGIN}${imageUrl}`;
  return imageUrl;
}

function fullResolutionUrl(imageUrl: string) {
  return resolveImageUrl(imageUrl).replace(/\/image\/thumb\/?$/, '/image');
}

export async function lookupMonsterArt(name: string, fallbackUrl?: string): Promise<Phase1MonsterArt | null> {
  const trimmedFallback = fallbackUrl?.trim() || undefined;
  const lookupName = normalizeName(name) || name.trim();

  if (lookupName) {
    try {
      const monsters = await searchCreatures('/api/monsters', lookupName);
      const npcs = monsters.some((row) => row.ImageUrl && normalizeName(row.Name ?? '') === lookupName)
        ? []
        : await searchCreatures('/api/npcs', lookupName);
      const pick = pickMonsterRow([...monsters, ...npcs], lookupName);
      if (pick?.ImageUrl) {
        const src = fullResolutionUrl(pick.ImageUrl);
        return { monsterId: pick.MonsterId ?? null, fullSrc: src, thumbSrc: src };
      }
    } catch {
      // Fall back to the entity image URL when PathfinderUtil is unavailable.
    }
  }

  if (!trimmedFallback) return null;
  const src = fullResolutionUrl(trimmedFallback);
  return { monsterId: null, fullSrc: src, thumbSrc: src };
}
