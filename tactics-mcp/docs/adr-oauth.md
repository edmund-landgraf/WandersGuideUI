# ADR: OAuth for the WGUI read-only MCP

**Status:** Accepted for the first build. Stage 5 (public `/mcp` and the ChatGPT connector) is out of this build.

## Closed choices

- This process mints opaque tokens. Human login stays Supabase. ChatGPT does not receive a Google token, a password, or the Supabase session JWT.
- Tokens are stored as a SHA-256 hash. No pepper until a hashing scheme is chosen.
- Account-settings mint and the OAuth token endpoint create the same row.
- Consent may use a Supabase access token to learn who is asking and returns a short-lived code. The token endpoint accepts that code and a PKCE S256 verifier. It does not read a session.
- The only scope is `read`. An omitted scope list is stored as `["read"]`. An empty list is rejected.
- CIMD and dynamic client registration are not advertised.

## Fences

1. If a bearer is present on `/mcp`, it is the only identity. Malformed, unknown, expired, or revoked rejects the call. There is no cookie fallback.
2. The token endpoint does not read a session.
3. Scope is looked up from the resolved tool name before the handler runs.
4. Encounter tools require `view: "gm"` on the input schema. The SDK rejects anything else before the handler. Handlers do not call `playerVisibleCombatants`.
