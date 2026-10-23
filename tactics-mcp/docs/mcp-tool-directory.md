# WGUI MCP tool directory

Twenty-three tools require `read`. Eight tools require `write`: `ensure_public_user`, `join_campaign`, `patch_encounter_dice`, `create_character`, `set_books`, `set_identity`, `choose`, and `delete_character`. Encounter tools require `view: "gm"`. See [adr-oauth.md](./adr-oauth.md).

| Tool | Scope | Returns |
| --- | --- | --- |
| `get_profile` | `read` | The token's user id |
| `list_encounters` | `read` | Encounters in a campaign |
| `get_encounter` | `read` | Name, round, difficulty, XP |
| `list_pcs` | `read` | PCs with current HP |
| `list_combatants` | `read` | Combat table |
| `list_roster_edges` | `read` | Bench and down |
| `get_round_log` | `read` | Round log |
| `get_dice_log` | `read` | Dice log |
| `get_stat_block` | `read` | Health tab |
| `list_ability_groups` | `read` | Action group counts |
| `get_abilities` | `read` | One action group |
| `get_feats` | `read` | Feats |
| `get_class_features` | `read` | Class features |
| `get_skills` | `read` | Skills |
| `get_spells` | `read` | Spells, including spent slots |
| `get_character` | `read` | Remaining PC tabs |
| `get_monster` | `read` | Remaining creature tabs |
| `ensure_public_user` | `write` | Create the caller's profile when it is missing |
| `join_campaign` | `write` | Attach the caller's character with a join key |
| `get_campaign_owner_contacts` | `read` | Email for owners the caller already shares a campaign with |
| `patch_encounter_dice` | `write` | Dice tray and dice log only |
| `list_campaign_characters` | `read` | Campaign PC roster |
| `export_character` | `read` | Compiled character JSON file |
| `get_character_row` | `read` | Builder character row from `find-character` |
| `list_options` | `read` | Catalog options for the character's enabled books |
| `list_open_choices` | `read` | Unfilled builder selections |
| `create_character` | `write` | New character row |
| `set_books` | `write` | Enabled content source ids |
| `set_identity` | `write` | Ancestry, background, or class |
| `choose` | `write` | One legal option on an open choice |
| `delete_character` | `write` | Delete a character row |
