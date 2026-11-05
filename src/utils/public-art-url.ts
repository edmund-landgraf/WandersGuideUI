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

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;

export function publicAssetOrigin(): string {
  const configured = String(import.meta.env.VITE_PUBLIC_ASSET_ORIGIN ?? '')
    .trim()
    .replace(/\/$/, '');
  return configured || DEFAULT_PUBLIC_ASSET_ORIGIN;
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
export function publicArtSrc(value: string | null | undefined, origin = publicAssetOrigin()): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || !isSiteRelativeArtPath(trimmed)) return trimmed;
  const base = origin.trim().replace(/\/$/, '') || DEFAULT_PUBLIC_ASSET_ORIGIN;
  try {
    const url = new URL(trimmed, `${base}/`);
    if (url.origin !== new URL(base).origin) return trimmed;
    return url.toString();
  } catch {
    return trimmed;
  }
}
