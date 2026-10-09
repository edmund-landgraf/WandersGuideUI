const PATHFINDER_API_ORIGIN = import.meta.env.VITE_PATHFINDER_API_ORIGIN || 'http://localhost:3333';
const ART_PASSWORD_COOKIE = 'wgui_art_password';
const ART_PASSWORD_MAX_AGE = 60 * 60 * 24 * 180;

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

function hostedMonsterImage(monsterId: number, size: 'thumb' | 'full') {
  const suffix = size === 'thumb' ? '/image/thumb' : '/image';
  return `${PATHFINDER_API_ORIGIN}/api/monsters/${monsterId}${suffix}`;
}

let artUnlock: Promise<boolean> | null = null;
let unlockedPassword = '';

export function readArtPassword() {
  if (typeof document === 'undefined') return '';
  const entry = document.cookie.split('; ').find((part) => part.startsWith(`${ART_PASSWORD_COOKIE}=`));
  if (!entry) return '';
  try {
    return decodeURIComponent(entry.slice(ART_PASSWORD_COOKIE.length + 1));
  } catch {
    return '';
  }
}

export function clearArtPassword() {
  if (typeof document === 'undefined') return;
  document.cookie = `${ART_PASSWORD_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  artUnlock = null;
  unlockedPassword = '';
}

function rememberArtPassword(password: string) {
  document.cookie = `${ART_PASSWORD_COOKIE}=${encodeURIComponent(password)}; Path=/; Max-Age=${ART_PASSWORD_MAX_AGE}; SameSite=Lax`;
}

export function unlockMonsterArt(password: string) {
  const trimmed = password.trim();
  if (!trimmed) return Promise.resolve(false);
  if (artUnlock && unlockedPassword === trimmed) return artUnlock;
  unlockedPassword = trimmed;
  artUnlock = fetch(`${PATHFINDER_API_ORIGIN}/api/art/unlock`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: trimmed }),
  })
    .then((response) => {
      if (!response.ok) {
        artUnlock = null;
        unlockedPassword = '';
        return false;
      }
      rememberArtPassword(trimmed);
      return true;
    })
    .catch(() => {
      artUnlock = null;
      unlockedPassword = '';
      return false;
    });
  return artUnlock;
}

async function fetchArtObjectUrl(url: string) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) return null;
  return URL.createObjectURL(blob);
}

export async function lookupMonsterArt(name: string, fallbackUrl?: string, size: 'thumb' | 'full' = 'thumb'): Promise<Phase1MonsterArt | null> {
  const trimmedFallback = fallbackUrl?.trim() || undefined;
  const lookupName = normalizeName(name) || name.trim();

  if (lookupName) {
    try {
      const monsters = await searchCreatures('/api/monsters', lookupName);
      const npcs = monsters.some((row) => normalizeName(row.Name ?? '') === lookupName)
        ? []
        : await searchCreatures('/api/npcs', lookupName);
      const pick = pickMonsterRow([...monsters, ...npcs], lookupName) ?? [...monsters, ...npcs].find((row) => row.MonsterId);
      const password = readArtPassword();
      if (pick?.MonsterId && password) {
        const unlocked = await unlockMonsterArt(password);
        if (!unlocked) {
          clearArtPassword();
          return null;
        }
        const src = await fetchArtObjectUrl(hostedMonsterImage(pick.MonsterId, size));
        if (src) {
          return { monsterId: pick.MonsterId, fullSrc: src, thumbSrc: src };
        }
      }
    } catch {
      // Fall back to the entity image URL when PathfinderUtil is unavailable.
    }
  }

  if (!trimmedFallback || /aonprd\.com/i.test(trimmedFallback)) return null;
  const src = resolveImageUrl(trimmedFallback);
  return { monsterId: null, fullSrc: src, thumbSrc: src };
}
