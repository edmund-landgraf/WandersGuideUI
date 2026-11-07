# What `foundry-wanderersguide-import` changes for encounter sync

**Status: design only.** This file lives in WandersGuideUI. Wanderer's Guide is the caller. The Foundry module does not decide a sync and does not write a Wanderer's Guide encounter.

`foundry-wanderersguide-import` today imports a Wanderer's Guide character export into an actor (`scripts/dialog.js`, `scripts/importer.js`, `scripts/coverage.js`, `scripts/api.js`). That path stays. Encounter sync is a new surface on the same module (`MODULE_ID` is `foundry-wanderersguide-import` in `scripts/constants.js`).

WGUI already holds the encounter row (`id`, `campaign_id`, `combatants.list`). The module's job is to answer reads and apply the writes WGUI sends, on the Foundry combat the GM linked. See `docs/foundry-encounter-link.md` for the link itself.

## Leave alone

Do not change character import, the coverage ledger, compendium matching, or the API-key setting in `docs/PLAN.md` section 2.2. Encounter sync does not use the Wanderer's Guide API key. The key stays the credential for pulling a character export into Foundry.

Do not create combats, scenes, or actors as part of sync. `amba-bridge` already creates the combat when AMBA publishes. This module only reads that combat and patches fields WGUI names.

## Connection code

Add a second client-scoped setting, separate from `apiKey`: a connection code for Wanderer's Guide to call this world. Same privacy rule as section 2.2: client scope, password-style input, never logged, never written into chat, flags, or journals. A rejected code is reported as rejected, with no echo of the value.

WGUI sends that code on every encounter read and write. The module answers only when the code matches and the Foundry user for that session is a GM. A player session returns an error and no combat payload.

The world origin WGUI already collected (`http://localhost:30000` for a local world) is where these calls go. Exact paths and headers are the module's to choose. WGUI will call four operations, described below by payload, not by URL.

## 1. List combats

Read-only. One row per combat in the world:

- Foundry combat id
- combat name
- scene id and scene name
- world id (`game.world.id`)
- round, and whether the combat has started
- party-character count: combatants whose actor type is `character`
- enemy count: every other combatant (creatures and hazards together)
- `flags["amba-bridge"].encounterId` when `amba-bridge` set it (the AMBA container id, not a Wanderer's Guide id)
- the link flag from section 3, when this module has already stored one

WGUI uses the AMBA container id to preselect a row when `meta_data.amba.challenges[].source.containerId` on the open encounter equals it. The module only returns the flag. It does not read Wanderer's Guide.

An empty world is an empty list, not an error.

## 2. Read one combat

Read-only. WGUI asks for one combat id. The payload is the list fields above, plus one entry per combatant:

- Foundry combatant id
- actor id
- actor type (`character` or not)
- token id
- display name
- initiative, when set
- current HP and max HP, when the actor has them

Omit biography, GM notes, and other users' secret text. Omit chat and unlinked actors.

A combat id that is not in the world is an error. WGUI reports that row and can still read the next combat.

## 3. Store or clear the link

WGUI calls this only after the GM confirms Link or Unlink in Wanderer's Guide, and only when the party-character count and the enemy count already match. The module does not compare those counts itself. If they do not match, WGUI does not send this call.

On Link, set on that combat:

`flags["foundry-wanderersguide-import"].wguiEncounter`

- `encounterId` — Wanderer's Guide encounter id
- `campaignId` — Wanderer's Guide campaign id
- `host` — Wanderer's Guide origin WGUI sends

One combat stores one encounter. A new Link replaces `wguiEncounter` on that combat. The module does not update any other combat.

On Unlink, remove `wguiEncounter` from that combat. Leave `flags["amba-bridge"]` in place. That tag belongs to `amba-bridge`.

If the write fails, return the error. Do not report success.

## 4. Apply a sync patch

WGUI builds the patch. The module applies it to the linked combat and does not interpret Wanderer's Guide rules.

The patch may set, per Foundry combatant id:

- initiative
- current HP

It may set the combat round.

It may not add or remove combatants, create actors, change max HP, change ownership, or edit items. A patch that names a combatant not on that combat is rejected for that combatant. The other combatants in the same patch still apply. The response lists each combatant as applied or rejected, with the reason.

The module applies a patch only when `wguiEncounter.encounterId` and `wguiEncounter.campaignId` on the combat match the ids WGUI sends. A combat with no link, or a different link, is rejected and unchanged.

Current HP and initiative already on the combat are overwritten only for the combatants included in the patch. Combatants omitted from the patch stay as they are.

## What WGUI does with this

WGUI calls list, then one combat read, then either the link write or a sync patch. The module never calls `create-encounter` and never pushes a combat into Wanderer's Guide on its own.

Count checks, the AMBA preselect, and the review dialog stay in WGUI (`docs/foundry-encounter-link.md`). This module returns the counts and the `amba-bridge` container id so WGUI can do that work.

Character import remains the existing dialog in Foundry. Encounter sync does not add a second import button there.
