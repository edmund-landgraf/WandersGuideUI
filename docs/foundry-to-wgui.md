# Import Foundry PCs into Wanderer's Guide

**Status: design only. Nothing in this flow is built.** No upload item, no party-bench button, no `foundry_links` field, no transfer-owner action, and no module message handler exist in this repo. `src/process/upload/foundry-utils.ts` and `src/utils/foundry-text.ts` format Foundry content text. They are not this import.

Wanderer's Guide is where the user starts. A Foundry world is the source. Read a `character` actor and create or update the matching Wanderer's Guide character.

## Relationship to the Foundry → Wanderer's Guide importer

`edmund-landgraf/foundry-wanderersguide-import` is the other direction and a different product. That module already imports Wanderer's Guide JSON v4 **into** a Foundry actor (`scripts/dialog.js` title "Import from Wanderer's Guide"). Its rulebook for how a source path is classified is `scripts/coverage.js`. Match and apply live in `scripts/importer.js`. Class support there stays experimental (`docs/CLASS_COVERAGE.md` in that repo: a class stays experimental until WG-specific fixtures pass; the matrix does not assert present support).

Use that module as the classification rulebook for the reverse flow. Do not call it, do not reuse its dialog, and do not treat `flags.wanderersguide.wgLeftovers` as the store for this direction. The reverse flow writes Wanderer's Guide rows. The forward module writes Foundry actors. A user can run both. They do not share a button, a login, or a character id.

`scripts/coverage.js` statuses are written **onto the Foundry actor**. This design keeps the same five names and the same "every source path gets exactly one status" rule, with the write target flipped to the Wanderer's Guide character. See "Plan and review".

## Player import

The player is on the character workspace (`Phase1CharactersPage` in `src/pages/phase1/Phase1Workspace.tsx`, route `/phase1/characters`). The **Upload/Import** menu already has Import from JSON, Import from Pathbuilder, Import from GUIDECHAR, and Import from wanderersguide.app. Add **Import from Foundry** there.

1. The button opens Foundry's own login for the world address the player entered (`http://localhost:30000` for a local world). They sign in with their Foundry username and password. See "Auth handoff".
2. The module lists `character` actors that this Foundry user owns. Other players' characters are absent from the list.
3. The player ticks one or several rows. **Import selected** is disabled when none are ticked.
4. Each ticked actor is read one at a time, planned, reviewed, and written into **this Wanderer's Guide account**. See "Plan and review".
5. **Cancel** at any step writes nothing.

A Foundry user who is not a player still uses this button for the characters that account owns. The list is ownership, not a role name.

The existing Upload/Import button is disabled when this account is at `CHARACTER_SLOT_CAP` and the user lacks Patreon tier 2 (`hasPatreonAccess(..., 2)` in `Phase1CharactersPage`). Import from Foundry sits on that same button, so it inherits that client gate. Whether `create-character` enforces the cap on the server is still open (`docs/plans/admin-players-campaigns.md`). Do not bypass the disabled button.

Player import does not put the character on a campaign. Campaign membership is a separate `campaign_id` write. The party bench is a separate list.

## GM import

The GM is on the campaign screen, not the character screen. The campaign sidebar in `Phase1Workspace` shows **Party bench** whenever a campaign is open, for the game master and for a player. The game master is `campaign.user_id` equal to the signed-in auth id (`sameUserId` in `Phase1Workspace`). Add **Import party from Foundry** on that bench, visible only when the viewer is the game master.

1. The button opens Foundry's login for the world address. The GM signs in with their Foundry username and password.
2. The module checks that this Foundry user is a gamemaster of that world (`game.user.role`, gamemaster or assistant). A player login on this button shows an error and lists nothing.
3. The table lists every `character` actor in the world: checkbox, name, level, ancestry, class, Foundry actor id, and whether this campaign already has a character stored for that actor id plus world identity.
4. The GM ticks the rows, including all of them, and imports one at a time into **this campaign**.
5. Until a link exists, each new Wanderer's Guide character is owned by the GM's Wanderer's Guide account. Foundry's per-user ownership is stored with the leftovers (Foundry user id and name) and is not applied as a Wanderer's Guide owner. The later link, below, is what replaces this step. A name, email, or display name is never enough to pick an owner.
6. An empty party bench stays empty until **Import** is confirmed on the review step. Cancel writes nothing.

Putting a character on the bench is two existing writes, in this order:

1. The character's `campaign_id` is this campaign. `wgui-ext-patch-party` rejects any id whose `character.campaign_id` is not this campaign (`PARTY_ID_UNKNOWN` in `supabase/wgui-ext/wgui-ext-patch-party/index.ts`). Players join today with `update-character({ id, campaign_id })` (`src/pages/phase1/phase1-api.ts`).
2. Append that id to `campaign.meta_data.party_ids` through `wgui-ext-patch-party`. That call replaces `party_ids` and nothing else. Send the full next array. The GM can always call it. A player can call it only while `meta_data.settings.players_manage_party` is omitted or true.

## Auth handoff

The password is typed on a page served by the Foundry world. Wanderer's Guide's server never receives it. The Wanderer's Guide client never reads the password field.

1. Ask for the world origin only (`http://localhost:30000` or the hosted origin, no path, no credentials).
2. Open that origin in a new window (`window.open`). Foundry serves its own login. The module's client script runs only after the world has loaded, which is after that login succeeds.
3. The module posts to `window.opener` (see "Message channel"). The message carries the Foundry user id, display name, world id, and role. It does not carry a password, a session cookie, or a Foundry authorization header.
4. Wanderer's Guide accepts the message only when `event.origin` is the origin the user typed. The module accepts messages only from `window.opener` and only from the Wanderer's Guide origin that opened it.
5. Closing the window, a blocked popup, a world that never finishes loading, or a module that does not answer is a cancel. Write nothing. Show the failure on the status line.

Do not proxy the Foundry login through a Wanderer's Guide edge function. Do not ask the user to paste a Foundry password into this app.

## Message channel

`postMessage` between the Wanderer's Guide window and the Foundry window. No shared socket server. No Wanderer's Guide credential inside Foundry.

Every message is a JSON object with `source` and `type`. Ignore any message whose `source` is not one of the two values below.

Wanderer's Guide sends:

```ts
type WguiToFoundry =
  | { source: "wanderers-guide"; type: "list-actors"; mode: "owned" | "world" }
  | { source: "wanderers-guide"; type: "read-actor"; actorId: string };
```

`mode: "owned"` is the player button. `mode: "world"` is the GM button. On `world`, if the signed-in Foundry user is not a gamemaster, the module replies with `error` and no actors.

The module sends:

```ts
type FoundryToWgui =
  | {
      source: "wgui-foundry";
      type: "ready";
      worldId: string;
      userId: string;
      userName: string;
      role: string;
    }
  | { source: "wgui-foundry"; type: "actors"; actors: FoundryActorSummary[] }
  | { source: "wgui-foundry"; type: "actor"; actorId: string; document: FoundryActorRead }
  | { source: "wgui-foundry"; type: "error"; message: string };

type FoundryActorSummary = {
  actorId: string;
  name: string;
  level: number | null;
  ancestry: string | null;
  className: string | null;
  ownerUserIds: string[];
};

type FoundryActorRead = {
  actorId: string;
  name: string;
  ownership: Record<string, 0 | 1 | 2 | 3>;
  system: unknown;
  items: unknown[];
  flags: unknown;
};
```

`FoundryActorRead` is the actor document with biography and GM-only notes already removed by the module. Wanderer's Guide still records those paths as `dropped` (see "Plan and review") so the omission stays on the ledger. Do not put the raw biography text in the message.

Read one actor at a time, after the user has ticked it and the previous review has finished or been skipped by cancel. A `read-actor` for an id the module did not list is an `error`.

## Plan and review

Show the review as a dialog on the same screen that started the import. Follow the Pathbuilder overlay in `Phase1Workspace` (`fixed inset-0`): character workspace for the player button, campaign workspace for the GM button. One actor per dialog. Do not add a route.

The Foundry actor is the source of truth. Wanderer's Guide's builder does not fill a blank by derivation.

Every source path on the actor gets exactly one status, from what the plan actually consumed. The names and the "unexplained drop fails the plan" rule come from `scripts/coverage.js` in `foundry-wanderersguide-import`. The forward module's `mapped` means "written to the Foundry actor" and its leftover store is `flags.wgLeftovers`. Here the meanings are:

| Status | Meaning |
| --- | --- |
| mapped | Written onto the Wanderer's Guide character |
| included | Already represented by another mapped row, so no second copy |
| unresolved | A choice or a content match that is not exactly one legal Wanderer's Guide option. The builder asks. The importer does not pick the first option and does not invent an operation selection |
| leftover-preserved | Not interpreted. The raw value is copied verbatim onto the character as `foundryLeftovers` |
| dropped | Omitted, with a written reason (document metadata, a stat Wanderer's Guide recomputes, a duplicate). An unexplained drop fails the plan |

Match order onto Wanderer's Guide content is slug, then an unambiguous name. Several records for one name stay unresolved. A standard miss stays unresolved and is not copied as homebrew. A world item that is actually a custom item, with no compendium uuid, is the homebrew case. That is the same boundary as the forward importer's "no unambiguous compendium match; left unresolved (no homebrew copy created)" (`planImport` in `scripts/importer.js`). The forward module still creates a homebrew world item for a WG custom item (`custom-items.js`). Mirror that boundary: custom Foundry items with no compendium uuid are the homebrew case; a named compendium miss is unresolved.

Before any character write, the dialog shows the five counts, the unresolved list, and the leftover-preserved paths. **Import** is the only action that creates or updates. Re-import updates the linked Wanderer's Guide character (see "Linked round-trip"). A failed write leaves the previous character in place.

Biography and GM-only notes are omitted from the read. The omission is a `dropped` row with that reason.

After the run, the status line names the character or the failure. The ledger and `foundryLeftovers` stay on the character.

PF2e rule elements are not mapped onto Wanderer's Guide operation keys here. A path with no evidenced Wanderer's Guide target is unresolved or leftover-preserved. Class mechanics stay experimental for the same reason `docs/CLASS_COVERAGE.md` keeps the forward matrix experimental: do not mark a class supported because a name matched.

### Linked round-trip

The forward module and this reverse import share a character only when the Foundry actor is tagged with that Wanderer's Guide character. Conversion is lossy. Some Wanderer's Guide choices never land on the actor. A linked update must not use that gap as a reason to delete them.

**Design ideal.** A lossless round-trip is the goal, not a guarantee. If about 60% of a Wanderer's Guide character converts into Foundry and about 40% does not convert at all, a later pull back onto that linked character writes the 60% back and leaves the 40% untouched. The unconverted part is still sitting on the Wanderer's Guide character the way it was. Full achievement of that split is not promised. Implement toward it: mapped fields round-trip, and anything that never exported is not damaged on the way back.

**Link discovery.** When `foundry-wanderersguide-import` creates or updates an actor, it tags the actor. `scripts/mapping.js` sets `plan.wgId` from `character.id`. `scripts/importer.js` writes that onto the actor as:

- `flags["foundry-wanderersguide-import"].wgId` — the Wanderer's Guide character id (`MODULE_ID` is `foundry-wanderersguide-import` in `scripts/constants.js`)
- `flags["foundry-wanderersguide-import"].host` — the Wanderer's Guide functions base URL the export was fetched from (`opts().baseUrl` in `scripts/dialog.js`)

`findActor` in `scripts/importer.js` finds the actor again by `wgId` plus `host`. `scripts/dialog.js` uses the same pair to see whether a character is already in the world. The module does not write `game.world.id` onto the actor. `host` is the Wanderer's Guide server, not the Foundry world.

On the way back, treat `wgId` as the link. If that character id exists on the signed-in account (player button) or in this campaign (GM button), that character is the one to update. `host` only confirms which Wanderer's Guide server the forward import used. It is not a Foundry world id and it is not `foundry_links.worldId`.

Items the forward module created also carry `flags["foundry-wanderersguide-import"]` keys (`wgContentId`, `kind`, and on spellcasting entries `wgSource`). Those identify mapped rows. They are not the character link. `wgLeftovers` and `importDigest` on the same flag object are the forward module's own leftover blob and import report. Do not read either as Wanderer's Guide character state.

An actor with no `wgId` is not linked by the forward module. Match it with `foundry_source` or a `foundry_links.pcs` row, as below. The first successful reverse import of that actor writes `foundry_source`. It does not invent a `wgId` flag. Only the forward module writes `wgId`.

**Lossy export is not a destructive re-import.** Something that does not get exported stays on the Wanderer's Guide character exactly as it is. That is the 40% in the ideal above. If a Wanderer's Guide choice, selection, or item does not map into Foundry, leave it on the character. Do not delete it because the actor lacks it. On the Foundry side that same value may sit as a leftover (`flags["foundry-wanderersguide-import"].wgLeftovers`, coverage status `leftover-preserved`) because Foundry has nowhere to put it. That leftover is a copy of what did not fit. It is not a newer value.

**What a linked update writes.** Merge mapped fields onto the linked character. Update a Wanderer's Guide path only when this plan maps the actor path onto it. Leave unresolved, leftover-preserved, and unexported Wanderer's Guide content untouched. Foundry leftovers are not a source of truth: do not copy `wgLeftovers` back over the character, and do not clear a Wanderer's Guide field because its only representation on the actor is a leftover. A path that is `dropped` on the Foundry coverage ledger for the same reason (Foundry recomputes it, or the forward import omitted it) is also left as-is on the character.

An unlinked create still writes the whole plan, including `foundryLeftovers` for paths this reverse plan does not interpret. The "do not overwrite from Foundry leftovers" rule applies to the update of a character that is already linked.

### Where the plan is stored

`LivingEntitySchema.meta_data` in `src/schemas/content.ts` is a closed Zod object (`active_modes`, `given_item_ids`, `reset_hp`, `calculated_stats`). A key that is not declared there is stripped when the client parses a character. Declare the fields below on that object when this is implemented. Do not park them on `campaign.meta_data`.

```ts
type FoundryCoverageStatus =
  | "mapped"
  | "included"
  | "unresolved"
  | "leftover-preserved"
  | "dropped";

type FoundryLedgerRow = {
  path: string;
  status: FoundryCoverageStatus;
  reason: string;
};

// character.meta_data
type CharacterFoundryMeta = {
  /** Re-import key. Both fields required together. */
  foundry_source?: {
    worldId: string;
    actorId: string;
  };
  foundry_ledger?: FoundryLedgerRow[];
  /** Values of leftover-preserved paths, keyed by source path. Verbatim. */
  foundryLeftovers?: Record<string, unknown>;
};
```

`foundry_source` is the reverse-direction key for an actor the forward module has not tagged. The optional campaign PC row (below) points at which existing character to update. It is not a second copy of the key. A copied Foundry world has a new `game.world.id`, so old `foundry_source` rows do not match it. An actor tagged with `wgId` still matches after a world copy, because that flag is the Wanderer's Guide character id, not the Foundry world id.

Foundry user id and display name that were not applied as `character.user_id` go in `foundryLeftovers` under an explicit path (for example `ownership.users`), as leftover-preserved rows. They are not keys.

## Manual link, for the person who runs both

The same person runs the Foundry world and the Wanderer's Guide campaign. They create the Foundry user accounts, so they know those user ids, and the players then create actors under those accounts. That person links a Foundry human to a Wanderer's Guide human by hand. The apps do not decide the pair.

Today a GM import cannot land on the player's Wanderer's Guide account. `create-character` is called with the signed-in session (`phase1Request('create-character', …, accessToken)` in `Phase1CharactersPage`; JSON import strips `id` and posts the rest). The edge function is not in this repo. `src/process/import/wg/trim-official-character.ts` omits identity fields so `create-character` assigns new ones. No call in this repo sets `character.user_id` to someone else. `update-character` is used for `campaign_id` and sheet fields, not for a new owner. The party bench is a separate list (`campaign.meta_data.party_ids` via `wgui-ext-patch-party`). Foundry has no user id that equals a Wanderer's Guide auth id. The drag screen below is that manual link. Until a drop has written a row, the GM-account behavior above stays.

### What is already true

- A Wanderer's Guide character belongs to one auth user: `character.user_id` (`CharacterSchema` in `src/schemas/content.ts`). The party bench only means "this character is in this campaign." Those are different facts. A player's character can sit on a GM's bench. Membership for access checks is `character.campaign_id` (`authorizeCampaign` in `supabase/wgui-ext/_wgui-ext/shared.ts`).
- A Foundry user id (`game.users` document id) is stable inside one world and is a different id in another world, including a copied world. The world id (`game.world.id`) has to be part of the key.
- An actor's ownership map is `{ [foundryUserId]: 0|1|2|3 }` (Foundry none, limited, observer, owner). Several people can own one actor. The user's assigned character (`User#character`) is one actor id, and it can disagree with the ownership map. "Owner level" in the rules below means `3`.
- The Foundry module's API key identifies an API client and a character grant. It does not identify the human's Wanderer's Guide login. This reverse flow does not use that API key.

### The link row

One row per person per Foundry world:

- Wanderer's Guide auth user id
- Foundry world id
- Foundry user id
- Who confirmed it (the campaign GM, or that player) and when

Linking the two humans is enough. The player then matches their own Foundry actors to their own Wanderer's Guide characters. The GM can also write a PC row when they want to pair a specific actor with a specific character: Wanderer's Guide character id, Foundry world id, Foundry actor id. That row is optional. Import does not wait on it.

Wanderer's Guide stores the rows as one JSON object on the campaign, `campaign.meta_data.foundry_links`, next to the existing `party_ids` field in `src/schemas/content.ts`. No new table. `CampaignSchema.meta_data` is a closed Zod object today (`settings`, `party_ids`, `image_url`, `image_focus_y`, `row_color`, `dice`, `roll_history`, `encounter_folders`). Add `foundry_links` to that object when this is implemented or the client parser will drop it. `wgui-ext-patch-party` copies the previous `meta_data` and replaces `party_ids` only, so a later party edit keeps `foundry_links` if the key is already stored. Give `foundry_links` its own write. Do not overload `wgui-ext-patch-party`.

```ts
type FoundryLinks = {
  /** game.world.id. One world per campaign. */
  worldId: string;
  people: Array<{
    wguiUserId: string;
    foundryUserId: string;
    /** Auth user id of the GM or the player who confirmed the drop. */
    confirmedBy: string;
    /** ISO-8601 timestamp. */
    confirmedAt: string;
  }>;
  /** Optional. Absent until a GM or player drops an actor onto a character. */
  pcs?: Array<{
    characterId: number;
    actorId: string;
  }>;
};
```

`worldId` lives once on the object. People and PC rows do not repeat it. One person is one `people` entry. One actor-to-character pair is one `pcs` entry. Replace an entry on a new drop for the same Foundry user id or the same actor id. Do not append a second row for the same key.

`foundryLeftovers` on a character stays a separate blob. It is the uninterpreted actor source, not the human link.

A second table is warranted only if a link has to be looked up for a user who has no campaign open, or one campaign has to remember more than one Foundry world. This design uses one world per campaign, so the JSON object is the store.

The Foundry module also sets a flag on that Foundry user with the Wanderer's Guide user id, as a copy. If the campaign JSON and the flag disagree, the import treats ownership as unresolved and does not pick either side.

Display name and email are shown on the screen. They are not keys. The GM already knows the Foundry user ids, because the GM created those Foundry accounts and then let the players create actors under them.

### How a link gets written

The GM opens **Link Foundry players** from the campaign party bench (same GM-only placement as **Import party from Foundry**), signs into Foundry as the gamemaster, and gets a drag screen.

- One side is this campaign. Each human is a Wanderer's Guide user who owns a character on the bench, with that user's characters listed under them. The bench is `party_ids`; the human is `character.user_id`.
- The other side is the Foundry world. Each human is a Foundry user, with the `character` actors that user owns listed under them. Use the `actors` message with `mode: "world"`, grouped by `ownerUserIds`.

The GM drags a Foundry human onto a Wanderer's Guide human. That drop writes the person row, and that is the link the import uses. The GM may also drag a Foundry actor onto a Wanderer's Guide character. That drop writes the optional PC row. It does not create the person link by itself. A drop is the confirmation. Closing the screen without a drop writes nothing.

After the humans are linked, the player matches their own PCs: on **Import from Foundry**, each of their Foundry actors can be dropped on one of their Wanderer's Guide characters, or imported as a new character on their account. The GM has the same PC drop on the campaign screen, for when they would rather pair them. Unpaired actors still import. They land on the linked person's account when the person row exists, and on the GM's account when it does not.

Where the display names are the same, that pair is drawn as a suggestion. A suggestion does not write a row. The GM still drops it, or accepts that one pair. Pairs that do not match stay unlinked.

A player can still write their own person row by signing into Foundry as themselves from **Import from Foundry** on the character screen. That records the Foundry user who just signed in against the Wanderer's Guide account that is open. It does not link anyone else. The player has to have a campaign open to store the row, because the store is `campaign.meta_data.foundry_links`. If no campaign is open, keep the Foundry session for the actor import and skip the person row. Do not invent a user-level table.

### How a later GM import uses it

For each selected actor, read the ownership map.

- One non-GM user at owner level (`3`), and a person row for that world plus that Foundry user id: create or update the character on that Wanderer's Guide account, set `campaign_id` to this campaign, and add its id to this campaign's `party_ids`. An optional PC row says which existing Wanderer's Guide character to update. With no PC row, a new character is created on that person's account, and the player can pair it later. The GM's session cannot do that through `create-character`. The refactor adds a server call that checks the caller is the campaign GM (`campaign.user_id`) and that the person row exists, then sets `character.user_id`, `campaign_id`, and the party id. Refuse the call when the person row is missing. Do not accept a raw `user_id` from the client that is not on `foundry_links.people`.
- No link row: the character is created on the GM's account, as now. **Transfer owner** remains the way an admin moves it after the player shows up.
- Zero non-GM owners, or more than one non-GM owner, or `User#character` naming a different actor than the owner-level user: ownership stays unresolved. The character is still created on the GM's account, and the report names the Foundry user ids. Nothing is chosen by display name. The same unresolved result applies when the Foundry user flag and `foundry_links.people` disagree.

Re-import of an already linked character updates that character. It does not move `user_id` again unless the GM drops a new pair or the player confirms a new link. A copied Foundry world has a new world id, so old rows do not apply there. The GM links that world once on the drag screen.

Match an existing character in this order:

1. `flags["foundry-wanderersguide-import"].wgId` on the actor, when that Wanderer's Guide character id exists in scope (this account for the player button, this campaign for the GM button). That character is linked. Update it under "Linked round-trip". Do not create a second character.
2. Else a `foundry_links.pcs` entry whose `actorId` is this actor, and whose character is still in this campaign.
3. Else a character in this campaign whose `meta_data.foundry_source` is this `worldId` and `actorId`.
4. Else create. Attach `foundry_source` on that create.

If step 2 and step 3 name different characters, stop and show both ids. Do not update either until the GM picks one on the review dialog. If step 1 names a character and step 2 or 3 names a different one, use step 1 and say so on the review dialog. Do not move the link off the `wgId` character.

## Transfer owner

After a GM import, the GM holds the characters. Handing one to a player is a separate action inside Wanderer's Guide.

A Wanderer's Guide admin right-clicks a character and chooses **Transfer owner**. A search lists Wanderer's Guide users. The admin picks one. That user becomes the character's owner (`character.user_id`). The previous owner loses it. The search is explicit: the admin picks a person, and the tool does not match by Foundry name, email, or display name on its own.

The menu item does not exist today. Add it to:

- The account character list context menu (`CharacterGridContextMenu` on `Phase1CharactersPage`).
- The party bench row context menu (`BenchContextMenu` in `Phase1Workspace`). That menu today offers party add/leave and, for the GM, remove-from-campaign. Transfer owner is not one of those. Show it only when `public_user.is_admin` is true (`getCachedPublicUser` / `admin-config.ts`). The campaign GM who is not an admin does not see it.

The server call checks `is_admin`, then sets `user_id`. It does not change `campaign_id` or `party_ids`. A transferred character stays on the bench. Cancel on the search writes nothing.

## Error and cancel

Write nothing in every case below except the last, which is a failed write after a previous success.

| Case | What the user sees | What is stored |
| --- | --- | --- |
| Cancel on the actor list, the review dialog, the drag screen, or the transfer search | Status line says cancelled | Nothing new |
| Popup blocked, window closed, or module never sends `ready` | Status line names the failure | Nothing |
| Player login on **Import party from Foundry** | Error, empty table | Nothing |
| Module `error` or `read-actor` for an actor that was not listed | That actor stops; earlier confirmed imports stay | Only actors whose **Import** already succeeded |
| Plan has an unexplained drop | **Import** stays disabled | Nothing for this actor |
| Unresolved rows | Shown on the dialog; **Import** still allowed | Unresolved paths stay on the ledger, not guessed |
| Write fails | Status line names the failure | Previous character left in place |
| Ownership unresolved (counts, `User#character` clash, or flag clash) | Report lists the Foundry user ids | Character created on the GM account |
| `foundry_links.worldId` already set and the new login is a different world | Ask the GM to confirm replacing the world id | No write until they confirm. Confirm replaces `worldId` and clears `people` and `pcs` |

A confirmed **Import** that succeeded is not rolled back by a later actor's cancel.

## Out of scope

- NPCs, hazards, and any actor whose type is not `character`.
- Writing back to Foundry. The forward module remains the WG JSON → Foundry path.
- Mapping PF2e rule elements onto Wanderer's Guide operation keys.
- Choosing an owner from a display name, email, or Foundry username.
- Receiving or storing the Foundry password.
- More than one Foundry world on one campaign.
- A new SQL table for links.
- Biography and GM-only notes.
- Auto-joining the new character to a campaign on the player button.
- Changing `party_ids` inside the transfer-owner call.

## Implementation checklist

Do these in order. Each step is inert until the one above it exists.

1. Extend `CampaignSchema.meta_data` with `foundry_links` and `LivingEntitySchema.meta_data` with `foundry_source`, `foundry_ledger`, and `foundryLeftovers`, matching the types above. No behavior yet.
2. Foundry module: after world load, `postMessage` `ready`; answer `list-actors` and `read-actor`; strip biography and GM notes; set the user flag only when a person row was confirmed.
3. Player button on Upload/Import: origin prompt, popup, owned-actor list, per-actor review, `create-character` / `update-character` on the signed-in account, `foundry_source` written on success.
4. GM button on the party bench: gamemaster check, world actor list, per-actor review, create on the GM account, then `campaign_id`, then `wgui-ext-patch-party`.
5. Link screen and the GM-only server call that sets `user_id` from a `people` row. Wire the later GM import rule.
6. Transfer owner on the two context menus, admin-only.

## Open questions

- The module route that hosts the popup after Foundry's own login (stock world load versus a module-added application) is not chosen. The message contract above does not depend on the route name. The password still never leaves Foundry's page.
- Server-side character slot cap on `create-character` is unverified in this repo. The client cap on Upload/Import is verified.
- Which Foundry document paths count as biography and GM-only notes (PF2e `system.details.biography` versus permission-locked journals) should be listed in the module when step 2 is built. The ledger reason stays the same: dropped because the read omitted them.
