// Distinguishes a GoTrue session from the JWT the MCP server mints, and from the
// session-less JWT stock helpers.connect() mints for an API key.
// No imports: Node tests and the Deno edge runtime both load this file.

export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function hasSessionId(token: string): boolean {
  const sessionId = jwtPayload(token)?.session_id;
  return typeof sessionId === 'string' && sessionId !== '';
}

/** Set only by tactics-mcp when it signs a user JWT with JWT_SECRET. API-key minting does not set this. */
export function hasMcpServerClaim(token: string): boolean {
  return jwtPayload(token)?.wgui_mcp === true;
}

export function callerTokenKind(token: string): 'session' | 'mcp' | 'rejected' {
  if (hasSessionId(token)) return 'session';
  if (hasMcpServerClaim(token)) return 'mcp';
  return 'rejected';
}
