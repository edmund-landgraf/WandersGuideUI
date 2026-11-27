import { publicArtSrc, publicStorageOrigin } from '@utils/public-art-url';

const LOCAL_PATHFINDER_PREFIX = '/local-pf';

function pathfinderApiOrigin() {
  if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
    return LOCAL_PATHFINDER_PREFIX;
  }
  return import.meta.env.VITE_PATHFINDER_API_ORIGIN || 'http://localhost:3333';
}
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
    .replace(/\s*\((?:elite|weak|\d+)\)\s*$/i, '')
    .replace(/,?\s+(elite|weak)$/i, '');
}

async function searchCreatures(path: '/api/monsters' | '/api/npcs', name: string): Promise<MonsterRow[]> {
  const url = `${pathfinderApiOrigin()}${path}?name=${encodeURIComponent(name)}&limit=25`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Monster lookup failed (${response.status})`);
  const payload = (await response.json()) as { rows?: MonsterRow[] };
  return payload.rows ?? [];
}

export function pickMonsterRow(rows: MonsterRow[], name: string) {
  const needle = normalizeName(name);
  const exact = rows.filter((row) => normalizeName(row.Name ?? '') === needle);
  const ids = new Set(exact.map((row) => row.MonsterId).filter((id) => Number.isSafeInteger(id) && id !== 0));
  if (ids.size !== 1) return null;
  return exact.find((row) => row.MonsterId === [...ids][0] && row.ImageUrl)
    ?? exact.find((row) => row.MonsterId === [...ids][0]) ?? null;
}

export function monsterArtPath(monsterId: number, size: 'thumb' | 'full' = 'full') {
  if (!Number.isSafeInteger(monsterId) || monsterId === 0) throw new Error('Invalid monster art ID');
  const suffix = size === 'thumb' ? '/image/thumb' : '/image';
  const resource = monsterId < 0 ? `user-monsters/${-monsterId}` : `monsters/${monsterId}`;
  return `/api/${resource}${suffix}`;
}

function hostedMonsterImage(monsterId: number, size: 'thumb' | 'full') {
  return `${pathfinderApiOrigin()}${monsterArtPath(monsterId, size)}`;
}

/** Recognize a stored PF2 endpoint (including the historical signed canonical route). */
export function storedMonsterArtId(value?: string): number | null {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://pf2.unwhelm.online');
    if (/^https?:\/\//i.test(value) && url.origin !== 'https://pf2.unwhelm.online' && url.origin !== pathfinderApiOrigin()) return null;
    const match = /\/api\/(user-monsters|monsters)\/(-?\d+)\/image(?:\/thumb)?\/?$/.exec(url.pathname);
    if (!match) return null;
    const id = Number(match[2]);
    return Number.isSafeInteger(id) && id !== 0 ? (match[1] === 'user-monsters' ? -Math.abs(id) : id) : null;
  } catch { return null; }
}

export function monsterArtUrl(monsterId: number, size: 'thumb' | 'full' = 'full') {
  return hostedMonsterImage(monsterId, size);
}

const ART_CACHE_PREFIX = 'wgui-monster-art:';
const LEGACY_ART_CACHE_PREFIX = 'wgui-monster-thumb:';

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
  clearCachedMonsterArt();
}

export function clearCachedMonsterArt() {
  if (typeof localStorage === 'undefined') return;
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(ART_CACHE_PREFIX) || key?.startsWith(LEGACY_ART_CACHE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

function rememberArtPassword(password: string) {
  document.cookie = `${ART_PASSWORD_COOKIE}=${encodeURIComponent(password)}; Path=/; Max-Age=${ART_PASSWORD_MAX_AGE}; SameSite=Lax`;
}

export function unlockMonsterArt(password: string) {
  const trimmed = password.trim();
  if (!trimmed) return Promise.resolve(false);
  if (artUnlock && unlockedPassword === trimmed) return artUnlock;
  unlockedPassword = trimmed;
  artUnlock = fetch(`${pathfinderApiOrigin()}/api/art/unlock`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: trimmed }),
    redirect: 'error',
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

function artCacheKey(name: string, size: 'thumb' | 'full') {
  return `${ART_CACHE_PREFIX}${size}:${name}`;
}

type CachedArt = { monsterId: number | null; src: string };

function parseCachedArt(raw: string | null): CachedArt | null {
  if (!raw) return null;
  if (raw.startsWith('data:') || raw.startsWith('http') || raw.startsWith('/')) return { monsterId: null, src: raw };
  try {
    const parsed = JSON.parse(raw) as CachedArt;
    if (parsed?.src) return { monsterId: parsed.monsterId ?? null, src: parsed.src };
  } catch {
    // Older entries are the image itself.
  }
  return { monsterId: null, src: raw };
}

function readCachedArt(name: string, size: 'thumb' | 'full'): CachedArt | null {
  try {
    const current = parseCachedArt(localStorage.getItem(artCacheKey(name, size)));
    if (current) return current;
    if (size === 'thumb') return parseCachedArt(localStorage.getItem(`${LEGACY_ART_CACHE_PREFIX}${name}`));
    return null;
  } catch {
    return null;
  }
}

function writeCachedArt(name: string, size: 'thumb' | 'full', art: CachedArt) {
  try {
    localStorage.setItem(artCacheKey(name, size), JSON.stringify(art));
  } catch {
    // A full cache should not hide the image that was just fetched.
  }
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchArtObjectUrl(url: string, password: string) {
  let response = await fetch(url, { credentials: 'include' });
  if (response.status === 401 || response.status === 403) {
    // The server-side art session may expire while the remembered password is still valid.
    artUnlock = null;
    unlockedPassword = '';
    if (!(await unlockMonsterArt(password))) return null;
    response = await fetch(url, { credentials: 'include' });
  }
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) return null;
  return blobToDataUrl(blob);
}

function ownCreatureArt(fallbackUrl?: string) {
  const trimmed = fallbackUrl?.trim();
  if (!trimmed || /aonprd\.com/i.test(trimmed) || storedMonsterArtId(trimmed) != null) return null;
  const src = trimmed.startsWith('/storage/')
    ? `${import.meta.env.DEV && typeof window !== 'undefined' ? window.location.origin : publicStorageOrigin()}${trimmed}`
    : publicArtSrc(trimmed);
  // Public storage and site portraits belong to the public asset host, not PF2.
  // Vite proxies local development storage on its own origin.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    try {
      const url = new URL(trimmed, window.location.origin);
      if (url.pathname.startsWith('/storage/') && url.protocol === 'http:' &&
          (['localhost', '127.0.0.1', '[::1]', 'kong'].includes(url.hostname) || url.port === '8000')) {
        const local = `${window.location.origin}${url.pathname}${url.search}`;
        return { monsterId: null, fullSrc: local, thumbSrc: local };
      }
    } catch { /* use the original public URL */ }
  }
  return { monsterId: null, fullSrc: src, thumbSrc: src };
}

/** Validate a public portrait with the same browser image loading rules as the renderer (no CORS requirement). */
async function portraitLoads(src: string): Promise<boolean> {
  if (typeof Image === 'undefined' || typeof window === 'undefined') return true;
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (ok: boolean) => { window.clearTimeout(timeout); image.onload = null; image.onerror = null; resolve(ok); };
    const timeout = window.setTimeout(() => finish(false), 5000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.referrerPolicy = 'no-referrer';
    image.src = src;
  });
}

/** Missing art must become eligible for retry after a transient outage. */
export function monsterArtStaleTime(query: { state: { data: unknown } }): number {
  return query.state.data ? 5 * 60_000 : 30_000;
}

/** Try both variants of the SAME verified identity; never substitute another creature. */
export async function loadMonsterArtVariant(
  preferred: 'thumb' | 'full',
  load: (size: 'thumb' | 'full') => Promise<string | null>,
): Promise<{ size: 'thumb' | 'full'; src: string } | null> {
  const alternate = preferred === 'thumb' ? 'full' : 'thumb';
  for (const size of [preferred, alternate] as const) {
    try {
      const src = await load(size);
      if (src) return { size, src };
    } catch {
      // A failed thumbnail (or full image) is not proof that the other variant is absent.
    }
  }
  return null;
}

export async function lookupMonsterArt(name: string, fallbackUrl?: string, size: 'thumb' | 'full' = 'thumb', rejectedSrc?: string): Promise<Phase1MonsterArt | null> {
  const trimmedFallback = fallbackUrl?.trim() || undefined;
  const lookupName = normalizeName(name) || name.trim();
  const password = readArtPassword();
  const explicitId = storedMonsterArtId(trimmedFallback);
  const own = ownCreatureArt(trimmedFallback);
  if (own && own.thumbSrc !== rejectedSrc && await portraitLoads(own.thumbSrc)) return own;

  if (!password) return null;

  // Stored PF2 art endpoints identify the creature directly. Never send the art
  // password to an arbitrary stored URL; unlock and fetch through the configured API.
  let monsterId = explicitId;
  const cacheKey = explicitId != null ? `id:${explicitId}` : lookupName;
  try {
    if (monsterId == null && lookupName) {
      // Verify uniqueness across both catalogs, not only the first matching catalog.
      const [monsters, npcs] = await Promise.all([
        searchCreatures('/api/monsters', lookupName),
        searchCreatures('/api/npcs', lookupName),
      ]);
      const pick = pickMonsterRow([...monsters, ...npcs], lookupName);
      monsterId = pick?.MonsterId ?? null;
      // Do not guess from partial or ambiguous names, including stale name-only cache entries.
      if (monsterId == null) return null;
    }
    if (monsterId != null) {
      const unlocked = await unlockMonsterArt(password);
      if (!unlocked) {
        clearArtPassword();
        return null;
      }
      const verifiedId = monsterId;
      const variant = await loadMonsterArtVariant(size, async (candidate) => {
        const src = await fetchArtObjectUrl(hostedMonsterImage(verifiedId, candidate), password);
        return src && src !== rejectedSrc && await portraitLoads(src) ? src : null;
      });
      if (variant) {
        const { src } = variant;
        writeCachedArt(cacheKey, variant.size, { monsterId, src });
        const fullCached = readCachedArt(cacheKey, 'full');
        const thumbCached = readCachedArt(cacheKey, 'thumb');
        return {
          monsterId,
          fullSrc: size === 'full' ? src : fullCached?.monsterId === monsterId && fullCached.src !== rejectedSrc ? fullCached.src : src,
          thumbSrc: size === 'thumb' ? src : thumbCached?.monsterId === monsterId && thumbCached.src !== rejectedSrc ? thumbCached.src : src,
        };
      }
    }
  } catch {
    // A verified cached image may still be available during an API outage.
  }

  const cached = cacheKey && monsterId != null
    ? [readCachedArt(cacheKey, size), readCachedArt(cacheKey, size === 'thumb' ? 'full' : 'thumb')]
      .find((entry) => entry?.monsterId === monsterId && entry.src !== rejectedSrc)
    : null;
  if (cached && monsterId != null && cached.monsterId === monsterId && await portraitLoads(cached.src)) {
    const fullCached = readCachedArt(cacheKey, 'full');
    const thumbCached = readCachedArt(cacheKey, 'thumb');
    return {
      monsterId,
      fullSrc: size === 'full' ? cached.src : fullCached?.monsterId === monsterId && fullCached.src !== rejectedSrc ? fullCached.src : cached.src,
      thumbSrc: size === 'thumb' ? cached.src : thumbCached?.monsterId === monsterId && thumbCached.src !== rejectedSrc ? thumbCached.src : cached.src,
    };
  }
  return null;
}
