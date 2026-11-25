import { isSiteRelativeArtPath, publicArtSrc, publicAssetOrigin, publicStorageOrigin } from '../../utils/public-art-url';

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

