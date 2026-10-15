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
