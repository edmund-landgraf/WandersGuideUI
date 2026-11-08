# Refactor: campaign page refetch on a Realtime broadcast

Date: 2026-11-06. Status: design only. Nothing in this file is implemented.

The campaign workspace polls on a fixed 4 second timer. Replace that with a small "this campaign changed" broadcast, then one refetch. Keep a slow safety poll for a dropped socket.

## The problem

`Phase1CampaignPage` in `src/pages/phase1/Phase1Workspace.tsx` sets `refetchInterval: 4000` on the roster query and the encounter query. The campaign row itself is also polled every 4 seconds for a player, so they see `meta_data.party_ids` after the GM changes it. A GM's own campaign query does not poll.

Each tick downloads whether or not anything changed. Observed on the local stack with two seats open at once (Chrome on `/phase1/campaign/57`, the Cursor browser on `/phase1/campaign/54/encounters/120`):

- `wgui-ext-find-campaign-characters` for the roster.
- `wgui-ext-find-encounter` for the campaign's fights. Campaign 57's response was about 100KB, backed by a raw `encounter` `select=*` of about 480KB.
- Stock `find-encounter` with only `user_id`, every tick, even after the extension already returned the campaign's fights. That call is `limit=5000` over every encounter the account owns (about 546KB raw for that user) and then filtered down to this campaign in the browser.
- Inside each function, `GET /auth/v1/user` took about 1.2–1.5 seconds, and campaign 57's `select=*` row was 353KB, read again on every call.

The clusters in the Kong log are those two tabs overlapping, not a tight infinite loop. The waste is the timer.

`loadPhase1CampaignEncounters` in `src/pages/phase1/phase1-api.ts` always merges the owner-wide `find-encounter({ user_id })` after `wgui-ext-find-encounter`. The comment says that scan is a fallback for an empty extension result (player filter, or a stack where `campaign_id` misses rows the owner query still has). It runs on the success path too. Stop calling it when the extension already returned this campaign's rows. That change is independent of Realtime and should land with it, because a broadcast refetch otherwise repeats the same double read.

## What to build

Subscribe, then refetch. Do not push encounter or character rows over the socket.

1. A Postgres trigger on `encounter`, `character`, and `campaign` broadcasts on a channel named for the campaign, for example `campaign:57`, with a payload of `{ table: "encounter" }` (or `character` or `campaign`). No row body.
2. `Phase1CampaignPage` joins that channel with the existing Supabase client (`src/supabase-client.ts`). The dev server already proxies `/realtime` to Kong (`vite.config.ts`).
3. On a message, debounce about 300ms and `invalidateQueries` for the encounters key, the players key, or the campaign key, matching `table`. The existing loaders stay the fetch: `loadPhase1CampaignEncounters`, `loadPhase1CampaignPlayers`, and `find-campaign`.
4. Drop `refetchInterval: 4000` on those three queries.
5. Keep a safety refetch of 30–60 seconds, and refetch once when the socket reconnects. Local Realtime drops events when the websocket blips. A missed message would otherwise leave the other seat stale until reload.

Dice and initiative saves write the encounter row often. The trigger will fire on each of those. The debounce is what keeps that from becoming the old poll. The seat that just rolled already patches its dice log in memory (`diceLogsRef` / `patchEncounterDice`); it does not need the broadcast to see its own roll.

## Why not `postgres_changes`

A `postgres_changes` subscription only delivers rows the caller's JWT can `SELECT`. Encounter policy is owner-only:

```sql
CREATE POLICY "Enable select, insert, update, and delete for owners only"
  ON public.encounter TO authenticated USING ((user_id = auth.uid()));
```

That is why players read fights through `wgui-ext-find-encounter` and the service role (`supabase/wgui-ext/wgui-ext-find-encounter/index.ts`). A player subscribed to the table would never see the GM's fight. The rows are also hundreds of kilobytes; every die roll would send the combatant blob down the socket. A broadcast of "campaign 57 changed" does not depend on that policy and does not carry the row.

## Leave alone

Do not change what the loaders return, the player visibility filter (`encounterListedForPlayer`), or the owner-only encounter policy. Realtime is a signal to refetch, not a second read path.

Do not stream `combatants`, `meta_data`, or the campaign row. The campaign row for 57 was already 353KB.

Standalone encounters (`/phase1/encounters/:id`, no campaign) stay on their current fetch. This channel is campaign-scoped. The extension already refuses an encounter read that has no `campaign_id`.

## Check

- Two browsers on one campaign. GM changes HP or adds a fight. The other seat updates without waiting 4 seconds, and Kong shows one refetch, not a repeating triple call.
- A die roll on the open encounter does not produce a refetch storm. Several writes inside the debounce window collapse to one invalidate.
- Disconnect the websocket. The other seat still catches up on the slow poll or on reconnect.
- A stack where the extension returns an empty list still merges `find-encounter({ user_id })`. A stack where it returned rows does not call that endpoint.
