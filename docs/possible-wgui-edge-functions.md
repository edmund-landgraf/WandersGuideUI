# Possible WGUI edge functions

Named overlay routes (`wgui-ext-*` or `wgui-export-*`) that authorize campaign membership, then read or write with the service-role client. Stock `find-*`, `create-encounter`, `update-character`, and RLS stay unchanged.

See [quzzar-player-combat-edge-functions.md](./quzzar-player-combat-edge-functions.md), [quzzar-export-and-dice-edge-functions.md](./quzzar-export-and-dice-edge-functions.md), and [campaign-encounter-ui-redesign.md](./campaign-encounter-ui-redesign.md). Player hiding of enemy HP and names stays in the React tree ([player-combat-view.md](./player-combat-view.md)).

Own-PC HP, stamina, and spells stay on stock `update-character`. GM full-row encounter saves stay on stock `create-encounter`. Those are not new functions.

Checked against `D:\repos\wanderers-guide\supabase\functions` and that repo’s `[functions.*]` in `config.toml`. None of these slugs exist there.

| Function | In OG stack | Closest stock route |
| --- | --- | --- |
| `wgui-ext-ensure-public-user` | No | none (`create-campaign` / `create-character` assume `public_user` already exists) |
| `wgui-ext-join-campaign` | No | `find-campaign` + `update-character` |
| `wgui-ext-find-encounter` | No | `find-encounter` (owner JWT / owner RLS) |
| `wgui-ext-find-campaign-characters` | No | `find-character` (self / owner, not fellow players) |
| `wgui-ext-patch-encounter-dice` | No | `create-encounter` (full-row owner write) |
| `wgui-export-character` | No | none (browser compile in the original frontend) |
| `wgui-ext-patch-encounter-combatant` | No | `create-encounter` |
| `wgui-ext-add-encounter-character` | No | `create-encounter` |
| `wgui-ext-remove-encounter-character` | No | `create-encounter` |
| `wgui-ext-set-encounter-reveal` | No | none |
| `wgui-ext-patch-creature-spells` | No | `create-encounter` |
| `wgui-ext-roll-initiative` | No | none (client-side in the original UI) |
| `wgui-ext-group-check` | No | none |
| `wgui-ext-patch-campaign-notes` | No | campaign owner update (no named notes function) |
| `wgui-ext-find-campaign-notes` | No | `find-campaign` |
| `wgui-export-encounter` | No | none |

## Shipped

Already in `supabase/wgui-ext/` and `supabase/wgui-export/`.

| Function | Reason |
| --- | --- |
| `wgui-ext-ensure-public-user` | Auth can create a session with no `public_user` row. `create-campaign` / `create-character` then fail with “User not found”. REST insert on `public_user` was revoked; this inserts the same default the Auth trigger would have. |
| `wgui-ext-join-campaign` | Stock join is `find-campaign({ join_key })` then `update-character({ campaign_id })`. The membership trigger only keeps that write when a join grant exists; the grant upsert is best-effort, so the UI can report success while `campaign_id` stays null. This checks the key and writes with the service role. |
| `wgui-ext-find-encounter` | Encounter SELECT is owner-only. Stock `find-encounter` returns `[]` for every player. This authorizes GM or a joined PC, then reads the full campaign encounter row. |
| `wgui-ext-find-campaign-characters` | Character SELECT covers self, public, admin, and campaign owner — not fellow players. Stock `find-character({ campaign_id })` as a player returns only their own PCs, so allies would render from a stale `combatant.data` snapshot. |
| `wgui-ext-patch-encounter-dice` | Players already write the Phase 1 dice tray. Encounter UPDATE is owner-only, so they cannot use `create-encounter`. This updates only `dice_roll_state` / `dice_roll_log`; players may add or drop log rows they started. |
| `wgui-export-character` | Compile JSON v4 or PDF v2 for a character the caller can already read under RLS. Export work lives in Deno so the browser does not ship the compile bundle. |

## On the current path

Command writes from the redesign’s “Encounter command endpoint” that still have no slug. Same shape as dice: one narrow field or command, not a full-row replace.

| Function | Reason |
| --- | --- |
| `wgui-ext-patch-encounter-combatant` | Set initiative, HP, temp HP, and conditions on one combatant `_id` without replacing the encounter. GM for any row; a player only for their own PC if that state lives on the encounter row rather than the character. |
| `wgui-ext-add-encounter-character` | GM adds a joined PC to an encounter. Full-row `create-encounter` must not become a player write path; a narrow add keeps two browsers from clobbering the whole list. |
| `wgui-ext-remove-encounter-character` | GM removes a PC the same way, without a full combatant-list replace. |
| `wgui-ext-set-encounter-reveal` | GM sets per-combatant `revealed` (later a visibility enum for Recall Knowledge). Players still receive the full row today; this only matters if reveal is later enforced on the server. |
| `wgui-ext-patch-creature-spells` | Spend or reset spell slots, innate uses, and focus points on one creature instance. Catalog spell objects must not be shared across duplicate combatants. |
| `wgui-ext-roll-initiative` | Server roll for empty or all initiative values, append an immutable log row, optimistic revision so two browsers cannot silently overwrite each other. |
| `wgui-ext-group-check` | Server-authoritative group roll (save, skill, flat, attack). The client tray and `wgui-ext-patch-encounter-dice` already cover Phase 1; this is the redesign’s preferred replacement, not a second client write. |

## Adjacent

Only if those features leave the GM-only stock calls.

| Function | Reason |
| --- | --- |
| `wgui-ext-patch-campaign-notes` | Notes sit on the campaign row. Stock campaign update is owner-only. Needed if a player may edit a shared note. |
| `wgui-ext-find-campaign-notes` | Return only notes the sharing flag allows, if players must not receive the full campaign JSON. |
| `wgui-export-encounter` | Same compile pattern as `wgui-export-character`, if encounter PDF/JSON export is next. Nothing in the UI calls this yet. |

## Not on the path

| Idea | Reason |
| --- | --- |
| Redacted `find-encounter` (or a redacted copy written back) | Rejected in [player-combat-view.md](./player-combat-view.md). One payload, one component tree; player restriction is how Phase 1 draws. |
| Replacements for `update-character`, `create-encounter`, `create-campaign`, `reset-campaign-key`, `remove-from-campaign`, or content catalog reads | Those already work for the role that is allowed to call them. |
