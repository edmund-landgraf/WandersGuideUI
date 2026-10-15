import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

type CodeRow = {
  userId: string;
  challenge: string;
  redirectUri: string;
  expiresAt: number;
};

const codes = new Map<string, CodeRow>();

export function resetCodes() {
  codes.clear();
}

export function issueCode(input: { userId: string; codeChallenge: string; redirectUri: string }) {
  const code = randomBytes(24).toString("base64url");
  codes.set(code, {
    userId: input.userId,
    challenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    expiresAt: Date.now() + 60_000,
  });
  return code;
}

/** Code and PKCE verifier in. Does not read a browser session. */
export function consumeCode(input: { code: string; verifier: string; redirectUri: string }) {
  const row = codes.get(input.code);
  codes.delete(input.code);
  if (!row || row.expiresAt <= Date.now()) return null;
  if (row.redirectUri !== input.redirectUri) return null;
  const digest = createHash("sha256").update(input.verifier).digest("base64url");
  const left = Buffer.from(digest);
  const right = Buffer.from(row.challenge);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return row.userId;
}
