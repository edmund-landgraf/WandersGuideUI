# Key-scoped wgui-ext endpoints and the API-key hardening

## What changed

- `wgui-ext-list-key-characters` (new): the characters an API key may see.
- `wgui-ext-find-key-campaigns` (new): the campaigns those characters belong to (with names), or one campaign's visible characters.
- `_wgui-ext/key-auth.ts` (new): the caller resolution both use. It does not go through `helpers.connect()`, so it behaves the same with the stock upstream helpers and with the patched ones.
- `_wgui-ext/shared.ts` `requireCallerId`: now rejects JWTs without a `session_id` claim.

## Auth

`Authorization: Bearer <token>` plus the usual `apikey: <anon key>` header for Kong.

| token | result |
|---|---|
| 36-char API key | characters granted to that client in `details.api_clients.client_access` **and** owned by the key's user |
| user session JWT | the caller's own characters |
| none, the anon key, an unknown key, a malformed or self-signed JWT | 401 |
| `campaign_id` with no visible character in it (or no such campaign) | 403 |

## Request and response shapes

`POST /functions/v1/wgui-ext-list-key-characters` with `{}`:

```json
{ "status": "success", "data": [
  { "id": 63, "name": "Ernmpo", "level": 3, "class": "Alchemist", "ancestry": "Yaksha",
    "campaign_id": 41, "image_url": "https://...png", "updated_at": "2026-10-26T20:15:03.405549+00:00" }
] }
```

`POST /functions/v1/wgui-ext-find-key-campaigns` with `{}`:

```json
{ "status": "success", "data": { "campaigns": [ { "id": 41, "name": "Beutifula Soup", "character_ids": [63, 64] } ] } }
```

`POST /functions/v1/wgui-ext-find-key-campaigns` with `{ "campaign_id": 41 }`:

```json
{ "status": "success", "data": { "campaign": { "id": 41, "name": "Beutifula Soup" }, "characters": [ /* same rows as list-key-characters */ ] } }
```

Errors: `{ "status": "fail", "data": { "message": "...", "code": "AUTH_REQUIRED" | "INVALID_API_KEY" | "CAMPAIGN_FORBIDDEN" | "CAMPAIGN_ID_INVALID" } }`, and 5xx is `{ "status": "error", "message", "code" }`.

## Why the session_id check

The stock upstream `helpers.connect()` turns a 36-char API key into a self-signed owner JWT (`generateUserJWT`) before the handler runs. GoTrue `getUser()` accepts that token, so on a stack running the stock helpers, which includes prod today, any API key acted as a full owner session on every wgui-ext endpoint. That covers reads (campaign characters, notes, encounters, owner emails) and writes (join, notes, encounter patches). Real GoTrue session tokens carry `session_id` and the minted ones don't, so `requireCallerId` now refuses tokens without it. Signed-in app users are unaffected.

## Prod deploy notes (VPS Prod worker; not done yet)

1. Pull this branch on the prod WandersGuideUI checkout once it is merged.
2. Restart the functions container. The compose overlay copies `wgui-ext-*` and `_wgui-ext` into the tmpfs at start, so the new directories are picked up on restart and nothing else needs registering.
3. Smoke-test with a real key: list returns only granted PCs; no auth, the anon key and a bogus key return 401; a JWT minted from an API key returns 401 on, for example, `wgui-ext-find-campaign-characters`; a normal signed-in session still gets 200.
4. **Dependency warning:** `wgui-export/_wgui-export/connect-raw.ts` (on main since 79526fc) imports `../_shared/caller-auth.ts`. That file exists only in the unpushed wanderers-guide `security/function-auth` patch. On a prod stack without that patch, `wgui-export-character` will fail to boot. These new endpoints do **not** depend on it.
5. Gateway `VERIFY_JWT=true` would 401 API-key calls (an API key isn't a JWT) to these endpoints and to `wgui-export-character`. If it's turned on, exempt them per function, or keep `VERIFY_JWT=false` and rely on the in-function checks.