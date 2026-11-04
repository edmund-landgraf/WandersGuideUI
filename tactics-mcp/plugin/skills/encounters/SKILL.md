---
name: encounters
description: Read Wanderer's Guide encounter tactics and character data, or create and edit characters. Use when the user asks about an encounter, combatant, PC, creature, HP, initiative, feats, skills, spells, character creation, or character edits.
---

Use the full Wanderer's Guide toolset. Lookup and tactics tools need the `read` scope. Character creation and edits, campaign joins, encounter dice updates, and homebrew creation/deletion need the `write` scope.

Call `get_profile` first if you need to confirm the connected account. Use `list_campaigns` / `get_campaign` for campaigns this account owns, and `create_campaign` / `update_campaign` to add or edit them (`meta_data` is merged). Create fights with `create_encounter` (omit `campaignId` for a standalone encounter, or pass a campaign this user owns). Use `update_encounter` for name/description/`meta_data`, and `set_encounter_campaign` to attach or detach. Then `list_encounters` for a campaign, and `get_encounter` or `list_combatants` for one encounter. Pass `view` as `gm` on every encounter-tactics tool. Combatant ids are the encounter row ids returned by those tools. There is no delete campaign or delete encounter tool.

Roster and initiative writes need the `write` scope and the campaign GM. `add_encounter_combatant` adds a joined PC (`characterId`) or a catalog creature (`creatureId` from `wgui_ext_hb_find_creature`). `remove_encounter_combatant` drops one PC, creature, or hazard from the fight. `patch_encounter_combatant` sets initiative, HP, temp HP, or conditions on the encounter row and does not edit the character sheet. `roll_initiative` rolls a d20 plus the bonus you pass; `scope` `empty` fills blanks and `all` rerolls. `get_encounter` returns `encounterRevision` for the next write. `patch_encounter_dice` still changes only the dice tray and dice log.

For character creation or editing, use `create_character`, `get_character_row`, `set_books`, `set_identity`, `list_open_choices`, `choose`, `list_spell_options`, `add_spell`, `remove_spell`, and `set_spells` as appropriate. Confirm before destructive `delete_character` or homebrew deletion actions.
