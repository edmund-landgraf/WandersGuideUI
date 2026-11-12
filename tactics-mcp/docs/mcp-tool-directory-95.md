# WGUI MCP tool directory (95 tools)

Generated Nov 3, 2026 from the live `wgui` MCP server tool list, with scopes checked against `READ_TOOLS` / `WRITE_TOOLS` in `src/server.ts`.

**95 tools: 44 require `read`, 51 require `write`.** This includes the 7 campaign/encounter create-update tools in the section below. `tools/list` returns every tool for any token; scope is enforced at call time. The 20 encounter tools marked **GM** require `view: "gm"`. Groups: campaign / encounter / combat (27), character (28), homebrew `wgui_ext_hb_*` (30), plus campaign/encounter writes. Supersedes [mcp-tool-directory.md](./mcp-tool-directory.md) (61 tools, Oct 27). See [adr-oauth.md](./adr-oauth.md).

Common encounter params: `campaignId`, `encounterId`, and for per-combatant tools `combatantId`.

## Campaign, encounter, and combat (27: 19 read, 8 write)

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `get_profile` | read | Supabase user id for the token | none |
| `ensure_public_user` | write | Creates the caller's public_user row if missing (idempotent) | none |
| `join_campaign` | write | Attaches a character the caller owns to a campaign via join key | `characterId`, `joinKey` |
| `get_campaign_owner_contacts` | read | Email/display name of owners the caller shares a campaign with (max 24 ids) | `userIds` |
| `list_campaign_characters` | read | Campaign PC roster: id, name, level, ancestry, class | `campaignId` |
| `set_campaign_art` | write | Sets `meta_data.image_url` and/or `meta_data.image_focus_y`. `imageData` uploads via `upload-public-file` (`backgrounds`) first. Owner/GM only | `campaignId` (+ `imageUrl`, `imageData`, or `focusY`) |
| `list_encounters` | read · GM | Encounters: id, name, combatant count | `view`, `campaignId` |
| `get_encounter` | read · GM | Name, round, difficulty, XP, encounter revision | `view`, `campaignId`, `encounterId` |
| `list_pcs` | read · GM | PCs fighting, benched, or down, with current HP | `view`, `campaignId`, `encounterId` |
| `list_combatants` | read · GM | Initiative, defenses, conditions, current HP for all combatants | `view`, `campaignId`, `encounterId` |
| `list_roster_edges` | read · GM | Benched/down PCs with current HP | `view`, `campaignId`, `encounterId` |
| `get_round_log` | read · GM | Round log lines | `view`, `campaignId`, `encounterId` |
| `get_dice_log` | read · GM | Dice tray state and saved dice log | `view`, `campaignId`, `encounterId` |
| `patch_encounter_dice` | write | Writes only dice tray (`diceRollState`) and/or dice log (`diceRollLog`) | `campaignId`, `encounterId` (+ one field) |
| `add_encounter_combatant` | write · GM | GM adds one joined PC (`wgui-ext-add-encounter-character`) or one catalog/homebrew creature (`wgui-ext-add-encounter-creature`). The reply includes that character or creature name. `ally` is for creatures | `view`, `campaignId`, `encounterId`, and one id |
| `remove_encounter_combatant` | write · GM | GM removes one PC, creature, or hazard via `wgui-ext-remove-encounter-combatant`. Does not delete the character or catalog row | `view`, `campaignId`, `encounterId`, `combatantId` |
| `patch_encounter_combatant` | write · GM | GM sets initiative, current HP, temp HP, and/or conditions via `wgui-ext-patch-encounter-combatant` | `view`, ids, `combatantId`, and one field |
| `roll_initiative` | write · GM | GM rolls d20 + bonus via `wgui-ext-roll-initiative`. Reply names use the character or creature name. `rollBatch` counts initiative logs (older logs stored this as `round`). `scope` `empty` fills blanks; `all` rerolls. A repeated `clientRequestId` does not roll again | `view`, `campaignId`, `encounterId` |
| `get_stat_block` | read · GM | Current HP, defenses, senses, speeds, ability mods | `view`, ids, `combatantId` |
| `list_ability_groups` | read · GM | Action groups with counts | `view`, ids, `combatantId` |
| `get_abilities` | read · GM | One action group: name, cost, traits, description | `view`, ids, `combatantId`, `group` |
| `get_feats` | read · GM | Feats, optional `section` filter | `view`, ids, `combatantId` |
| `get_class_features` | read · GM | Class features with level | `view`, ids, `combatantId` |
| `get_skills` | read · GM | Skill name, modifier, proficiency | `view`, ids, `combatantId` |
| `get_spells` | read · GM | Tradition, rank, spent slots | `view`, ids, `combatantId` |
| `get_character` | read · GM | PC inventory, notes, details, log | `view`, ids, `combatantId` |
| `get_monster` | read · GM | Creature inventory, notes, details, log | `view`, ids, `combatantId` |

## Character (28: 8 read, 20 write)

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `create_character` | write | Creates a character row; returns id, updated_at | none (`name`, `level` optional) |
| `delete_character` | write | Deletes a character the caller can read | `characterId` |
| `export_character` | read | Export as JSON (slim/full) or PDF; owner or campaign GM | `characterId` |
| `get_character_row` | read | Reads a character via find-character (`full` returns row). Summary includes `image_url` and `background_image_url` | none (`id`, `user_id`, `campaignId`) |
| `get_character_notes` | read | `notes.pages` (name, icon, color, shared, contents, text) for the owner | `characterId` |
| `set_character_notes` | write | Append or replace one `notes.pages` entry. Owner only | `characterId`, `mode` (`append`/`replace`), `text` |
| `add_character_note` | write | Inserts one `{ name, icon, color, contents }` page. Owner only | `characterId`, `title`, `contents` (`position` optional) |
| `edit_character_note` | write | Replaces one page's `contents` by `pageIndex` or stored `pageId`. Owner only | `characterId`, `contents`, `pageIndex` or `pageId` |
| `rename_character_note` | write | Changes one page's `name`. Owner only | `characterId`, `title`, `pageIndex` or `pageId` |
| `delete_character_note` | write | Removes one page. Other pages stay. Owner only | `characterId`, `pageIndex` or `pageId` |
| `upload_image` | write | PNG/JPEG/WebP through `upload-public-file`. Returns `{ url }`. Category `portraits` or `backgrounds` | `category` (+ `data` or `sourceUrl`) |
| `set_character_art` | write | Sets `details.image_url` (portrait) and/or `details.background_image_url`. `portraitData` / `backgroundData` upload first. Owner only | `characterId` (+ a URL or image data) |
| `list_options` | read | One catalog read by `kind` (class, ancestry, spell, item, …) | `kind` |
| `list_open_choices` | read | Unfilled builder selects with legal options | `characterId` |
| `list_spell_options` | read | Legal spells for one casting source | `characterId` |
| `choose` | write | Sets one option in a selection key, reruns operations | `characterId`, `choiceId`, `optionId` |
| `choose_many` | write | Batch `choose`: ordered picks, validated like `choose`, one read and one save; returns per-pick results and remaining open choices. Batch the picks you can decide now; a new batch when picks depend on the last one (about 5-7 for level 5). Added after this directory was generated (tool 96) | `characterId`, `picks[{choiceId, optionId}]` (1-50), `atomic?` |
| `set_identity` | write | Sets ancestry, background, or class | `characterId`, `slot`, `optionId` |
| `set_books` | write | Adds/removes enabled content sources | `characterId` |
| `add_spell` | write | Adds a spell to a source; optional `prepare` | `characterId`, `spellId`, `rank` |
| `remove_spell` | write | Removes a spell from a source and its prepared slots | `characterId`, `spellId` |
| `set_spells` | write | Replaces one source's spell list / prepared slots | `characterId` |
| `add_inventory_item` | write | Adds a catalog item to inventory, formula book, or container | `characterId`, `itemId` |
| `remove_inventory_item` | write | Removes one inventory entry (incl. inside containers) | `characterId`, `inventoryItemId` |
| `set_inventory_item` | write | Sets `is_equipped` and/or `is_invested` on an existing entry. Owner only. `item.hands` is returned, not written | `characterId`, `inventoryItemId` (+ `equipped` or `invested`) |
| `convert_coins` | read | Normalizes a coin amount at PF2e rates (1 pp = 10 gp = 100 sp = 1000 cp). Does not touch a character | `amount` |
| `give_money` | write | Adds coins to `inventory.coins` (`cp`/`sp`/`gp`/`pp`). `normalize:true` rebalances the purse | `characterId`, `amount` |
| `take_money` | write | Removes coins, breaking higher denominations; `INSUFFICIENT_FUNDS` if the purse is short | `characterId`, `amount` |
| `list_companions` | read | `companions.list`: type, name, level, added abilities, open selects | `characterId` |
| `add_companion` | write | Appends a catalog creature (companion type, or any creature that is not level -100) | `characterId`, `creatureId` |
| `update_companion` | write | Sets type (`creatureId`), name, `abilities_added`, or one operation select. Same list for animal companions, familiars, and eidolons | `characterId`, `index` |
| `remove_companion` | write | Removes `companions.list[index]` | `characterId`, `index` |

## Homebrew (30: 15 read, 15 write)

Create tools upsert: a `record` with `id` updates, omit `id` (or -1) to insert. Find tools take an optional `query` object limited to the filters the matching find-* function reads, and return official rows too.

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `wgui_ext_hb_find_content_source` | read | Content-source rows (id, foundry_id, group, homebrew, published) | none |
| `wgui_ext_hb_find_trait` | read | Trait rows | none |
| `wgui_ext_hb_find_ability_block` | read | Ability-block rows (type, name, traits, prereqs) | none |
| `wgui_ext_hb_find_ancestry` | read | Ancestry rows | none |
| `wgui_ext_hb_find_background` | read | Background rows | none |
| `wgui_ext_hb_find_class` | read | Class rows | none |
| `wgui_ext_hb_find_archetype` | read | Archetype rows | none |
| `wgui_ext_hb_find_versatile_heritage` | read | Versatile-heritage rows | none |
| `wgui_ext_hb_find_class_archetype` | read | Class-archetype rows | none |
| `wgui_ext_hb_find_item` | read | Item rows | none |
| `wgui_ext_hb_find_language` | read | Language rows | none |
| `wgui_ext_hb_find_creature` | read | Creature or hazard rows | none |
| `wgui_ext_hb_find_spell` | read | Spell rows | none |
| `wgui_ext_hb_find_content_update` | read | Content update proposals (by state, user, date) | none |
| `wgui_ext_hb_get_content_source_stats` | read | Source row and subscriber count | `content_source_id` |
| `wgui_ext_hb_create_content_source` | write | Upsert content source (needs Patreon tier 2) | `record` |
| `wgui_ext_hb_create_trait` | write | Upsert trait | `record` |
| `wgui_ext_hb_create_ability_block` | write | Upsert ability block | `record` |
| `wgui_ext_hb_create_ancestry` | write | Upsert ancestry | `record` |
| `wgui_ext_hb_create_background` | write | Upsert background | `record` |
| `wgui_ext_hb_create_class` | write | Upsert class | `record` |
| `wgui_ext_hb_create_archetype` | write | Upsert archetype | `record` |
| `wgui_ext_hb_create_versatile_heritage` | write | Upsert versatile heritage | `record` |
| `wgui_ext_hb_create_class_archetype` | write | Upsert class archetype | `record` |
| `wgui_ext_hb_create_item` | write | Upsert item | `record` |
| `wgui_ext_hb_create_language` | write | Upsert language | `record` |
| `wgui_ext_hb_create_creature` | write | Upsert creature | `record` |
| `wgui_ext_hb_create_spell` | write | Upsert spell | `record` |
| `wgui_ext_hb_create_content_update` | write | Insert a PENDING change proposal (does not write the content row) | `type`, `action`, `data`, `content_source_id` |
| `wgui_ext_hb_delete_content` | write | Delete a homebrew content row (character/campaign/encounter rejected) | `id`, `type` |

## Campaign and encounter create / update (7: 2 read, 5 write)

These tools call stock Wanderer's Guide functions (`find-campaign`, `create-campaign`, `find-encounter`, `create-encounter`). There is no `update-campaign` or `update-encounter`; updates POST the existing row to the matching `create-*` function. No new `wgui-ext-*` functions. No delete tools. Join keys are never returned.

Stock `find-encounter` is owner-only, so another user's encounter comes back empty and these tools return `NOT_FOUND`. `ENCOUNTER_FORBIDDEN` is only used when a row is actually returned and `user_id` is not the caller. Campaign writes use `CAMPAIGN_FORBIDDEN` the same way.

`get_campaign` is owner-only. Stock `find-campaign` can still return another user's campaign, and this tool answers `CAMPAIGN_FORBIDDEN` in that case (it does not return the row with `isOwner: false`). Campaign members are not allowed either; a character in the campaign is not enough. A missing campaign is `NOT_FOUND`. `isOwner` on a successful read is true.

`get_campaign` returns `id`, `name`, `image_url` (null when blank), `image_focus_y` (null when unset), `isOwner`, plus `description`, `notes`, `meta_data`, and `created_at`.

The encounter table has no `notes` column (`EncounterSchema` is name, icon, color, campaign_id, combatants, meta_data). `update_encounter` has no `notes` argument. Description is `meta_data.description`.

`list_campaigns` text caps every string at 120 characters (long `image_url` values included). `structuredContent` keeps the full strings.

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `list_campaigns` | read | Campaigns the caller owns (`find-campaign` `{ user_id }`) | none |
| `get_campaign` | read | One campaign the caller owns, including art fields `image_url`, `image_focus_y`, `isOwner`. Another owner's row is `CAMPAIGN_FORBIDDEN` | `campaignId` |
| `create_campaign` | write | Insert via `create-campaign`. Default name `My Campaign`, Phase 1 `meta_data.settings` | none (`name`, `description`, `notes`, `meta_data` optional) |
| `update_campaign` | write | Merge name/description/notes/`meta_data` then `create-campaign`. Does not clobber existing `meta_data` keys such as `image_url` | `campaignId` |
| `create_encounter` | write | Insert via `create-encounter`. Omit `campaignId` for standalone (`campaign_id: null`); pass it to file under an owned campaign | none (`name`, `description`, `campaignId`, `meta_data` optional) |
| `update_encounter` | write | Merge name/description/`meta_data` then `create-encounter`. No notes column. Does not change `campaign_id` | `encounterId` |
| `set_encounter_campaign` | write | Attach an owned encounter to an owned campaign, or detach (`campaignId` null) | `encounterId`, `campaignId` (nullable) |

## Known write gaps

No tool exists today for:

- **Companion drawer extras**: current HP, temp HP, conditions, inventory, spells, and notes on a companion. `list_companions` / `add_companion` / `update_companion` / `remove_companion` write the Companions panel list (catalog creature, name, `abilities_added`, operation selects). Animal companions, familiars, and eidolons share that list; witch familiar spells stay on `spells`.
