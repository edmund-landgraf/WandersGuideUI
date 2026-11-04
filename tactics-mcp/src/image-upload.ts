import { characterFetch, invokeFunction } from "./character-client.js";

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

export async function fetchImageUrl(sourceUrl: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }> {
  let current = sourceUrl.trim();
  for (let hop = 0; hop < 3; hop += 1) {
    const url = publicHttpUrl(current);
    if (!url) return { ok: false, message: "Image URL must be a public http(s) link." };
    let response: Response;
    try {
      response = await characterFetch(url, { method: "GET", redirect: "manual" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not fetch the image.";
      return { ok: false, message };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, message: "Image URL redirected without a location." };
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) return { ok: false, message: `Image URL returned ${response.status}.` };
    const bytes = await readCapped(response);
    if (!bytes) return { ok: false, message: "Image is larger than 2 MB." };
    return { ok: true, bytes };
  }
  return { ok: false, message: "Image URL redirected too many times." };
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
  return { ok: true as const, url: record.url, type: kind.type, category };
}
