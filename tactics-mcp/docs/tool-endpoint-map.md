# MCP tool to API mapping

Every encounter tool takes `view: "gm"`. The call uses the Supabase user on the MCP token. A token only receives rows that user can already open.

## Read path

`wgui-ext-find-encounter` and `wgui-ext-find-campaign-characters` are required. There is no fallback to stock `find-encounter` or `find-character`.

Stock `find-encounter` is owner-only, so a player token gets an empty list. Stock `find-character` returns only the caller’s own PCs. Those are different results, not a smaller copy of the extension payload. A missing extension is `INTERNAL_ERROR`, not an empty roster.

The GM and a player both go through the extension. The GM payload is the same encounter document, and `view: "gm"` is what keeps player filtering off.

There is no edge function per sheet tab. After the fetch, dispatch picks the source from the combatant’s kind:

- `character` — sheet tabs come from `wgui-ext-find-campaign-characters`.
- `creature` — sheet tabs come from that combatant on the encounter document. Do not call the character function.

`get_stat_block` always reads the combatant row on the encounter. `get_abilities`, `list_ability_groups`, `get_feats`, `get_class_features`, `get_skills`, and `get_spells` use the kind rule above. The tool name is the same for a PC and a creature.

`get_map` is not registered. Map positions are out of this pass.

## Encounter payload

`wgui-ext-find-encounter` with `{ campaign_id }` or `{ id }`.

`list_encounters` returns the whole campaign list from that function, sorted by encounter id. It accepts `limit` (default 25, max 50) and slices that list. The function has no cursor, so the tool does not invent one.

| Tool | What it reads |
| --- | --- |
| `list_encounters` | Encounter id, name, and combatant count. |
| `get_encounter` | Name, round, difficulty, XP, note link. |
| `list_combatants` | Combat table: initiative, side, kind, conditions, AC, saves, current HP, max HP. |
| `list_pcs` | Rows whose kind is a character, including bench and down, with current HP. |
| `list_roster_edges` | Characters whose place is bench or down. |
| `get_round_log` | Initiative round log on the encounter. |
| `get_dice_log` | Dice roll log on the encounter. |
| `get_stat_block` | One combatant’s stored defenses, conditions, current HP, senses, and speeds. |
| `get_monster` | The creature record on that combatant: inventory, notes, details, log. A character id is not found from the kind check. |

## Character payload

`wgui-ext-find-campaign-characters` with `{ campaign_id }`, and only when the combatant kind is `character`.

| Tool | What it reads |
| --- | --- |
| `get_character` | Inventory, notes, details, and log for one PC. A creature id is not found from the kind check. |
| `get_abilities` | Ability groups (weapon attacks, feats with actions, basic, skill, speciality, exploration, downtime). |
| `list_ability_groups` | The same groups, counts only. |
| `get_feats` | Class, ancestry, general, and other feats. |
| `get_class_features` | Class features, name and level. |
| `get_skills` | Skill name, modifier, and proficiency. |
| `get_spells` | Tradition, rank, and spent slots stored on the character. |

## Account

`ensure_public_user`, `join_campaign`, and `patch_encounter_dice` require the `write` scope. The other tools in this server require `read`. A token that only has `read` still calls the lookup tools and is rejected, before the handler, on the three writes.

| Tool | What it reads |
| --- | --- |
| `get_profile` | Supabase user looked up by the token row’s `userId`. No encounter function. No `view`. |
| `ensure_public_user` | Inserts `public_user` for that user when the row is missing. Same job as `wgui-ext-ensure-public-user`. |
| `join_campaign` | Checks `campaign.join_key`, then sets `character.campaign_id` for a character that user owns. The key is not returned. Same job as `wgui-ext-join-campaign`. |
| `get_campaign_owner_contacts` | Auth email for owners of campaigns the caller already shares. Unknown ids are omitted. Same job as `wgui-ext-campaign-owner-email`. |
| `patch_encounter_dice` | Writes `meta_data.dice_roll_state` and `meta_data.dice_roll_log` only. A GM replaces the fields they send. A player is limited to their own log rows and the tray fields title, DC, stat, and results. Same job as `wgui-ext-patch-encounter-dice`. |
| `list_campaign_characters` | Characters in a campaign the caller belongs to. Same job as `wgui-ext-find-campaign-characters`. |
| `export_character` | Compiled JSON v4 file from `wgui-export-character`. The caller must own the character or be that campaign's GM. |

## Errors

| Failure | Error |
| --- | --- |
| Missing, unknown, expired, or revoked bearer | `AUTH_REQUIRED` |
| Bearer is valid but lacks the tool's scope | Tool result `AUTH_REQUIRED` naming the missing scope. The HTTP call is still accepted. |
| `view` missing or not `gm` | `VALIDATION_ERROR` |
| Extension not deployed, or the function returns a non-success status | `INTERNAL_ERROR` |
| Encounter id or combatant id absent from a successful extension response | `NOT_FOUND` |
| Kind mismatch (`get_monster` on a PC, `get_character` on a creature) | `NOT_FOUND` from the kind check, before any second fetch |
| Extension succeeded and the campaign has no encounters | Empty list, not an error |
| Too many in-flight `/mcp` calls | `RATE_LIMITED` |

## Next batch: sheet tabs

Still the same two calls. No new endpoint. After `wgui-ext-find-encounter` and, for a character, `wgui-ext-find-campaign-characters`, run the same builders the GM page uses. A creature never calls the character function.

The combatant id in every tool is the encounter row `_id`.

| Tool | Builder | Source |
| --- | --- | --- |
| `get_stat_block` | `calculateEntityStatus` | Encounter combatant row. Current HP and conditions stay on that row. AC, saves, perception, speeds, senses, resistances, weaknesses, immunities, and ability modifiers come from the builder. |
| `list_ability_groups` | `loadEntitySkillsActions` | Group id, label, and action count. Groups with no actions are omitted. |
| `get_abilities` | `loadEntitySkillsActions` | One group: `weapon-attacks`, `feats`, `basic-actions`, `skill-actions`, `speciality-basics`, `exploration-activities`, `downtime-activities`. Match by id or label. |
| `get_feats` | `loadEntityAbilities` | Feats only, sections `class`, `ancestry`, `general`, `other`. Class features are not in this list. |
| `get_class_features` | `loadEntityAbilities` | Class features and physical features, name and level. |
| `get_skills` | `loadEntitySkillsActions` | Skill name, modifier, and proficiency. Skip the empty lore placeholder. |
| `get_spells` | `loadEntitySpells` | Tradition, rank, name, spent, and max from the character or creature spell slots. |
| `get_character` | character document | Inventory, notes, details, and log. Kind must be `character`. |
| `get_monster` | creature on the encounter row | Inventory, notes, details, and log. Kind must be `creature`. |

`get_round_log` reads `meta_data.initiative_log` on the encounter. `get_dice_log` reads the encounter dice log. Neither needs a second function.
