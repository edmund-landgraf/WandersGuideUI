import { createHmac, randomUUID } from "node:crypto";

export type CharacterRow = Record<string, unknown>;

export type InvokeOk = { ok: true; data: unknown };
export type InvokeErr = { ok: false; code: string; message: string; data?: unknown; retryable?: boolean; requestId?: string; saveOutcome?: "unknown" };
export type InvokeResult = InvokeOk | InvokeErr;

type FetchFn = typeof fetch;

let fetchImpl: FetchFn = globalThis.fetch.bind(globalThis);

export function setCharacterFetch(next: FetchFn | null) {
  fetchImpl = next ?? globalThis.fetch.bind(globalThis);
}

export function characterFetch(input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) {
  return fetchImpl(input, init);
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
    // Lets wgui-ext requireCallerId tell this server JWT from an API-key minted JWT.
    // Stock generateUserJWT does not set this claim. GoTrue still checks the signature.
    wgui_mcp: true,
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
  const requestId = randomUUID();
  const isSave = name === "update-character";
  let stage = "request";
  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(`${functionsBaseUrl()}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify(body),
    });
    // Headers can arrive successfully even if the response stream is reset.
    // Treat a lost response exactly like a transport failure; never replay a write.
    stage = "response-body";
    text = await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const cause = error instanceof Error ? error.cause : undefined;
    const causeCode = cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code) : "";
    const directCode = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    const code = [causeCode, directCode].find(value => /^(?:UND_ERR_[A-Z_]+|E[A-Z0-9_]{2,30})$/.test(value));
    const causeMessage = cause instanceof Error ? cause.message : "";
    const retryable = /fetch failed|timeout|terminated|abort|ECONNRESET|EAI_AGAIN|ENOTFOUND|UND_ERR/i.test(`${message} ${causeCode} ${directCode} ${causeMessage}`);
    // Never log or return arbitrary error text: it may contain URLs, credentials, or payloads.
    const diagnostic = code ? ` (${code})` : "";
    console.error(`[wgui-mcp] ${name} request=${requestId} stage=${stage} transport error${diagnostic}`);
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `${name} transport failed${diagnostic}; request ${requestId}.`,
      retryable,
      requestId,
      ...(isSave ? { saveOutcome: "unknown" as const } : {}),
    };
  }
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      console.error(`[wgui-mcp] ${name} request=${requestId} stage=response-json status=${response.status}`);
      return { ok: false, code: "INTERNAL_ERROR", message: `${name} returned non-JSON (${response.status}); request ${requestId}.`, retryable: response.status >= 500 || isSave, requestId, ...(isSave ? { saveOutcome: "unknown" as const } : {}) };
    }
  }
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (!response.ok || record.status === "error" || record.status === "fail") {
    const nested = record.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? record.data as Record<string, unknown>
      : {};
    const message = typeof record.message === "string"
      ? record.message
      : typeof nested.message === "string"
        ? nested.message
        : `${name} failed (${response.status}).`;
    const rawCode = typeof record.code === "string" ? record.code : typeof nested.code === "string" ? nested.code : "";
    return { ok: false, code: rawCode || "FUNCTION_ERROR", message, data: record.data, ...(isSave && response.status >= 500 ? { requestId, retryable: true, saveOutcome: "unknown" as const } : {}) };
  }
  const data = record.data ?? payload;
  if (isSave && !asRow(Array.isArray(data) ? data[0] : data) && !guardOf(data)) {
    console.error(`[wgui-mcp] ${name} request=${requestId} stage=save-receipt status=${response.status}`);
    return { ok: false, code: "INTERNAL_ERROR", message: `${name} returned no confirmed saved row; request ${requestId}.`, retryable: true, requestId, saveOutcome: "unknown" };
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
