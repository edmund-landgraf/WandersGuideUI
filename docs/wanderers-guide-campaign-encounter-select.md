# wgui-ext: campaign encounters the PC is on (Quzzar repo)

Shipped as **new** edge functions in [wanderers-guide](https://github.com/wanderers-guide/wanderers-guide) (`D:\repos\edmund-landgraf\wanderers-guide`). `find-encounter`, `create-encounter`, the owner-only `encounter` policy and the original Campaigns page are unchanged. Original WG keeps GM-owned encounters; WGUI gets a named extension.

Product: a joined player lists **encounters their PC is on** in a campaign and opens the **same** encounter workspace the GM uses (one React tree, no player-only grid), with the full encounter row. Own-PC temp HP stays on `update-character`.

## Why not patch `find-encounter` or encounter RLS

Owner policy in `data/schema.sql`:

```sql
CREATE POLICY "Enable select, insert, update, and delete for owners only"
  ON public.encounter TO authenticated USING ((user_id = auth.uid()));
```

`find-encounter` uses the **request JWT client** with `fetchData` on `encounter`, so it is an empty list for anyone who is not `encounter.user_id`.

Widening that policy would also open **PostgREST** (`GRANT ALL ON TABLE encounter TO authenticated`) and change the original `/campaigns` UI. `find-character` already refused a service-role campaign dump for the same reason (the IDOR comment in `find-character/index.ts`: membership is not "any authenticated `campaign_id` filter").

`find-campaign` is the template: `createServiceClient()` after `connect()` has identified the caller, then an **explicit** authorization check.

## What was added

`main/index.ts` loads `/home/deno/functions/${serviceName}` from a fixed absolute path, so a directory present there is a `/functions/v1/<name>` route with no router change. All of these live in **this** repo and are merged into that directory at container start; the wanderers-guide checkout stays clean, `config.toml` included. See the Deploying section of [player-encounter-visibility-change.md](player-encounter-visibility-change.md).

| Path (this repo) | Role |
| --- | --- |
| `supabase/wgui-ext/_wgui-ext/shared.ts` | Caller identity, campaign membership, combatant PC match |
| `supabase/wgui-ext/wgui-ext-find-encounter/index.ts` | Campaign encounters, filtered per role |
| `supabase/wgui-ext/wgui-ext-find-campaign-characters/index.ts` | Roster for the same `populateCombatants` path as the GM |
| `supabase/wgui-ext/_tests/wgui-ext.test.ts` | Deno tests, self-contained (seed helpers inlined) |
| `docker/wgui-ext.compose.yml`, `scripts/wgui-ext.mjs` | Compose override and launcher that inject the above |

No migration. The service role inside these two functions is the entire carve-out.

Three constraints found while building it:

- **`verify_jwt` is not load-bearing.** The self-hosted stack runs the edge runtime with `VERIFY_JWT: "false"` and kong's `functions-v1` route carries only the `cors` plugin (unlike `rest-v1`, which has `key-auth` + `acl`), so an anonymous POST reaches the handler. `requireCallerId` rejects it with a 401 itself.
- **`config.toml` only matters for a cloud deploy.** It is read by the Supabase CLI and `release.mjs`, never by the edge runtime, so self-hosted it is left untouched. If these are ever promoted into a real Supabase project, each needs a `[functions.<name>]` block: `createManifest()` in `scripts/release.mjs` throws `Cloud function needs an explicit enabled gateway policy: <name>` for any `<dir>/index.ts` without an explicit boolean. Function slugs are `^[a-z0-9-]+$` — an underscore (`wgui_ext`) is rejected.
- **`_shared/` was left alone entirely.** The extension owns `_wgui-ext/` instead of adding a file to their shared directory. Per `docs/releases.mdx` a shared-module change must redeploy every dependent; keeping a separate directory bounds the blast radius to these two endpoints and keeps their tree untouched. `../_shared/helpers.ts` and `../_shared/http-errors.ts` still resolve to their real modules inside the container.

## Membership (both functions)

Caller from `client.auth.getUser(token)`; a missing, rejected or anonymous token is a 401. Reads use `createServiceClient()`.

- **GM** if `campaign.user_id === caller.id`.
- **Player** if they own at least one `character` with `campaign_id = :campaignId`. The `enforce_character_campaign_membership()` trigger (migration `20260718120000`) guarantees that column was earned through a join grant, which is what makes it usable as membership — the join key is not re-checked here.

Neither is a 403, and a campaign that does not exist returns the same 403, so this cannot be used to probe campaign ids. Knowing a campaign id is never sufficient.

## `wgui-ext-find-encounter`

Body `{ campaign_id: number, id?: number | number[] }`. `campaign_id` is **required**: resolving it from the encounter row instead would let the row self-authorize.

1. Authorize the caller against `campaign_id`.
2. Load encounters with the admin client, then re-assert the campaign scope on the results.
3. **GM:** every row, same JSON as `find-encounter` (`Encounter[]` sorted by id).
4. **Player:** rows whose `combatants.list` includes a CHARACTER whose `character` (or numeric `data.id`) is one of the caller's character ids. Prep fights they are not on stay hidden.
5. **No redaction** either way — same creature payloads, initiative and meta_data. One view.

Standalone encounters (`campaign_id` null) stay on stock `find-encounter` and owner RLS.

## `wgui-ext-find-campaign-characters`

Required for an identical grid. `populateCombatants` joins `combatant.character` against the campaign roster, and character SELECT RLS is self, public, admin or **campaign owner** — not other players, so a player calling stock `find-character({ campaign_id })` sees only their own PCs and allies would render from a stale `combatant.data` snapshot.

Body `{ campaign_id }`, same gate, admin read of that campaign's characters, full rows. That is a deliberate privacy expansion over original WG and is what "no dual view" costs. To narrow it later, strip the same fields for the GM too so the view stays one shape.

## Own PC (temp HP)

No new write function. `update-character` plus the character UPDATE policy already allow `auth.uid() = character.user_id` for `hp_temp`, `hp_current` and `details`. The player inspector uses that narrow payload, never `create-encounter`.

Initiative, creatures and adding or removing PCs stay on `create-encounter` as the GM (user-scoped upsert, owner RLS).

## WGUI side

- Both names are in `src/schemas/requests.ts`.
- `loadPhase1CampaignEncounters` calls `wgui-ext-find-encounter` for every role and no longer needs the campaign owner id or the old owner-id fallback; it falls back to stock `find-encounter` so a stack started without the override degrades to an empty list instead of error-paging the GM.
- `loadPhase1CampaignPlayers` calls `wgui-ext-find-campaign-characters`, falling back to the stock `find-character` pair so the page still renders against a backend without the extension deployed.
- One `EncounterWorkspace` for both roles; `isGm` gates actions only.
- `visibleCampaignEncounters` is now redundant with the server filter and is kept as a client-side check.

## Tests

`supabase/wgui-ext/_tests/wgui-ext.test.ts` (run with `npm run test:wgui-ext`, which uses a throwaway Deno container on the stack network — no local Deno needed):

- GM JWT + `campaign_id` returns every campaign encounter.
- Player JWT whose PC is on the fight returns that encounter with the full combatant list.
- Player JWT whose PC is in the campaign but not on the fight omits it.
- A user with no character in the campaign gets 403; so does a nonexistent campaign; an `id` with no `campaign_id` gets 400.
- An unauthenticated caller gets 401, proving the gateway policy is not what protects it.
- Stock `find-encounter({ campaign_id })` as that player still returns `[]`, and stock `find-character({ campaign_id })` still returns only their own PC — the extension did not weaken RLS.

`e2e/player-joined-encounter.spec.ts` covers the browser path: a joined player lands on the GM's encounter URL, sees their PC among the combatants, does not see a prep fight, and receives a payload equal to the GM's row.
