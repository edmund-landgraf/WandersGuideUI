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

## Implementation order and gates

The next functions are not all equally ready. Implement them in this order:

1. patch-encounter-combatant, add-encounter-character, and remove-encounter-character. These directly support the redesign's Phase 2 and Phase 3 workflows.
2. roll-initiative. Define the initiative source, empty-versus-all reroll behavior, tie ordering, hidden-result behavior, immutable log shape, and optimistic revision before implementation.
3. patch-creature-spells. Define the per-instance resource shape and reset behavior first. Duplicate creature combatants must never share mutable catalog state.
4. group-check. Reuse authoritative PF2e modifier and degree-of-success calculations, then add target selection, result visibility, immutable history, and revision handling.
5. set-encounter-reveal only after the response contract is decided. The current Phase 1 product rule is one full encounter payload with player restrictions applied in the React tree. A reveal write has no security effect while hidden creature fields are still sent to players.

Every command function must:

- Authenticate the caller inside the handler; gateway JWT verification is not sufficient.
- Resolve campaign membership explicitly with the service client.
- Verify that the encounter belongs to the authorized campaign.
- Enforce the role and target ownership for that specific command.
- Update only the narrow field or command payload, never replace the full encounter row.
- Use idempotency where a retry could duplicate a combatant or log entry.
- Use optimistic concurrency for shared encounter state and return a conflict with the current revision instead of silently applying a stale write.
- Return a deliberately shaped response rather than a raw service-role row.

## Contract decisions

The current docs contain two incompatible visibility directions. player-combat-view.md and this document define Phase 1 as a full payload with enemy HP and names hidden in React. campaign-encounter-ui-redesign.md and wgui-integration-priorities.md describe server-side redaction and role-specific DTOs. The current path follows the former: do not add a redacted find-encounter or change RLS. If server-side reveal enforcement becomes a requirement, revise the read contract first and treat it as a separate security change.

Own-PC HP, stamina, and spells remain on stock update-character. GM full-row encounter saves remain on stock create-encounter. The new combatant command must not become a second path for those global character fields.

The client request registry should gain each new slug only when its handler and client caller land together. The current RequestTypeSchema contains the shipped overlay routes, not these candidates.

## Ownership and deployment

WGUI owns the overlay, client integration, and contract tests under supabase/wgui-ext. The production functions belong in wanderers-guide/supabase/functions, with matching config.toml entries. The overlay should remain usable as a compatibility path until the corresponding production function is deployed and verified.

No new function should modify stock find-encounter, find-character, create-encounter, update-character, campaign membership RLS, or content catalog reads.

## Implemented in the WGUI overlay

The first Phase 2/3 command set now exists under supabase/wgui-ext/:

- wgui-ext-patch-encounter-combatant patches one stored combatant by _id. It supports initiative and encounter-row HP, temp HP, and conditions for a GM. It does not write global character state.
- wgui-ext-add-encounter-character adds a joined campaign character with a fresh combatant _id. It rejects characters outside the campaign and duplicate assignment.
- wgui-ext-remove-encounter-character removes a CHARACTER combatant by _id. It rejects creature targets so the command cannot silently become a generic encounter delete.

All three authenticate in the handler, authorize campaign membership, verify encounter scope, require the campaign GM, and update only the combatants field plus its optimistic revision metadata. The integration coverage is in supabase/wgui-ext/_tests/encounter-command.test.ts, and the route names are registered in src/schemas/requests.ts.

These are overlay implementations for WGUI. They still need to be copied into wanderers-guide/supabase/functions, added to that repository's config.toml, and run through the production edge-function test and release checks before the overlay can be removed.
