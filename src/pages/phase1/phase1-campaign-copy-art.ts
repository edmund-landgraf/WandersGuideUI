import { uploadImage } from '@upload/image-upload';
import { isSiteRelativeArtPath, publicArtSrc, publicAssetOrigin, publicStorageOrigin } from '@utils/public-art-url';

const MAX_BYTES = 2 * 1024 * 1024;
const STORAGE = '/storage/v1/object/';
const PUBLIC_STORAGE = STORAGE + 'public/';
const CATALOG = /^\/api\/(?:monsters|npcs|user-monsters)\/-?\d+\/image(?:\/thumb)?$/i;
type AssetAction = { kind: 'keep'; url: string } | { kind: 'upload'; url: string; category: 'portraits' | 'backgrounds' };

export function campaignCopyAssetAction(raw: string): AssetAction {
  const value = raw.trim();
  if (CATALOG.test(value)) return { kind: 'keep', url: value };
  const relativeStorage = value.startsWith(STORAGE);
  const resolved = relativeStorage ? new URL(value, publicStorageOrigin()).href : publicArtSrc(value);
  let url: URL;
  try { url = new URL(resolved); } catch { throw new Error('Unsupported artwork reference.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Artwork must be an accessible HTTP(S) image.');
  }

  const assetOrigin = new URL(publicAssetOrigin()).origin;
  const storageOrigin = new URL(publicStorageOrigin()).origin;
  const storage = url.pathname.startsWith(STORAGE);
  const siteArt = isSiteRelativeArtPath(value) || (url.origin === assetOrigin && isSiteRelativeArtPath(url.pathname));
  if (!storage && !siteArt) return { kind: 'keep', url: value };
  if (storage && !url.pathname.startsWith(PUBLIC_STORAGE)) {
    throw new Error('Private or signed storage artwork must be made available for copying first.');
  }
  if (url.origin !== assetOrigin && url.origin !== storageOrigin &&
      url.origin !== 'https://api.wanderersguide.app') {
    throw new Error('Artwork storage origin is not configured for copying.');
  }
  return { kind: 'upload', url: url.href, category: /\/(?:backgrounds|maps)\//i.test(url.pathname) ? 'backgrounds' : 'portraits' };
}

export async function migrateCampaignCopyAsset(raw: string): Promise<string> {
  const action = campaignCopyAssetAction(raw);
  if (action.kind === 'keep') return action.url;
  const response = await fetch(action.url, {
    mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
  });
  if (!response.ok) throw new Error('Source artwork is unavailable (' + response.status + ').');
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
    throw new Error('Artwork must be PNG, JPEG, or WebP.');
  }
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Artwork exceeds the 2 MB upload limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Artwork response has no readable body.');
  const chunks: BlobPart[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Artwork exceeds the 2 MB upload limit.');
      }
      chunks.push(new Uint8Array(next.value));
    }
  } finally { reader.releaseLock(); }
  if (!total) throw new Error('Artwork is empty.');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const uploaded = await uploadImage(new File(chunks, 'campaign-copy.' + ext, { type: mime }), action.category);
  if (!uploaded) throw new Error('Artwork upload returned no URL.');
  const target = publicArtSrc(uploaded);
  const targetUrl = new URL(target);
  if (!['https:', 'http:'].includes(targetUrl.protocol) ||
      !targetUrl.pathname.startsWith(PUBLIC_STORAGE) || targetUrl.href === action.url) {
    throw new Error('Artwork upload did not return a new public storage object.');
  }
  return targetUrl.href;
}

export type CampaignCopyArtMap = Record<string, string>;

// Exact source strings are the SQL map keys. Cache successful entries even when
// a later asset fails, so retry does not create another copy of staged art.
export async function stageCampaignCopyAssets(
  refs: string[],
  staged: CampaignCopyArtMap,
  persist: () => void,
  migrate: (url: string) => Promise<string> = migrateCampaignCopyAsset,
): Promise<void> {
  const seen = [...new Set(refs)];
  for (let i = 0; i < seen.length; i++) {
    const ref = seen[i];
    if (Object.prototype.hasOwnProperty.call(staged, ref) && staged[ref]) continue;
    try {
      const target = await migrate(ref);
      if (!target) throw new Error('No destination artwork URL.');
      Object.defineProperty(staged, ref, { value: target, enumerable: true, configurable: true, writable: true });
      persist();
    } catch (error) {
      throw new Error('Campaign artwork ' + (i + 1) + ' of ' + seen.length + ' could not be copied: ' +
        (error instanceof Error ? error.message : 'Artwork transfer failed.'));
    }
  }
}
