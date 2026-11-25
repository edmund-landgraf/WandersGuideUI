import { phase1Request } from './phase1-api';
import { isSiteRelativeArtPath, publicArtSrc, publicAssetOrigin, publicStorageOrigin } from '@utils/public-art-url';

const MAX_BYTES = 2 * 1024 * 1024;
const STORAGE = '/storage/v1/object/';
const PUBLIC_STORAGE = STORAGE + 'public/';
const CATALOG = /^\/api\/(?:monsters|npcs|user-monsters)\/-?\d+\/image(?:\/thumb)?$/i;
type AssetAction = { kind: 'keep'; url: string } | { kind: 'upload'; url: string; category: 'portraits' | 'backgrounds' };

export function campaignCopyAssetAction(raw: string): AssetAction {
  const value = raw.trim();
  if (/^data:image\//i.test(value)) return { kind: 'keep', url: value };
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

type ReadImage = { bytes: Uint8Array; mime: string };
type CopyUpload = (bytes: Uint8Array, mime: string, category: 'portraits' | 'backgrounds') => Promise<string>;
type CopyAssetOptions = { accessToken?: string; fetchImage?: typeof fetch; upload?: CopyUpload };

function imageMatchesMime(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/png') return [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b);
  if (mime === 'image/jpeg') return [255,216,255].every((b,i) => bytes[i] === b);
  if (mime === 'image/webp') return [82,73,70,70].every((b,i) => bytes[i] === b) &&
    [87,69,66,80].every((b,i) => bytes[i+8] === b);
  return false;
}

async function readCopyImage(url: string, fetchImage: typeof fetch, label: string): Promise<ReadImage> {
  let response: Response;
  try {
    response = await fetchImage(url, {
      mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    });
  } catch {
    throw new Error(label + ' could not be fetched. Check network access and image CORS settings, then retry.');
  }
  if (!response.ok) throw new Error(label + ' is unavailable (HTTP ' + response.status + ').');
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
    throw new Error(label + ' must be PNG, JPEG, or WebP.');
  }
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error(label + ' exceeds the 2 MB upload limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error(label + ' has no readable body.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error(label + ' exceeds the 2 MB upload limit.');
      }
      chunks.push(new Uint8Array(next.value));
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!imageMatchesMime(bytes, mime)) throw new Error(label + ' is empty or does not match its image type.');
  return { bytes, mime };
}

async function uploadCopyImage(bytes: Uint8Array, mime: string, category: 'portraits' | 'backgrounds', accessToken?: string): Promise<string> {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i+8192));
  }
  // Use the same authenticated caller as the copy operation. Unlike makeRequest,
  // phase1Request preserves the actionable edge failure instead of returning null.
  const response = await phase1Request<{ url?: string }>('upload-public-file', {
    data: btoa(binary), category, type: mime.split('/')[1],
  }, accessToken);
  return typeof response?.url === 'string' ? response.url : '';
}

function storageObjectPath(url: URL): string {
  // Ignore queries, fragments and host aliases: they do not create new objects.
  try { return decodeURIComponent(url.pathname); } catch { throw new Error('Invalid artwork storage path.'); }
}

export async function migrateCampaignCopyAsset(raw: string, options: CopyAssetOptions = {}): Promise<string> {
  const action = campaignCopyAssetAction(raw);
  if (action.kind === 'keep') return action.url;
  const fetchImage = options.fetchImage ?? fetch;
  const source = await readCopyImage(action.url, fetchImage, 'Source artwork');
  const upload = options.upload ?? ((bytes, mime, category) => uploadCopyImage(bytes, mime, category, options.accessToken));
  const uploaded = await upload(source.bytes, source.mime, action.category);
  if (!uploaded) throw new Error('Artwork upload returned no URL. Retry the copy.');
  let targetUrl: URL;
  try {
    targetUrl = new URL(uploaded.startsWith(STORAGE) ? new URL(uploaded, publicStorageOrigin()).href : publicArtSrc(uploaded));
  } catch { throw new Error('Artwork upload returned an invalid URL.'); }
  const sourceUrl = new URL(action.url);
  if (!['https:', 'http:'].includes(targetUrl.protocol) || targetUrl.username || targetUrl.password ||
      targetUrl.origin !== new URL(publicStorageOrigin()).origin ||
      !targetUrl.pathname.startsWith(PUBLIC_STORAGE + action.category + '/') ||
      storageObjectPath(targetUrl) === storageObjectPath(sourceUrl)) {
    throw new Error('Artwork upload did not return a new object in the configured public storage.');
  }
  // A 200 from the uploader is not enough: anonymously read the new object and
  // compare its bytes, before storing it in the retry map or committing rows.
  const destination = await readCopyImage(targetUrl.href, fetchImage, 'Uploaded artwork');
  if (destination.mime !== source.mime || destination.bytes.length !== source.bytes.length ||
      destination.bytes.some((b,i) => b !== source.bytes[i])) {
    throw new Error('Uploaded artwork differs from the source image. Retry the copy.');
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
