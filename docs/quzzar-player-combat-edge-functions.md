# Player combat viewing: four edge functions (for Quzzar)

This is an implementation brief for [wanderers-guide](https://github.com/wanderers-guide/wanderers-guide). Wanders Guide UI (WGUI) already calls these four routes. They currently live as an overlay in the WGUI repo (`supabase/wgui-ext/`) so your checkout stays clean. The request is to land them as first-class functions in **your** `supabase/functions/` tree so WGUI can drop the overlay.

**Do not change** `find-encounter`, `create-encounter`, `find-character`, `find-campaign`, `update-character`, or any RLS policy. Original WG stays GM-owned encounters and owner-only encounter SELECT. These are **new** named endpoints.

Reference implementation (copy freely): [`supabase/wgui-ext/`](../supabase/wgui-ext/) in [WandersGuideUI](https://github.com/edmund-landgraf/WandersGuideUI). Tests: `supabase/wgui-ext/_tests/wgui-ext.test.ts`.

## Product

A player who has joined a campaign with a PC can:

1. Exist as a `public_user` (so the GM can create the campaign at all).
2. Attach their character with the campaign join key (reliably).
3. List **encounters that PC is on** and open the **same** encounter workspace the GM uses (one payload, one React tree).
4. See live names/HP for **allied PCs** on that grid, not stale `combatant.data` snapshots.

Own-PC temp HP / current HP stays on stock `update-character`. Initiative, creatures, add/remove PCs stay on stock `create-encounter` (GM, owner RLS).

## Why new functions instead of patching stock ones

Encounter policy (`data/schema.sql`):

```sql
CREATE POLICY "Enable select, insert, update, and delete for owners only"
  ON public.encounter TO authenticated USING ((user_id = auth.uid()));
```

`find-encounter` uses the **request JWT** client with `fetchData` on `encounter`, so a player always gets `[]`. Widening that policy would also open PostgREST (`GRANT ALL ON TABLE encounter TO authenticated`) and change `/campaigns`.

`find-character({ campaign_id })` is self / public / admin / **campaign owner** — not fellow players. A player would render allies from the embedded combatant snapshot.

`find-campaign({ join_key })` then `update-character({ campaign_id })` is the stock join. The membership trigger only keeps the write when a `campaign_join_grant` exists; the grant upsert in `find-campaign` is **best-effort**, so the UI can report success while `campaign_id` stays null.

`create-campaign` looks up `public_user` and returns “User not found” when Auth created a session without that row (trigger missing or old accounts). REST insert on `public_user` was revoked.

Template for all four: **`find-campaign`** — `connect()`, identify the caller, then `createServiceClient()` and an **explicit** authorization check. Do not dump tables to any authenticated JWT.

## Names (must match WGUI)

Slugs are `^[a-z0-9-]+$`. Underscores are rejected by `release.mjs`. WGUI’s `RequestTypeSchema` already lists:

| Route | Role |
| --- | --- |
| `wgui-ext-ensure-public-user` | Backfill `public_user` for the signed-in caller |
| `wgui-ext-join-campaign` | Attach the caller’s character using the join key |
| `wgui-ext-find-encounter` | Campaign encounters, filtered per role |
| `wgui-ext-find-campaign-characters` | Full campaign roster for any member |

`main/index.ts` loads `/home/deno/functions/${serviceName}`; a directory with `index.ts` is a `/functions/v1/<name>` route with no router change.

For a **cloud** deploy, each needs `[functions.<name>]` with an explicit `enabled` boolean in `config.toml` (`createManifest()` throws otherwise). Self-hosted `VERIFY_JWT=false` plus kong `functions-v1` with only the `cors` plugin means an anonymous POST **reaches the handler**. Every function must reject missing/rejected/anonymous tokens itself (401). Gateway JWT verification is not load-bearing.

Prefer a dedicated helper directory (e.g. `_wgui-ext/`) rather than adding files to `_shared/` unless you want every dependent function redeployed (`docs/releases.mdx`). Imports of `../_shared/helpers.ts` and `../_shared/http-errors.ts` stay as they are.

No migration. The service-role client inside these handlers is the entire carve-out.

## Where this plugs into wanderers-guide

Checkout: `D:\repos\edmund-landgraf\wanderers-guide`. There is **no router table to edit**. Self-host dispatch is directory-based.

### How a request becomes a worker

Kong (`docker/kong.yml`) proxies `/functions/v1/` to `http://functions:9000/` with **only** the `cors` plugin (no `key-auth`, unlike `rest-v1`). Compose (`docker-compose.yml` `functions` service) bind-mounts `./supabase/functions` → `/home/deno/functions:ro`, `VERIFY_JWT: "false"`, and starts `--main-service /home/deno/functions/main`.

`supabase/functions/main/index.ts` takes the first path segment as `serviceName` and does `EdgeRuntime.userWorkers.create({ servicePath: '/home/deno/functions/${serviceName}' })`. A POST to `http://127.0.0.1:54321/functions/v1/wgui-ext-find-encounter` therefore loads `supabase/functions/wgui-ext-find-encounter/index.ts`. **Do not edit `main/index.ts`, `docker-compose.yml`, or `kong.yml`.**

Cloud deploy does not use `main` (`[functions.main] enabled = false` in `config.toml`; `release.mjs` refuses to ship the router). Cloud inventory is every `supabase/functions/<slug>/index.ts` that is not under `_tests/` or `main/`.

### Files to add

Copy from WGUI `supabase/wgui-ext/` into this tree:

```text
supabase/functions/
  _wgui-ext/shared.ts                          # new; do not add to _shared/
  wgui-ext-ensure-public-user/index.ts         # new
  wgui-ext-join-campaign/index.ts              # new
  wgui-ext-find-encounter/index.ts             # new
  wgui-ext-find-campaign-characters/index.ts   # new
  _tests/wgui-ext.test.ts                      # new; keep next to campaign-membership.test.ts
  import_map.json                              # unchanged; existing std/server + supabase-js aliases are enough
  _shared/helpers.ts                           # unchanged — import it, do not modify
  _shared/http-errors.ts                       # unchanged
  find-encounter/index.ts                      # unchanged (JWT + RLS → [] for players)
  find-character/index.ts                      # unchanged (the IDOR comment is why this exists)
  find-campaign/index.ts                       # unchanged; pattern to copy (admin client + explicit auth)
  create-campaign/index.ts                     # unchanged; still needs public_user via getPublicUser()
```

Handlers keep the same relative imports they have today (`../_shared/helpers.ts`, `../_wgui-ext/shared.ts`). Inside the container those paths resolve because the whole `supabase/functions` tree is the Deno root.

Do **not** put helpers in `_shared/`. `docs/releases.mdx` and `compareFunctions()` in `scripts/release.mjs` treat a shared-module byte change as invalidating **every** cloud function that imports it. `_wgui-ext/` is only a dependency of these four entry points.

Directory names must be the slugs above (`^[a-z0-9-]+$`). An underscore in the **function** slug (`wgui_ext-…`) fails the release inventory.

### `config.toml` (required for cloud, ignored by the local edge-runtime)

Append four blocks next to the existing `[functions.find-campaign]` / `[functions.find-encounter]` entries (~line 233). Match the campaign-read functions: **`verify_jwt = false`**, do not set `enabled = false`.

`createManifest()` in `scripts/release.mjs` throws `Cloud function needs an explicit enabled gateway policy: <name>` for any `<dir>/index.ts` whose policy is missing or `enabled === false`. It also throws `Config names an unknown cloud function` for a toml block with no directory — so add **both** the folder and the block.

`verify_jwt = false` matches `find-campaign`: the handler authenticates with `getUser(token)`. Setting `true` would only affect **cloud** gateway JWT checks; local compose still has `VERIFY_JWT=false`. Either way the handler must 401 anonymous callers itself.

### What you do *not* wire

| Location | Why leave it |
| --- | --- |
| `frontend/src/schemas/requests.ts` | Original Campaigns UI keeps calling `find-encounter` / `find-character`. WGUI has its own enum. Adding the names here is optional and unused by `EncountersPanel.tsx`. |
| `frontend/src/pages/campaign/panels/EncountersPanel.tsx` | Still GM-owned `find-encounter`. Player combat viewing is WGUI. |
| `data/schema.sql` / new migrations | No policy or table change. `campaign-membership.test.ts` must still pass: attach without grant stays dropped; stock join via `find-campaign` + client update still works. `wgui-ext-join-campaign` bypasses that trigger with the service role **after** key + ownership checks — that is intentional and separate. |
| `supabase/functions/_shared/*` | Avoid blast radius on cloud deploys. |
| `import_map.json` | No new npm specifiers. |

### Tests in this repo

Put Deno tests in `supabase/functions/_tests/wgui-ext.test.ts`. Reuse `callFunction`, `admin`, `ensureTestUser`, `stackUnavailable` from `_tests/seed.ts` (same helpers as `campaign-membership.test.ts` and `find-campaign.test.ts`). Run with the stack up:

```text
npm run docker:start
npm run test:api
```

That is `deno test --no-check … functions/_tests/` from `supabase/`. A new file in that folder is picked up automatically.

You do **not** have to extend `supabase/tests/api-boundaries.mjs` unless you want a fixture-level bundle of these handlers; that file is a hand-listed esbuild suite for existing endpoints.

After adding functions, **recreate** the `functions` container (`docker compose up -d --force-recreate functions`). The edge-runtime caches isolates; a bind-mount of new files on a live worker is not enough.

### Release / CI

Once the four `index.ts` files and `config.toml` blocks exist:

```text
npm run release:check
npm run release:manifest
```

The manifest will list the new slugs. Cloud verify (`release:verify`) will fail until those functions are actually deployed to the Supabase project — that is expected. `main` must remain `enabled = false`.

### Local vs WGUI overlay

If someone starts the stack from WGUI (`npm run stack:up`), compose merges a tmpfs over `/home/deno/functions` and copies **both** trees. After these land in wanderers-guide, a plain `npm run docker:start` in **this** repo is sufficient: WGUI’s overlay becomes redundant as long as slugs match.

## Shared authorization

Caller: `client.auth.getUser(token)`. Missing, rejected, or anonymous token → **401**.

Campaign membership (used by the two **find** functions):

- **GM** if `campaign.user_id === caller.id`.
- **Player** if they own at least one `character` with `campaign_id = :campaignId`. Migration `20260718120000` (`enforce_character_campaign_membership`) guarantees that column was earned through a join grant — do not re-check the join key here.

Unknown campaign id and “not a member” both return the **same 403** (`CAMPAIGN_FORBIDDEN`) so the endpoint cannot probe ids. Knowing a campaign id is never sufficient.

Never put `campaign.join_key` in a response unless the caller is the GM (the find functions should not return the campaign row at all).

Combatant PC match (player encounter filter): a `CHARACTER` combatant is the caller’s if `combatant.character` **or** `combatant.data.id` is one of their character ids. (`Combatant` is referenced in `_shared/content.d.ts` but not declared there; declare the match fields locally.)

---

### 1. `wgui-ext-ensure-public-user`

**Body:** `{}` (ignored).

**Auth:** signed-in user only (401 otherwise).

**Behavior:**

1. Service-role read `public_user` where `user_id = caller`.
2. If a row exists, return it (`200`, `{ status: 'success', data: PublicUser }`).
3. Else insert `{ user_id, display_name }` with the same defaults as `data/auth-trigger.sql` (display name from auth metadata, else email local-part, else `"Unknown User"`).
4. **Do not** `insert().select()`. After `public_user` grants were tightened, the write can succeed and the returning select fail. Insert, ignore unique violation `23505`, then re-read by `user_id`.
5. If still missing → **500** `PUBLIC_USER_CREATE_FAILED`.

WGUI calls this immediately before `create-campaign`. Idempotent; safe to call on every session.

---

### 2. `wgui-ext-join-campaign`

**Body:** `{ character_id: number, join_key: string }`.

**Errors:**

| Condition | Status | Code |
| --- | --- | --- |
| Missing `character_id` | 400 | `CHARACTER_ID_REQUIRED` |
| Empty join key | 400 | `JOIN_KEY_REQUIRED` |
| No campaign with that key | 400 | `JOIN_KEY_INVALID` |
| Character missing or `character.user_id !== caller` | 403 | `CHARACTER_FORBIDDEN` |
| Update did not persist `campaign_id` | 500 | `JOIN_NOT_SAVED` |

**Behavior:**

1. Resolve campaign by exact `join_key` (admin client).
2. Load character by id; must belong to the caller.
3. If `character.campaign_id` is already that campaign, skip the write (`already: true`).
4. Else service-role `update character set campaign_id = campaign.id` scoped to `id` **and** `user_id`.
5. Re-read the character; fail if `campaign_id` is not the campaign.
6. Return `{ character, campaign, already }` with **`join_key` stripped** from `campaign`.

This is what makes a PC appear on the GM’s Party bench. Being in the campaign is **not** being in a fight; the GM must still add the PC to `encounter.combatants.list`.

---

### 3. `wgui-ext-find-encounter`

**Body:** `{ campaign_id: number, id?: number | number[] }`. **`campaign_id` is required.** Never resolve campaign from the encounter row — that would let the row self-authorize.

**Errors:** missing `campaign_id` → **400** `CAMPAIGN_ID_REQUIRED`. Membership as above.

**Behavior:**

1. `authorizeCampaign(campaign_id)`.
2. Admin `fetchData` on `encounter` filtered by that `campaign_id` (and optional `id`s).
3. Re-assert `encounter.campaign_id === campaign_id` on results (`fetchData` drops undefined filters).
4. **GM:** every scoped row, same JSON as `find-encounter` (`Encounter[]` sorted by id).
5. **Player:** only rows whose `combatants.list` includes one of their character ids.
6. **No redaction.** Full combatant payloads, initiative, `meta_data`. One view. Prep fights the player is not on stay hidden by omission, not by stripping creatures inside a returned row.

Standalone encounters (`campaign_id` null) stay on stock `find-encounter`.

Stock `find-encounter({ campaign_id })` as that player must still return `[]` — tests should assert the extension did not weaken RLS.

---

### 4. `wgui-ext-find-campaign-characters`

**Body:** `{ campaign_id: number }` (required).

Same membership gate. Admin read of `character` where `campaign_id` matches. Return full rows sorted by id.

Required so `populateCombatants` can join `combatant.character` against the live roster. Without it, teammates render from stale `combatant.data`.

This is a deliberate privacy expansion over original WG (party members see each other’s full sheets). If you narrow fields later, strip the **same** fields for the GM so the view stays one shape.

Stock `find-character({ campaign_id })` as a player must still return only their own PCs.

---

## Response envelope

Same as the rest of the functions runtime: `{ status: 'success', data: ... }` or `connect()`’s fail mapping. WGUI uses `supabase.functions.invoke`; non-2xx becomes `Edge Function returned a non-2xx status code` unless the JSON includes a readable `message` — throw `HttpError` with a message, do not leak raw PostgREST objects.

## Tests (minimum)

Self-contained Deno tests against the running stack (WGUI uses a throwaway Deno container on the compose network; `npm run test:wgui-ext` in that repo). Cover:

- Anonymous POST to any of the four → **401**.
- `ensure-public-user`: creates a row; second call is a no-op; caller can then `create-campaign`.
- `join-campaign`: valid key attaches the caller’s character; wrong key 400; someone else’s character 403; response has no `join_key`.
- GM JWT + `campaign_id` on `find-encounter` → every campaign encounter.
- Player JWT whose PC is **on** the fight → that encounter, **full** combatant list.
- Player JWT whose PC is in the campaign but **not** on the fight → omitted.
- Non-member and nonexistent campaign → same **403**.
- `id` without `campaign_id` → **400**.
- `find-campaign-characters` as player → whole roster; as non-member → 403.
- Stock `find-encounter({ campaign_id })` as that player still `[]`.
- Stock `find-character({ campaign_id })` as that player still only their PC.

## WGUI after you ship

Once these exist in the wanderers-guide image, WGUI’s fallbacks (`find-encounter` / `find-character` / stock join) become unused for a current stack. Names must stay `wgui-ext-*` or WGUI needs a coordinated rename.

Frontend poll is ~4s; no Realtime required for v1.

## Out of scope

- Player writes to encounter JSON (`create-encounter` remains GM-only).
- Redacting hidden creatures (not in the current WGUI contract; adding it would fork the player payload).
- Changing original Campaigns UI.
- Encounter command/revision API (later; see `docs/campaign-encounter-ui-redesign.md` in WGUI).
