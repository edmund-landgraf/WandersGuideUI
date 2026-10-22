import { createHmac } from "node:crypto";

export type CharacterRow = Record<string, unknown>;

export type InvokeOk = { ok: true; data: unknown };
export type InvokeErr = { ok: false; code: string; message: string; data?: unknown };
export type InvokeResult = InvokeOk | InvokeErr;

type FetchFn = typeof fetch;

let fetchImpl: FetchFn = globalThis.fetch.bind(globalThis);

export function setCharacterFetch(next: FetchFn | null) {
  fetchImpl = next ?? globalThis.fetch.bind(globalThis);
}

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function functionsBaseUrl() {
  return (env("SUPABASE_URL") || "http://127.0.0.1:8000").replace(/\/$/, "");
}

function userJwt(userId: string, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 60 * 10,
  })).toString("base64url");
  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function characterToken(userId: string) {
  const explicit = env("WG_ACCESS_TOKEN");
  if (explicit) return explicit;
  const secret = env("JWT_SECRET") || env("SB_JWT_SECRET");
  if (secret && userId) return userJwt(userId, secret);
  return "";
}

export async function invokeFunction(userId: string, name: string, body: Record<string, unknown>): Promise<InvokeResult> {
  const token = characterToken(userId);
  if (!token) {
    return { ok: false, code: "AUTH_REQUIRED", message: "Character calls need WG_ACCESS_TOKEN or JWT_SECRET on the MCP server." };
  }
  const anon = env("SUPABASE_ANON_KEY") || token;
  let response: Response;
  try {
    response = await fetchImpl(`${functionsBaseUrl()}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Character function request failed.";
    return { ok: false, code: "INTERNAL_ERROR", message };
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, code: "INTERNAL_ERROR", message: `${name} returned non-JSON (${response.status}).` };
    }
  }
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (!response.ok || record.status === "error" || record.status === "fail") {
    const message = typeof record.message === "string" ? record.message : `${name} failed (${response.status}).`;
    return { ok: false, code: "FUNCTION_ERROR", message, data: record.data };
  }
  return { ok: true, data: record.data ?? payload };
}

export function asRow(data: unknown): CharacterRow | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as CharacterRow;
  if (record.__conflict || record.__forbidden) return null;
  if (typeof record.id !== "number" && typeof record.id !== "string") return null;
  return record;
}

export function guardOf(data: unknown): InvokeErr | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as CharacterRow;
  if (record.__forbidden) {
    return { ok: false, code: "CHARACTER_FORBIDDEN", message: "This character cannot be written.", data: record };
  }
  if (record.__conflict) {
    return { ok: false, code: "CONFLICT", message: "The character changed since it was read.", data: record };
  }
  return null;
}
