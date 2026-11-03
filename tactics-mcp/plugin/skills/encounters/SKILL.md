---
name: encounters
description: Read Wanderer's Guide encounter tactics and character data, or create and edit characters. Use when the user asks about an encounter, combatant, PC, creature, HP, initiative, feats, skills, spells, character creation, or character edits.
---

Use the full Wanderer's Guide toolset. Lookup and tactics tools need the `read` scope. Character creation and edits, campaign joins, encounter dice updates, and homebrew creation/deletion need the `write` scope.

Call `get_profile` first if you need to confirm the connected account. Then `list_encounters` for the campaign, and `get_encounter` or `list_combatants` for one encounter. Pass `view` as `gm` on every encounter tool. Combatant ids are the encounter row ids returned by those tools.

For character creation or editing, use `create_character`, `get_character_row`, `set_books`, `set_identity`, `list_open_choices`, `choose`, `list_spell_options`, `add_spell`, `remove_spell`, and `set_spells` as appropriate. Confirm before destructive `delete_character` or homebrew deletion actions.
