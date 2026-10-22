# ADR: OAuth for the WGUI tactics MCP

**Status:** Accepted for the first build. Stage 5 (public `/mcp` and the ChatGPT connector) is out of this build.

## Closed choices

- Human login for ChatGPT is Supabase (`SUPABASE_URL` and `SUPABASE_ANON_KEY`): Google, GitHub, Discord, or email and password, the same choices as the campaign UI. `GET /oauth/mcp/authorize` shows that choice, then sends the browser to GoTrue. The token endpoint still accepts only the code and PKCE verifier. ChatGPT never receives the provider token. `MCP_PUBLIC_ORIGIN` is the issuer ChatGPT and GoTrue redirect to, and that origin must be on the GoTrue redirect allow-list.
- Tokens are stored as a SHA-256 hash. No pepper until a hashing scheme is chosen.
- Account-settings mint and the OAuth token endpoint create the same row.
- Consent may use a Supabase access token to learn who is asking and returns a short-lived code. The token endpoint accepts that code and a PKCE S256 verifier. It does not read a session.
- Scopes are `read` and `write`. An omitted scope list is stored as `["read"]`. An empty list, or any scope other than those two, is rejected. `read` covers the twenty lookup tools. `write` covers `ensure_public_user`, `join_campaign`, and `patch_encounter_dice`. The token endpoint grants the scopes stored on the authorization code, which are the scopes the client sent to authorize. Discovery lists both. A token is not upgraded later.
- CIMD and dynamic client registration are not advertised.

## Migration

Tokens minted before the split store `["read"]`. They still call the lookup tools. They do not gain `write`, so those three tools return `AUTH_REQUIRED` until the client authorizes again with `scope=read write` (or a settings mint that passes both scopes). Clients that keep sending only `read`, or omit scope, stay read-only. ChatGPT's connector `baseScopes` and the Grokbot setup request both scopes; an existing ChatGPT or Grokbot grant keeps working for reads and picks up `write` on the next sign-in.

## Fences

1. If a bearer is present on `/mcp`, it is the only identity. Malformed, unknown, expired, or revoked rejects the call. There is no cookie fallback.
2. The token endpoint does not read a session.
3. Scope is looked up from the resolved tool name before the handler runs.
4. Encounter tools require `view: "gm"` on the input schema. The SDK rejects anything else before the handler. Handlers do not call `playerVisibleCombatants`.
