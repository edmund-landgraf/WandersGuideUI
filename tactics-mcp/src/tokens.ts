import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type McpTokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  label: string;
  scopes: string[];
  resourceAllowlist: string[] | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

const rows = new Map<string, McpTokenRow>();

export function resetTokens() {
  rows.clear();
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashesEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function normalizeScopes(scopes: unknown): string[] {
  if (scopes == null) return ["read"];
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string") || scopes.length === 0) {
    throw new Error("EMPTY_SCOPES");
  }
  return scopes as string[];
}

export function mintToken(input: { userId: string; label?: string; scopes?: unknown; expiresAt?: string | null; resourceAllowlist?: string[] | null }) {
  const scopes = normalizeScopes(input.scopes);
  const id = randomBytes(16).toString("hex");
  const secret = `wgui_${randomBytes(32).toString("base64url")}`;
  const row: McpTokenRow = {
    id,
    userId: input.userId,
    tokenHash: hashToken(secret),
    label: input.label?.trim() || "MCP token",
    scopes,
    resourceAllowlist: input.resourceAllowlist ?? null,
    lastUsedAt: null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
  };
  rows.set(id, row);
  return { token: secret, row: publicRow(row) };
}

export function listTokens(userId: string) {
  return [...rows.values()].filter((row) => row.userId === userId).map(publicRow);
}

export function revokeToken(userId: string, id: string) {
  const row = rows.get(id);
  if (!row || row.userId !== userId) return false;
  row.revokedAt = new Date().toISOString();
  return true;
}

export function resolveBearer(secret: string): McpTokenRow | null {
  const hash = hashToken(secret);
  for (const row of rows.values()) {
    if (!hashesEqual(row.tokenHash, hash)) continue;
    if (row.revokedAt) return null;
    if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now()) return null;
    row.lastUsedAt = new Date().toISOString();
    return row;
  }
  return null;
}

function publicRow(row: McpTokenRow) {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    scopes: row.scopes,
    resourceAllowlist: row.resourceAllowlist,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}
