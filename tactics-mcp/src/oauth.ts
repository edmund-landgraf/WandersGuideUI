import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { normalizeScopes } from "./tokens.js";

type CodeRow = {
  userId: string;
  clientId: string | null;
  challenge: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: number;
};

const CHATGPT_REDIRECT = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/;
const DEFAULT_GROKBOT_CLIENT = "grokbot-wgui";
const DEFAULT_GROKBOT_REDIRECT = "https://www.cursor.com/agents/mcp/oauth/callback";

export function grokbotClientId() {
  return process.env.GROKBOT_MCP_CLIENT_ID?.trim() || DEFAULT_GROKBOT_CLIENT;
}

function exactHttpsCallback(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
      url.hostname !== "localhost" && !url.hostname.endsWith(".localhost") && isIP(host) === 0;
  } catch {
    return false;
  }
}

/** Client and callback must both match the pre-registered Grokbot pair. */
export function allowedMcpRedirect(redirectUri: string, clientId: string) {
  if (clientId && clientId === grokbotClientId()) {
    const callback = process.env.GROKBOT_MCP_REDIRECT_URI?.trim() || DEFAULT_GROKBOT_REDIRECT;
    return redirectUri === callback && exactHttpsCallback(callback);
  }
  const chatgptId = process.env.CHATGPT_MCP_CLIENT_ID?.trim();
  return (!chatgptId || clientId === chatgptId) && CHATGPT_REDIRECT.test(redirectUri);
}

type PendingLogin = {
  state: string;
  clientId: string;
  challenge: string;
  redirectUri: string;
  scopes: string[];
  gotrueVerifier: string;
  expiresAt: number;
};

const pending = new Map<string, PendingLogin>();

export function rememberLogin(row: Omit<PendingLogin, "expiresAt" | "gotrueVerifier">) {
  const id = randomBytes(16).toString("base64url");
  const gotrueVerifier = randomBytes(32).toString("base64url");
  pending.set(id, { ...row, gotrueVerifier, expiresAt: Date.now() + 10 * 60_000 });
  return { id, gotrueVerifier };
}

export function gotrueChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function takeLogin(id: string) {
  const row = pending.get(id);
  if (!row) return null;
  pending.delete(id);
  if (row.expiresAt <= Date.now()) return null;
  return row;
}

const codes = new Map<string, CodeRow>();

export function resetCodes() {
  codes.clear();
}

export function issueCode(input: { userId: string; clientId?: string | null; codeChallenge: string; redirectUri: string; scopes?: unknown }) {
  const code = randomBytes(24).toString("base64url");
  codes.set(code, {
    userId: input.userId,
    clientId: input.clientId ?? null,
    challenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    scopes: normalizeScopes(input.scopes),
    expiresAt: Date.now() + 60_000,
  });
  return code;
}

/** Code and PKCE verifier in. Does not read a browser session. */
export function consumeCode(input: { code: string; verifier: string; redirectUri: string; clientId?: string | null }) {
  const row = codes.get(input.code);
  codes.delete(input.code);
  if (!row || row.expiresAt <= Date.now()) return null;
  if (row.clientId && input.clientId !== row.clientId) return null;
  if (row.redirectUri !== input.redirectUri) return null;
  const digest = createHash("sha256").update(input.verifier).digest("base64url");
  const left = Buffer.from(digest);
  const right = Buffer.from(row.challenge);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return { userId: row.userId, scopes: row.scopes };
}
