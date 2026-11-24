// Site-relative /portraits and /backgrounds files are served by the public web
// host (Apache on wgui), not by the amba SPA. PUBLIC_ASSET_ORIGIN or
// VITE_PUBLIC_ASSET_ORIGIN overrides the host. No trailing slash.
export const DEFAULT_PUBLIC_ASSET_ORIGIN = "https://wgui.wandersguide.site";
// Kong's public-object URL (http://kong:8000/storage/v1/...) is not reachable
// from a browser. PUBLIC_STORAGE_ORIGIN is that API host, separate from the
// static file host above. No trailing slash.
export const DEFAULT_PUBLIC_STORAGE_ORIGIN = "https://amba.wandersguide.site";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
const STORAGE_OBJECT = /\/storage\/v1\/object\//i;

export function publicAssetOrigin(): string {
  const configured = (process.env.PUBLIC_ASSET_ORIGIN || process.env.VITE_PUBLIC_ASSET_ORIGIN || "").trim().replace(/\/$/, "");
  return configured || DEFAULT_PUBLIC_ASSET_ORIGIN;
}

export function publicStorageOrigin(): string {
  const configured = (process.env.PUBLIC_STORAGE_ORIGIN || process.env.VITE_PUBLIC_STORAGE_ORIGIN || "").trim().replace(/\/$/, "");
  return configured || DEFAULT_PUBLIC_STORAGE_ORIGIN;
}

/** Docker service names such as kong. localhost stays; a browser on the dev machine can open it. */
export function internalStorageHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost") return false;
  if (host === "host.docker.internal" || host.endsWith(".docker.internal")) return true;
  return !host.includes(".");
}

/**
 * Rewrites a Kong (or other single-label Docker) storage object URL onto the
 * public storage origin. Keeps the path, query, and hash. Other http(s) URLs,
 * including already-public storage hosts, are returned unchanged. blob: is unchanged.
 */
export function publicStorageObjectUrl(value: string, origin = publicStorageOrigin()): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !STORAGE_OBJECT.test(url.pathname)) return trimmed;
  if (!internalStorageHost(url.hostname)) return trimmed;
  const base = origin.trim().replace(/\/$/, "") || DEFAULT_PUBLIC_STORAGE_ORIGIN;
  return `${base}${url.pathname}${url.search}${url.hash}`;
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

export function publicArtSrc(value: string, origin = publicAssetOrigin(), storageOrigin = publicStorageOrigin()): string {
  const trimmed = value.trim();
  const storage = publicStorageObjectUrl(trimmed, storageOrigin);
  if (storage !== trimmed) return storage;
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
