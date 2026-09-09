# Change record: remote players can see the encounters their PC is on

Date: 2026-09-08. Status: implemented and verified on the local docker stack.

Design rationale and the backend API contract live in
[wanderers-guide-campaign-encounter-select.md](wanderers-guide-campaign-encounter-select.md).
This file records what actually changed, what deliberately did not, and how to undo it.

## The problem

A remote player could open a campaign they had joined, but the Encounters rail always read
`0` and the workspace sat on "No encounter selected". The GM had to screen-share combat.

The cause is a single row-level security policy in `data/schema.sql`:

```sql
CREATE POLICY "Enable select, insert, update, and delete for owners only"
  ON public.encounter TO authenticated USING ((user_id = auth.uid()));
```

`find-encounter` runs `fetchData` on the caller's own JWT, so for anyone who is not
`encounter.user_id` it returns an empty list — always, silently, with HTTP 200. The
player's encounter screen was already built and working; it simply never received a row.

## What did NOT change

- Creating campaigns locally, including multiple campaigns on a Patreon tier.
- Assigning your own characters to your own campaigns.
- The join-key flow end to end: a second user signs in, picks a character, enters the key,
  `find-campaign({ join_key })` records the grant, `update-character` sets `campaign_id`,
  and the character appears in the GM's roster.
- Standalone (non-campaign) encounters, which still use `find-encounter({ user_id })`.
- `find-encounter`, `create-encounter`, and every RLS policy. A player calling stock
  `find-encounter({ campaign_id })` still gets `[]`; the test suite asserts this so nobody
  can later claim the extension weakened the database.

## Backend (in this repo, injected at runtime)

**Nothing lives in the wanderers-guide checkout.** Its `git status` is clean, `config.toml`
included. The endpoints live here and are mounted into the edge runtime at start:

- [supabase/wgui-ext/_wgui-ext/shared.ts](../supabase/wgui-ext/_wgui-ext/shared.ts) —
  caller identity, campaign membership, and combatant matching. It owns a whole directory
  rather than adding a file to their `_shared/`, which stays untouched and is still what
  `../_shared/helpers.ts` resolves to inside the container.
- [supabase/wgui-ext/wgui-ext-find-encounter/index.ts](../supabase/wgui-ext/wgui-ext-find-encounter/index.ts)
- [supabase/wgui-ext/wgui-ext-find-campaign-characters/index.ts](../supabase/wgui-ext/wgui-ext-find-campaign-characters/index.ts)
- [supabase/wgui-ext/_tests/wgui-ext.test.ts](../supabase/wgui-ext/_tests/wgui-ext.test.ts) —
  self-contained; the handful of helpers it used from their `_tests/seed.ts` are inlined.
- [docker/wgui-ext.compose.yml](../docker/wgui-ext.compose.yml) and
  [scripts/wgui-ext.mjs](../scripts/wgui-ext.mjs) — the injection, described under
  [Deploying](#deploying).

`config.toml` is read only by the Supabase CLI and `release.mjs`, never by the edge
runtime, so it is not needed while we self-host.

Both endpoints authorize the caller and then read with `createServiceClient()`, the same
pattern `find-campaign` uses. Authorization is:

- **GM** when `campaign.user_id` is the caller.
- **Player** when the caller owns at least one `character` with that `campaign_id`. The
  `enforce_character_campaign_membership()` trigger from migration `20260718120000`
  guarantees that column was earned through a join grant, which is what makes it safe to
  treat as membership.
- Anything else is 403, and a campaign that does not exist returns the same 403 so the
  endpoint cannot be used to probe for campaign ids.

`wgui-ext-find-encounter` requires `campaign_id` in the body. Resolving it from the
encounter row instead would let the row authorize itself. The GM receives every campaign
encounter; a player receives only those whose `combatants.list` contains one of their
characters, matched on `combatant.character` or `combatant.data.id`. Neither is redacted,
which is what "no dual view" means in practice.

`wgui-ext-find-campaign-characters` exists because character SELECT RLS covers self,
public, admin and campaign owner — not fellow players. Without it the player opens the
encounter but sees teammates rendered from the stale `combatant.data` snapshot instead of
live names and HP. It returns full rows, a deliberate privacy expansion over stock WG.

### Three constraints found while building it

- **`verify_jwt` protects nothing on a self-hosted stack.** `docker-compose.yml` sets
  `VERIFY_JWT: "false"` and kong's `functions-v1` route carries only the `cors` plugin,
  unlike `rest-v1` which has `key-auth` + `acl`. An anonymous POST reaches the handler, so
  `requireCallerId` rejects it with a 401 itself. A test asserts this.
- **A `config.toml` entry would be mandatory for a *cloud* deploy.** `createManifest()` in
  `scripts/release.mjs` throws `Cloud function needs an explicit enabled gateway policy:
  <name>` for any directory with an `index.ts` and no explicit boolean, and slugs must
  match `^[a-z0-9-]+$`, so an underscore (`wgui_ext`) is rejected. Self-hosted, none of
  that applies, which is why nothing is written to their `config.toml` any more.
- **`Combatant` is referenced at `_shared/content.d.ts:534` but never declared.** Tests run
  `--no-check` so it is latent. The combatant shape is declared locally in `shared.ts`.

## Frontend (this repo)

Three changes, all in the campaign read path.

- [src/schemas/requests.ts](../src/schemas/requests.ts): both endpoint names added to
  `RequestTypeSchema`.
- [src/pages/phase1/phase1-api.ts](../src/pages/phase1/phase1-api.ts):
  `loadPhase1CampaignEncounters` now calls `wgui-ext-find-encounter` and no longer takes a
  campaign-owner id or performs the old owner-id fallback lookup; it falls back to stock
  `find-encounter` when the extension is absent. `loadPhase1CampaignPlayers` calls
  `wgui-ext-find-campaign-characters`, falling back to the previous `find-character` pair
  on failure.
- [src/pages/phase1/Phase1Workspace.tsx](../src/pages/phase1/Phase1Workspace.tsx): the
  encounters query dropped its owner-id lookup, and the empty-state sentence is now
  role-aware ("None of your characters are in an encounter yet." for a player).

`visibleCampaignEncounters` is now redundant with the server-side filter and is kept as a
client-side check. One `EncounterWorkspace` still renders for both roles, with `isGm`
gating actions only.

Also removed: `supabase/migrations/20260908000000_encounter_select_campaign_members.sql`,
an earlier attempt to widen encounter RLS directly. It was superseded and did not belong
in this repo.

## Joining a campaign is not joining a fight

This caused real confusion during testing, so it is worth stating plainly.

A player who joins a campaign appears in the GM's **Party bench**, which is computed as
the campaign roster minus the current encounter's combatants:

```ts
const activeCharacterIds = new Set((selectedEncounter?.combatants.list ?? [])
  .filter((c) => c.type === 'CHARACTER').map((c) => c.character));
const benchPlayers = players.filter((player) => !activeCharacterIds.has(player.id));
```

While the PC is on the bench they are in the campaign but not in the fight, so the player
correctly sees zero encounters. The GM must drag them from the bench onto the combatant
grid. The player's view then picks it up on the next 4-second poll.

## Degrading without the extension

Both campaign reads catch and fall back to the stock endpoints, so a stack started without
the override still works: the GM sees their encounters and roster as before, and a player
sees an empty encounter list rather than a `PageError` for the whole workspace. That
matters more now than it did when the functions were resident in the image's mount — a
plain `docker compose up` in the wanderers-guide checkout is a realistic way to lose them.

The cost is that a genuine 403 from `wgui-ext-find-encounter` also falls through to
`find-encounter`, which returns `[]` for that caller. The user-visible result is the same
empty list either way.

## Verification

Backend, against the running stack:

```
npm run test:wgui-ext
```

That runs the tests in a throwaway Deno container on the stack's docker network, so no
local Deno install is needed. `supabase/wgui-ext/_tests/wgui-ext.test.ts` covers the GM seeing every encounter, a player seeing only fights
their PC is on with the full combatant list, a prep fight staying hidden, a non-member and
a nonexistent campaign both getting 403, an `id` without `campaign_id` getting 400, an
anonymous caller getting 401, and stock `find-encounter` / `find-character` still being
unchanged for that player.

Frontend: `npm run test` (66 unit tests) and `npx tsc --noEmit`.
`e2e/player-joined-encounter.spec.ts` covers the browser path.

Manually confirmed on 2026-09-08: a second user joined campaign 4 with Kharzug Ironbound,
the GM added him from the Party bench to "Random Encounter", and the encounter appeared in
the player's window with the GM's view.

## Deploying

The stack is started from here rather than from the wanderers-guide checkout:

```
npm run stack:up        # or stack:restart after changing a handler
```

[scripts/wgui-ext.mjs](../scripts/wgui-ext.mjs) runs `docker compose` with their
`docker-compose.yml` plus [docker/wgui-ext.compose.yml](../docker/wgui-ext.compose.yml) as
an override and `--project-directory` pointed at their checkout, so their relative paths
and `.env` still resolve. Set `WG_DIR` if that checkout is not `../wanderers-guide`. The
script exists rather than a documented command because the two dev boxes are Windows and
prod is Linux, and compose wants POSIX separators in a bind source either way.

The override does not bind the three directories straight into `/home/deno/functions`.
That was the obvious approach and it fails: the stack mounts that path read-only, and
Docker cannot create a nested mountpoint inside a read-only mount ("read-only file system"
at container init). Making the parent writable instead would have Docker create the empty
mountpoints in *their* checkout, dirtying its git status. So `/home/deno/functions` becomes
a small tmpfs that an entrypoint fills at start from two read-only mounts — their tree
first, ours second. Neither source is ever written to.

**Always restart, never just re-up.** The merge happens at container start and the edge
runtime caches isolates, so a running container keeps serving the previous module. Kong is
restarted alongside it: `up` can recreate a container, and kong holds keepalive connections
to the old address, which then 502s intermittently. Both of these produced false test
failures during development.

Rolling this out to the other Windows box and to amba: pull this repo, set `WG_DIR`, run
`stack:up`. On amba, whatever starts the stack today has to call the launcher instead, or
it comes back up without the extension — the one place this can silently regress, and what
the frontend fallback above is for.

For a cloud deploy these would have to be promoted into a real Supabase project with
`config.toml` entries; the name source is `node scripts/release.mjs function-names`. Note
that `release.mjs` currently fails on Windows for unrelated reasons: it matches source
paths with a `/`-separated regex against `path.relative` output, so every function looks
missing. Run it from a POSIX checkout.

## Rollback

Start the stack the original way (`docker compose up -d` from the wanderers-guide
checkout) and the endpoints are simply gone; the frontend falls back on its own. To remove
it entirely, delete `supabase/wgui-ext/`, `docker/wgui-ext.compose.yml`,
`scripts/wgui-ext.mjs` and the four npm scripts, and revert the three frontend files.
Their repo needs nothing undone, and no migration was applied, so there is no database
state to unwind.
