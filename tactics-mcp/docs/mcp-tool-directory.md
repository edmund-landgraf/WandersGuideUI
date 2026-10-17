# WGUI MCP tool directory

All tools are read-only. Encounter tools require `view: "gm"`. See [adr-oauth.md](./adr-oauth.md).

| Tool | Returns |
| --- | --- |
| `get_profile` | The token's user id |
| `list_encounters` | Encounters in a campaign |
| `get_encounter` | Name, round, difficulty, XP |
| `list_pcs` | PCs with current HP |
| `list_combatants` | Combat table |
| `list_roster_edges` | Bench and down |
| `get_round_log` | Round log |
| `get_dice_log` | Dice log |
| `get_stat_block` | Health tab |
| `list_ability_groups` | Action group counts |
| `get_abilities` | One action group |
| `get_feats` | Feats |
| `get_class_features` | Class features |
| `get_skills` | Skills |
| `get_spells` | Spells, including spent slots |
| `get_character` | Remaining PC tabs |
| `get_monster` | Remaining creature tabs |
| `ensure_public_user` | Create the caller's profile when it is missing |
| `join_campaign` | Attach the caller's character with a join key |
| `get_campaign_owner_contacts` | Email for owners the caller already shares a campaign with |
| `patch_encounter_dice` | Dice tray and dice log only |
| `list_campaign_characters` | Campaign PC roster |
| `export_character` | Compiled character JSON file |
