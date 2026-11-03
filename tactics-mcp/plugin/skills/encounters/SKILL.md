---
name: encounters
description: Read Wanderer's Guide encounter tactics and character data, or create and edit characters. Use when the user asks about an encounter, combatant, PC, creature, HP, initiative, feats, skills, spells, character creation, or character edits.
---

Use the full Wanderer's Guide toolset. Lookup and tactics tools need the `read` scope. Character creation and edits, campaign joins, encounter dice updates, and homebrew creation/deletion need the `write` scope.

Call `get_profile` first if you need to confirm the connected account. Then `list_encounters` for the campaign, and `get_encounter` or `list_combatants` for one encounter. Pass `view` as `gm` on every encounter tool. Combatant ids are the encounter row ids returned by those tools.

For character creation or editing, use `create_character`, `get_character_row`, `set_books`, `set_identity`, `list_open_choices`, `choose`, `list_spell_options`, `add_spell`, `remove_spell`, and `set_spells` as appropriate. `upload_image` sends PNG, JPEG, or WebP to `upload-public-file` and returns the URL. `set_character_art` sets `details.image_url` and `details.background_image_url` (a URL, or `portraitData` / `backgroundData` which upload first). `get_character_notes` and `set_character_notes` read and write `notes.pages`. `set_inventory_item` sets `is_equipped` and `is_invested`. `get_campaign` and `set_campaign_art` read and write `meta_data.image_url` and `meta_data.image_focus_y` (the owner writes). Confirm before destructive `delete_character` or homebrew deletion actions.
