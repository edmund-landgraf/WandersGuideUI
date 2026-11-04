# Import Foundry PCs into Wanderer's Guide

Design only. Wanderer's Guide is where the user starts. A Foundry world is the source. The Foundry module `foundry-wanderersguide-import` already imports Wanderer's Guide JSON v4 into a Foundry actor. That import is the rulebook for how data moves: `scripts/coverage.js`, `scripts/importer.js`, and `scripts/dialog.js` in that repo. Class support stays experimental (`docs/CLASS_COVERAGE.md` there).

Two buttons. Two Foundry logins. The password is typed on a page served by the Foundry world. Wanderer's Guide's server never receives it.

## Player import

The player is on their character screen. The upload menu in `src/pages/phase1/Phase1Workspace.tsx` already has Import from JSON, Import from Pathbuilder, Import from GUIDECHAR, and Import from wanderersguide.app. Add **Import from Foundry** there.

1. The button opens Foundry's own login for the world address the player entered (`http://localhost:30000` for a local world). They sign in with their Foundry username and password.
2. The module lists `character` actors that this Foundry user owns. Other players' characters are absent from the list.
3. The player ticks one or several rows. **Import selected** is disabled when none are ticked.
4. Each ticked actor is read one at a time, planned, reviewed, and written into **this Wanderer's Guide account**. See "Plan and review" below.
5. **Cancel** at any step writes nothing.

A Foundry user who is not a player still uses this button for the characters that account owns. The list is ownership, not a role name.

## GM import

The GM is on the campaign screen, not the character screen. The campaign sidebar already has the **Party bench** (`Phase1Workspace`, shown when a campaign is open and the viewer is the game master). Add **Import party from Foundry** on that bench.

1. The button opens Foundry's login for the world address. The GM signs in with their Foundry username and password.
2. The module checks that this Foundry user is a gamemaster of that world. A player login on this button shows an error and lists nothing.
3. The table lists every `character` actor in the world: checkbox, name, level, ancestry, class, Foundry actor id, and whether this campaign already has a character stored for that actor id plus world identity.
4. The GM ticks the rows, including all of them, and imports one at a time into **this campaign**.
5. Until a link exists, each new Wanderer's Guide character is owned by the GM's Wanderer's Guide account. Foundry's per-user ownership is stored with the leftovers (Foundry user id and name) and is not applied as a Wanderer's Guide owner. The later link, below, is what replaces this step. A name, email, or display name is never enough to pick an owner.
6. An empty party bench stays empty until **Import** is confirmed on the review step. Cancel writes nothing.

## Transfer owner

After a GM import, the GM holds the characters. Handing one to a player is a separate action inside Wanderer's Guide.

A Wanderer's Guide admin right-clicks a character and chooses **Transfer owner**. A search lists Wanderer's Guide users. The admin picks one. That user becomes the character's owner. The previous owner loses it. The search is explicit: the admin picks a person, and the tool does not match by Foundry name, email, or display name on its own.

The menu item is on the character context menu (the party bench row and the account character list). It is shown to a Wanderer's Guide admin.

## Plan and review

The Foundry actor is the source of truth. Wanderer's Guide's builder does not fill a blank by derivation.

Every source path on the actor gets exactly one status, from what the plan actually consumed (`scripts/coverage.js` in `foundry-wanderersguide-import`):

| Status | Meaning |
| --- | --- |
| mapped | Written onto the Wanderer's Guide character |
| included | Already represented by another mapped row, so no second copy |
| unresolved | A choice or a content match that is not exactly one legal Wanderer's Guide option. The builder asks. The importer does not pick the first option and does not invent an operation selection |
| leftover-preserved | Not interpreted. The raw value is copied verbatim onto the character as `foundryLeftovers` |
| dropped | Omitted, with a written reason (document metadata, a stat Wanderer's Guide recomputes, a duplicate). An unexplained drop fails the plan |

Match order onto Wanderer's Guide content is slug, then an unambiguous name. Several records for one name stay unresolved. A standard miss stays unresolved and is not copied as homebrew. A world item that is actually a custom item, with no compendium uuid, is the homebrew case. That is the same boundary as the forward importer's "no unambiguous compendium match; left unresolved (no homebrew copy created)".

Before any character write, the dialog shows the five counts, the unresolved list, and the leftover-preserved paths. **Import** is the only action that creates or updates. Re-import finds the Wanderer's Guide character that already stores this Foundry actor id and world identity and updates that character. A failed write leaves the previous character in place.

Biography and GM-only notes are omitted from the read. The omission is a `dropped` row with that reason.

After the run, the status line names the character or the failure. The ledger and `foundryLeftovers` stay on the character.

PF2e rule elements are not mapped onto Wanderer's Guide operation keys here. A path with no evidenced Wanderer's Guide target is unresolved or leftover-preserved.

## Manual link, for the person who runs both

The same person runs the Foundry world and the Wanderer's Guide campaign. They create the Foundry user accounts, so they know those user ids, and the players then create actors under those accounts. That person links a Foundry human to a Wanderer's Guide human by hand. The apps do not decide the pair.

Today a GM import cannot land on the player's Wanderer's Guide account. `create-character` assigns `character.user_id` from the signed-in session, and the party bench is a separate list (`campaign.meta_data.party_ids` via `wgui-ext-patch-party`). There is no call that sets `user_id` to someone else. Foundry has no user id that equals a Wanderer's Guide auth id. The drag screen below is that manual link. Until a drop has written a row, the GM-account behavior above stays.

### What is already true

- A Wanderer's Guide character belongs to one auth user: `character.user_id`. The party bench only means "this character is in this campaign." Those are different facts. A player's character can sit on a GM's bench.
- A Foundry user id (`game.users` document id) is stable inside one world and is a different id in another world, including a copied world. The world id (`game.world.id`) has to be part of the key.
- An actor's ownership map is `{ [foundryUserId]: 0|1|2|3 }`. Several people can own one actor. The user's assigned character (`User#character`) is one actor id, and it can disagree with the ownership map.
- The Foundry module's API key identifies an API client and a character grant. It does not identify the human's Wanderer's Guide login.

### The link row

One row per person per Foundry world:

- Wanderer's Guide auth user id
- Foundry world id
- Foundry user id
- Who confirmed it (the campaign GM, or that player) and when

Linking the two humans is enough. The player then matches their own Foundry actors to their own Wanderer's Guide characters. The GM can also write a PC row when they want to pair a specific actor with a specific character: Wanderer's Guide character id, Foundry world id, Foundry actor id. That row is optional. Import does not wait on it.

Wanderer's Guide stores the rows as one JSON object on the campaign, `campaign.meta_data.foundry_links`, next to the existing `party_ids` field in [src/schemas/content.ts](../src/schemas/content.ts). No new table. The object is:

- `worldId` — the Foundry world this campaign is linked to
- `people` — `{ wguiUserId, foundryUserId, confirmedBy, confirmedAt }`
- `pcs` — optional `{ characterId, actorId }`

`foundryLeftovers` on a character stays a separate blob. It is the uninterpreted actor source, not the human link.

A second table is warranted only if a link has to be looked up for a user who has no campaign open, or one campaign has to remember more than one Foundry world. This design uses one world per campaign, so the JSON object is the store.

The Foundry module also sets a flag on that Foundry user with the Wanderer's Guide user id, as a copy. If the campaign JSON and the flag disagree, the import treats ownership as unresolved and does not pick either side.

Display name and email are shown on the screen. They are not keys. The GM already knows the Foundry user ids, because the GM created those Foundry accounts and then let the players create actors under them.

### How a link gets written

The GM opens **Link Foundry players** from the campaign party bench, signs into Foundry as the gamemaster, and gets a drag screen.

- One side is this campaign. Each human is a Wanderer's Guide user who owns a character on the bench, with that user's characters listed under them. The bench is `party_ids`; the human is `character.user_id`.
- The other side is the Foundry world. Each human is a Foundry user, with the `character` actors that user owns listed under them.

The GM drags a Foundry human onto a Wanderer's Guide human. That drop writes the person row, and that is the link the import uses. The GM may also drag a Foundry actor onto a Wanderer's Guide character. That drop writes the optional PC row. It does not create the person link by itself. A drop is the confirmation. Closing the screen without a drop writes nothing.

After the humans are linked, the player matches their own PCs: on **Import from Foundry**, each of their Foundry actors can be dropped on one of their Wanderer's Guide characters, or imported as a new character on their account. The GM has the same PC drop on the campaign screen, for when they would rather pair them. Unpaired actors still import. They land on the linked person's account when the person row exists, and on the GM's account when it does not.

Where the display names are the same, that pair is drawn as a suggestion. A suggestion does not write a row. The GM still drops it, or accepts that one pair. Pairs that do not match stay unlinked.

A player can still write their own person row by signing into Foundry as themselves from **Import from Foundry** on the character screen. That records the Foundry user who just signed in against the Wanderer's Guide account that is open. It does not link anyone else.

### How a later GM import uses it

For each selected actor, read the ownership map.

- One non-GM user at owner level, and a person row for that world plus that Foundry user id: create or update the character on that Wanderer's Guide account and add its id to this campaign's `party_ids`. An optional PC row says which existing Wanderer's Guide character to update. With no PC row, a new character is created on that person's account, and the player can pair it later. The GM's session cannot do that through `create-character`. The refactor adds a server call that checks the caller is the campaign GM and that the person row exists, then sets `character.user_id` and the party id.
- No link row: the character is created on the GM's account, as now. **Transfer owner** remains the way an admin moves it after the player shows up.
- Zero non-GM owners, or more than one non-GM owner, or `User#character` naming a different actor than the owner-level user: ownership stays unresolved. The character is still created on the GM's account, and the report names the Foundry user ids. Nothing is chosen by display name.

Re-import of an already linked character updates that character. It does not move `user_id` again unless the GM drops a new pair or the player confirms a new link. A copied Foundry world has a new world id, so old rows do not apply there. The GM links that world once on the drag screen.
