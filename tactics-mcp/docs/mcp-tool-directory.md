# WGUI MCP tool directory

Thirty-eight tools require `read`. Twenty-three tools require `write`. Encounter tools require `view: "gm"`. See [adr-oauth.md](./adr-oauth.md). Groups are campaign / encounter / combat, then character, then homebrew. Homebrew names use `wgui_ext_hb_`. The other 31 names stay as they are.

## Campaign, encounter, and combat

| Tool | Scope | Returns |
| --- | --- | --- |
| `get_profile` | `read` | The token's user id |
| `ensure_public_user` | `write` | Create the caller's profile when it is missing |
| `join_campaign` | `write` | Attach the caller's character with a join key |
| `get_campaign_owner_contacts` | `read` | Email for owners the caller already shares a campaign with |
| `list_campaign_characters` | `read` | Campaign PC roster |
| `list_encounters` | `read` | Encounters in a campaign |
| `get_encounter` | `read` | Name, round, difficulty, XP |
| `list_pcs` | `read` | PCs with current HP |
| `list_combatants` | `read` | Combat table |
| `list_roster_edges` | `read` | Bench and down |
| `get_round_log` | `read` | Round log |
| `get_dice_log` | `read` | Dice log |
| `patch_encounter_dice` | `write` | Dice tray and dice log only |
| `get_stat_block` | `read` | Health tab |
| `list_ability_groups` | `read` | Action group counts |
| `get_abilities` | `read` | One action group |
| `get_feats` | `read` | Feats |
| `get_class_features` | `read` | Class features |
| `get_skills` | `read` | Skills |
| `get_spells` | `read` | Spells, including spent slots |
| `get_character` | `read` | Remaining PC tabs |
| `get_monster` | `read` | Remaining creature tabs |

## Character

| Tool | Scope | Returns |
| --- | --- | --- |
| `export_character` | `read` | Compiled character JSON file |
| `get_character_row` | `read` | Builder character row from `find-character` |
| `list_options` | `read` | Catalog options for the character's enabled books |
| `list_open_choices` | `read` | Unfilled builder selections |
| `create_character` | `write` | New character row |
| `set_books` | `write` | Enabled content source ids |
| `set_identity` | `write` | Ancestry, background, or class |
| `choose` | `write` | One legal option on an open choice |
| `delete_character` | `write` | Delete a character row |

## Homebrew

| Tool | Scope | Function |
| --- | --- | --- |
| `wgui_ext_hb_find_content_source` | `read` | `find-content-source` |
| `wgui_ext_hb_create_content_source` | `write` | `create-content-source` |
| `wgui_ext_hb_find_trait` | `read` | `find-trait` |
| `wgui_ext_hb_create_trait` | `write` | `create-trait` |
| `wgui_ext_hb_find_ability_block` | `read` | `find-ability-block` |
| `wgui_ext_hb_create_ability_block` | `write` | `create-ability-block` |
| `wgui_ext_hb_find_ancestry` | `read` | `find-ancestry` |
| `wgui_ext_hb_create_ancestry` | `write` | `create-ancestry` |
| `wgui_ext_hb_find_background` | `read` | `find-background` |
| `wgui_ext_hb_create_background` | `write` | `create-background` |
| `wgui_ext_hb_find_class` | `read` | `find-class` |
| `wgui_ext_hb_create_class` | `write` | `create-class` |
| `wgui_ext_hb_find_archetype` | `read` | `find-archetype` |
| `wgui_ext_hb_create_archetype` | `write` | `create-archetype` |
| `wgui_ext_hb_find_versatile_heritage` | `read` | `find-versatile-heritage` |
| `wgui_ext_hb_create_versatile_heritage` | `write` | `create-versatile-heritage` |
| `wgui_ext_hb_find_class_archetype` | `read` | `find-class-archetype` |
| `wgui_ext_hb_create_class_archetype` | `write` | `create-class-archetype` |
| `wgui_ext_hb_find_item` | `read` | `find-item` |
| `wgui_ext_hb_create_item` | `write` | `create-item` |
| `wgui_ext_hb_find_language` | `read` | `find-language` |
| `wgui_ext_hb_create_language` | `write` | `create-language` |
| `wgui_ext_hb_find_creature` | `read` | `find-creature` |
| `wgui_ext_hb_create_creature` | `write` | `create-creature` |
| `wgui_ext_hb_find_spell` | `read` | `find-spell` |
| `wgui_ext_hb_create_spell` | `write` | `create-spell` |
| `wgui_ext_hb_find_content_update` | `read` | `find-content-update` |
| `wgui_ext_hb_create_content_update` | `write` | `create-content-update` |
| `wgui_ext_hb_get_content_source_stats` | `read` | `get-content-source-stats` |
| `wgui_ext_hb_delete_content` | `write` | `delete-content`, content types only |
