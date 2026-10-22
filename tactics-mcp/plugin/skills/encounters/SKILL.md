---
name: encounters
description: Read Wanderer's Guide encounter and character data for the GM. Use when the user asks about an encounter, combatant, PC, creature, HP, initiative, feats, skills, or spells.
---

Use the Wanderer's Guide tools. Lookup tools need the `read` scope. `ensure_public_user`, `join_campaign`, and `patch_encounter_dice` write data and need the `write` scope.

Call `get_profile` first if you need to confirm the connected account. Then `list_encounters` for the campaign, and `get_encounter` or `list_combatants` for one encounter. Pass `view` as `gm` on every encounter tool. Combatant ids are the encounter row ids returned by those tools.
