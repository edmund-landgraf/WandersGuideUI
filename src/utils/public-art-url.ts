/**
 * Site-relative portrait and background files such as `/portraits/thalanis-reed.jpg`
 * are static files on the public Wanderer's Guide host. amba serves the SPA for
 * those paths, so an `<img>` there never receives the JPEG.
 *
 * Set `VITE_PUBLIC_ASSET_ORIGIN` (no trailing slash) when that host is not the
 * default. The MCP server reads the same value from `PUBLIC_ASSET_ORIGIN` or
 * `VITE_PUBLIC_ASSET_ORIGIN`. Both default to `https://wgui.wandersguide.site`.
 */
export const DEFAULT_PUBLIC_ASSET_ORIGIN = 'https://wgui.wandersguide.site';
/** Public Supabase/Kong origin for `/storage/v1/object/...`. Static files stay on the asset host. */
export const DEFAULT_PUBLIC_STORAGE_ORIGIN = 'https://amba.wandersguide.site';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
const STORAGE_OBJECT = /\/storage\/v1\/object\//i;

export function publicAssetOrigin(): string {
  const configured = String(import.meta.env?.VITE_PUBLIC_ASSET_ORIGIN ?? (typeof process !== 'undefined' ? process.env.VITE_PUBLIC_ASSET_ORIGIN : undefined) ?? '')
    .trim()
    .replace(/\/$/, '');
  return configured || DEFAULT_PUBLIC_ASSET_ORIGIN;
}

export function publicStorageOrigin(): string {
  const configured = String(import.meta.env?.VITE_PUBLIC_STORAGE_ORIGIN ?? (typeof process !== 'undefined' ? process.env.VITE_PUBLIC_STORAGE_ORIGIN : undefined) ?? '')
    .trim()
    .replace(/\/$/, '');
  return configured || DEFAULT_PUBLIC_STORAGE_ORIGIN;
}

export function internalStorageHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost') return false;
  if (host === 'host.docker.internal' || host.endsWith('.docker.internal')) return true;
  return !host.includes('.');
}

export function publicStorageObjectUrl(value: string, origin = publicStorageOrigin()): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !STORAGE_OBJECT.test(url.pathname)) return trimmed;
  if (!internalStorageHost(url.hostname)) return trimmed;
  const base = origin.trim().replace(/\/$/, '') || DEFAULT_PUBLIC_STORAGE_ORIGIN;
  return `${base}${url.pathname}${url.search}${url.hash}`;
}

/** Path the portrait and campaign pickers may store, rooted at `/` on the public host. */
export function isSiteRelativeArtPath(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\') || trimmed.includes('..')) return false;
  let pathname = trimmed;
  try {
    pathname = new URL(trimmed, 'https://assets.invalid').pathname;
  } catch {
    return false;
  }
  return pathname.startsWith('/portraits/') || pathname.startsWith('/backgrounds/') || IMAGE_EXT.test(pathname);
}

export function artUploadCategory(value: string): 'portraits' | 'backgrounds' {
  return value.includes('/backgrounds/') ? 'backgrounds' : 'portraits';
}

/** Absolute http(s) URL for display and for writes. Leaves other values unchanged. */
export function publicArtSrc(
  value: string | null | undefined,
  origin = publicAssetOrigin(),
  storageOrigin = publicStorageOrigin(),
): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return trimmed;
  const storage = publicStorageObjectUrl(trimmed, storageOrigin);
  if (storage !== trimmed) return storage;
  if (!isSiteRelativeArtPath(trimmed)) return trimmed;
  const base = origin.trim().replace(/\/$/, '') || DEFAULT_PUBLIC_ASSET_ORIGIN;
  try {
    const url = new URL(trimmed, `${base}/`);
    if (url.origin !== new URL(base).origin) return trimmed;
    return url.toString();
  } catch {
    return trimmed;
  }
}
