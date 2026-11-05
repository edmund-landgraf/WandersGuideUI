// Site-relative /portraits and /backgrounds files are served by the public web
// host (Apache on wgui), not by the amba SPA. PUBLIC_ASSET_ORIGIN or
// VITE_PUBLIC_ASSET_ORIGIN overrides the host. No trailing slash.
export const DEFAULT_PUBLIC_ASSET_ORIGIN = "https://wgui.wandersguide.site";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;

export function publicAssetOrigin(): string {
  const configured = (process.env.PUBLIC_ASSET_ORIGIN || process.env.VITE_PUBLIC_ASSET_ORIGIN || "").trim().replace(/\/$/, "");
  return configured || DEFAULT_PUBLIC_ASSET_ORIGIN;
}

export function isSiteRelativeArtPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\") || trimmed.includes("..")) return false;
  let pathname = trimmed;
  try {
    pathname = new URL(trimmed, "https://assets.invalid").pathname;
  } catch {
    return false;
  }
  return pathname.startsWith("/portraits/") || pathname.startsWith("/backgrounds/") || IMAGE_EXT.test(pathname);
}

export function publicArtSrc(value: string, origin = publicAssetOrigin()): string {
  const trimmed = value.trim();
  if (!isSiteRelativeArtPath(trimmed)) return trimmed;
  const base = origin.trim().replace(/\/$/, "") || DEFAULT_PUBLIC_ASSET_ORIGIN;
  try {
    const url = new URL(trimmed, `${base}/`);
    if (url.origin !== new URL(base).origin) return trimmed;
    return url.toString();
  } catch {
    return trimmed;
  }
}
