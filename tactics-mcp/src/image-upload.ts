import { readFile } from "node:fs/promises";
import { characterFetch, invokeFunction } from "./character-client.js";
import { internalStorageHost, publicStorageObjectUrl, publicStorageOrigin } from "./public-art-url.js";

// upload-public-file rejects a base64 string longer than 3_000_000 characters
// (supabase/functions/upload-public-file in wanderers-guide, not this repo).
// 2 MiB of image data encodes under that cap.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_BASE64_CHARS = 3_000_000;

export type ImageCategory = "portraits" | "backgrounds";
export type ImageType = "png" | "jpeg" | "webp";

export function imageType(bytes: Uint8Array): ImageType | "svg" | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 512))).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.includes("<svg") || head.startsWith("<!doctype svg")) return "svg";
  return null;
}

export function decodeImageData(input: string): { ok: true; bytes: Uint8Array } | { ok: false; message: string } {
  let data = input.trim();
  const marker = data.toLowerCase().indexOf("base64,");
  if (data.toLowerCase().startsWith("data:") && marker !== -1) data = data.slice(marker + "base64,".length);
  data = data.replace(/\s/g, "");
  if (!data) return { ok: false, message: "Image data is empty." };
  if (data.length > MAX_BASE64_CHARS) return { ok: false, message: "Image is larger than 2 MB." };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, message: "Image data is not base64." };
  const bytes = Buffer.from(data, "base64");
  if (!bytes.byteLength) return { ok: false, message: "Image data is empty." };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, message: "Image is larger than 2 MB." };
  return { ok: true, bytes: new Uint8Array(bytes) };
}

function rejectedType(bytes: Uint8Array): { ok: true; type: ImageType } | { ok: false; message: string } {
  const type = imageType(bytes);
  if (type === "svg") return { ok: false, message: "SVG is not accepted. Use PNG, JPEG, or WebP." };
  if (!type) return { ok: false, message: "Image must be PNG, JPEG, or WebP." };
  return { ok: true, type };
}

function blockedHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0" || host === "::") return true;
  const ipv4 = host.startsWith("::ffff:") ? host.slice("::ffff:".length) : host;
  const parts = ipv4.split(".").map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  if (host.includes(":") && (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd"))) return true;
  return false;
}

function publicHttpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (blockedHost(url.hostname)) return null;
  return url;
}

async function readCapped(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > MAX_IMAGE_BYTES ? null : bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** A generated PNG, JPEG, or WebP on disk. http(s) URLs stay on fetchImageUrl. */
export async function readImageFile(filePath: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }> {
  const trimmed = filePath.trim();
  let path = trimmed;
  if (trimmed.toLowerCase().startsWith("file:")) {
    try {
      path = new URL(trimmed).pathname;
      if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
      path = decodeURIComponent(path);
    } catch {
      return { ok: false, message: "Image file path is not readable." };
    }
  }
  if (!path) return { ok: false, message: "Image file path is empty." };
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return { ok: false, message: "Image file could not be read." };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, message: "Image is larger than 2 MB." };
  if (!bytes.byteLength) return { ok: false, message: "Image data is empty." };
  return { ok: true, bytes: new Uint8Array(bytes) };
}

// Storage verification diagnostics go to stderr (stdout is the stdio MCP protocol).
// Never log query strings, fragments, credentials, request headers, image data,
// arbitrary upstream errors or non-public paths.
function diagnosticUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "[non-http URL]";
    const path = /^\/storage\/v1\/object\/public\/(?:portraits|backgrounds)\//i.test(url.pathname)
      ? url.pathname.slice(0, 1024) : "";
    return url.origin + path;
  } catch {
    return "[invalid URL]";
  }
}

type StorageDiagnostic = {
  originalUrl: string;
  rewrittenUrl: string;
  publicStorageOrigin: string;
  category?: ImageCategory;
  hops: Array<{ requestedUrl: string; finalUrl?: string; status?: number; contentType?: string; redirectUrl?: string }>;
  responseBody?: unknown;
};

// Untrusted error responses can reflect credentials or contain HTML. Read at
// most 4 KiB, for at most one second, and retain only known storage error
// labels/status fields. Unknown text is intentionally omitted, not logged raw.
async function storageErrorBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return { omitted: "no body" };
  const limit = 4096;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > limit) return { omitted: "body exceeds 4096 bytes" };
      chunks.push(step.value);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    const safeLabels = /^(?:bad request|invalid request|invalid input|invalid key|invalid object key|invalid url|invalid jwt|jwt expired|missing authorization header|object not found|bucket not found|resource not found|not found|unauthorized|forbidden|access denied|internal server error|no such key|no such bucket|InvalidKey|InvalidRequest|NoSuchKey|NoSuchBucket|AccessDenied|NotFound|Unauthorized|InvalidJWT|InvalidSignature|InvalidBucketName|MissingAuthorization|InvalidParameter|DatabaseError|StorageError|InvalidMimeType)\.?$/i;
    const fields: Record<string, string | number> = {};
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const key of ["statusCode", "status", "code", "error", "message"]) {
          const value = parsed[key];
          if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) fields[key] = value;
          else if (typeof value === "string" && (/^[1-5]\d{2}$/.test(value) || safeLabels.test(value.trim()))) fields[key] = value.trim();
        }
      }
    } catch {
      if (safeLabels.test(body.trim())) fields.message = body.trim();
    }
    return { bytes: total, fields, ...(Object.keys(fields).length === 0 ? { omitted: "unrecognized response body" } : {}) };
  };
  try {
    return await Promise.race([read(), new Promise(resolve => {
      timer = setTimeout(() => resolve({ omitted: "body read timed out" }), 1000);
    })]);
  } catch {
    return { omitted: "body read failed" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

function storageDiagnostic(original: string, rewritten: string, category?: ImageCategory): StorageDiagnostic {
  return { originalUrl: diagnosticUrl(original), rewrittenUrl: diagnosticUrl(rewritten),
    publicStorageOrigin: diagnosticUrl(publicStorageOrigin()), category, hops: [] };
}

function logStorageFailure(diagnostic: StorageDiagnostic, reason: string) {
  console.error("[wgui-mcp] storage-image-verification " + JSON.stringify({ ...diagnostic, reason }));
}

export async function fetchImageUrl(sourceUrl: string, diagnostic?: StorageDiagnostic): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }> {
  let current = sourceUrl.trim();
  for (let hop = 0; hop < 3; hop += 1) {
    const url = publicHttpUrl(current);
    if (!url) return { ok: false, message: "Image URL must be a public http(s) link." };
    const trace: StorageDiagnostic["hops"][number] = { requestedUrl: diagnosticUrl(url.toString()) };
    if (diagnostic) diagnostic.hops.push(trace);
    let response: Response;
    try {
      response = await characterFetch(url, { method: "GET", redirect: "manual" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not fetch the image.";
      return { ok: false, message };
    }
    if (diagnostic) {
      trace.status = response.status;
      trace.finalUrl = diagnosticUrl(response.url || url.toString());
      const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (mediaType && /^(?:application\/(?:json|problem\+json|octet-stream)|text\/(?:plain|html)|image\/(?:png|jpeg|webp|svg\+xml|gif))$/.test(mediaType)) trace.contentType = mediaType;
      else if (mediaType) trace.contentType = "[other]";
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, message: "Image URL redirected without a location." };
      current = new URL(location, url).toString();
      if (diagnostic) trace.redirectUrl = diagnosticUrl(current);
      continue;
    }
    if (!response.ok) {
      if (diagnostic) diagnostic.responseBody = await storageErrorBody(response);
      return { ok: false, message: `Image URL returned ${response.status}.` };
    }
    const bytes = await readCapped(response);
    if (!bytes) return { ok: false, message: "Image is larger than 2 MB." };
    return { ok: true, bytes };
  }
  return { ok: false, message: "Image URL redirected too many times." };
}

/** Download a ChatGPT-authorized attachment, never a server filesystem path.
 * Only HTTPS on OpenAI's file-serving domain is accepted; redirects are refused.
 * Do not propagate signed URLs or upstream exceptions in tool errors.
 */
export async function fetchImageAttachment(downloadUrl: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }> {
  let url: URL;
  try {
    url = new URL(downloadUrl);
  } catch {
    return { ok: false, message: "Attachment download URL is invalid." };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(host === "files.oaiusercontent.com" || host.endsWith(".oaiusercontent.com"))) {
    return { ok: false, message: "Attachment must use an authorized HTTPS file download URL." };
  }
  try {
    const response = await characterFetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      return { ok: false, message: "Attachment could not be downloaded. Select or attach the image again." };
    }
    const bytes = await readCapped(response);
    if (!bytes) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, message: "Image is larger than 2 MB." };
    }
    if (!bytes.byteLength) return { ok: false, message: "Image data is empty." };
    return { ok: true, bytes };
  } catch {
    return { ok: false, message: "Attachment download failed. Select or attach the image again." };
  }
}

export async function uploadImageBytes(userId: string, bytes: Uint8Array, category: ImageCategory) {
  const kind = rejectedType(bytes);
  if (!kind.ok) return { ok: false as const, code: "VALIDATION_ERROR", message: kind.message };
  const data = Buffer.from(bytes).toString("base64");
  if (data.length > MAX_BASE64_CHARS) return { ok: false as const, code: "VALIDATION_ERROR", message: "Image is larger than 2 MB." };
  const uploaded = await invokeFunction(userId, "upload-public-file", { data, category, type: kind.type });
  if (!uploaded.ok) return uploaded;
  const record = uploaded.data && typeof uploaded.data === "object" ? uploaded.data as { url?: unknown } : {};
  if (typeof record.url !== "string" || !record.url) {
    return { ok: false as const, code: "INTERNAL_ERROR", message: "upload-public-file did not return a url." };
  }
  const url = publicStorageObjectUrl(record.url);
  const durable = await durableImageUrl(url, storageDiagnostic(record.url, url, category));
  if (!durable.ok) return durable;
  return { ok: true as const, url: durable.url, type: kind.type, category };
}

export function isBlobUrl(value: string) {
  return value.trim().toLowerCase().startsWith("blob:");
}

function isStorageObjectUrl(value: string) {
  try {
    return /\/storage\/v1\/object\//i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

/** Storage object URLs must answer with PNG, JPEG, or WebP. Other http(s) URLs are left to the caller. */
export async function durableImageUrl(url: string, diagnostic = storageDiagnostic(url, url)): Promise<{ ok: true; url: string } | { ok: false; code: "VALIDATION_ERROR"; message: string }> {
  if (isBlobUrl(url)) return { ok: false, code: "VALIDATION_ERROR", message: "Temporary blob URLs cannot be stored." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: "VALIDATION_ERROR", message: "Art URL is not a public image link." };
  }
  if (internalStorageHost(parsed.hostname) && isStorageObjectUrl(url)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Image URL is an internal storage address and has no public origin." };
  }
  if (!isStorageObjectUrl(url)) return { ok: true, url };
  const fetched = await fetchImageUrl(url, diagnostic);
  if (!fetched.ok) {
    logStorageFailure(diagnostic, "storage-fetch-failed");
    return { ok: false, code: "VALIDATION_ERROR", message: fetched.message };
  }
  const kind = rejectedType(fetched.bytes);
  if (!kind.ok) {
    logStorageFailure(diagnostic, "storage-response-not-image");
    return { ok: false, code: "VALIDATION_ERROR", message: `Public storage URL is not an image. ${kind.message}` };
  }
  return { ok: true, url };
}
