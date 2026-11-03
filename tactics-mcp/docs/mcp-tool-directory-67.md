# WGUI MCP tool directory (67 tools)

Generated Nov 3, 2026 from the live `wgui` MCP server tool list, with scopes checked against `READ_TOOLS` / `WRITE_TOOLS` in `src/server.ts`.

**67 tools: 39 require `read`, 28 require `write`.** Plus the 7 campaign/encounter create-update tools in the section below (2 read, 5 write), the live server now lists **74**. `tools/list` returns every tool for any token; scope is enforced at call time. The 16 encounter tools marked **GM** require `view: "gm"`. Groups: campaign / encounter / combat (22), character (15), homebrew `wgui_ext_hb_*` (30), plus campaign/encounter writes. Supersedes [mcp-tool-directory.md](./mcp-tool-directory.md) (61 tools, Oct 27). See [adr-oauth.md](./adr-oauth.md).

Common encounter params: `campaignId`, `encounterId`, and for per-combatant tools `combatantId`.

## Campaign, encounter, and combat (22: 19 read, 3 write)

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `get_profile` | read | Supabase user id for the token | none |
| `ensure_public_user` | write | Creates the caller's public_user row if missing (idempotent) | none |
| `join_campaign` | write | Attaches a character the caller owns to a campaign via join key | `characterId`, `joinKey` |
| `get_campaign_owner_contacts` | read | Email/display name of owners the caller shares a campaign with (max 24 ids) | `userIds` |
| `list_campaign_characters` | read | Campaign PC roster: id, name, level, ancestry, class | `campaignId` |
| `list_encounters` | read · GM | Encounters: id, name, combatant count | `view`, `campaignId` |
| `get_encounter` | read · GM | Name, round, difficulty, XP | `view`, `campaignId`, `encounterId` |
| `list_pcs` | read · GM | PCs fighting, benched, or down, with current HP | `view`, `campaignId`, `encounterId` |
| `list_combatants` | read · GM | Initiative, defenses, conditions, current HP for all combatants | `view`, `campaignId`, `encounterId` |
| `list_roster_edges` | read · GM | Benched/down PCs with current HP | `view`, `campaignId`, `encounterId` |
| `get_round_log` | read · GM | Round log lines | `view`, `campaignId`, `encounterId` |
| `get_dice_log` | read · GM | Dice tray state and saved dice log | `view`, `campaignId`, `encounterId` |
| `patch_encounter_dice` | write | Writes only dice tray (`diceRollState`) and/or dice log (`diceRollLog`) | `campaignId`, `encounterId` (+ one field) |
| `get_stat_block` | read · GM | Current HP, defenses, senses, speeds, ability mods | `view`, ids, `combatantId` |
| `list_ability_groups` | read · GM | Action groups with counts | `view`, ids, `combatantId` |
| `get_abilities` | read · GM | One action group: name, cost, traits, description | `view`, ids, `combatantId`, `group` |
| `get_feats` | read · GM | Feats, optional `section` filter | `view`, ids, `combatantId` |
| `get_class_features` | read · GM | Class features with level | `view`, ids, `combatantId` |
| `get_skills` | read · GM | Skill name, modifier, proficiency | `view`, ids, `combatantId` |
| `get_spells` | read · GM | Tradition, rank, spent slots | `view`, ids, `combatantId` |
| `get_character` | read · GM | PC inventory, notes, details, log | `view`, ids, `combatantId` |
| `get_monster` | read · GM | Creature inventory, notes, details, log | `view`, ids, `combatantId` |

## Character (15: 5 read, 10 write)

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `create_character` | write | Creates a character row; returns id, updated_at | none (`name`, `level` optional) |
| `delete_character` | write | Deletes a character the caller can read | `characterId` |
| `export_character` | read | Export as JSON (slim/full) or PDF; owner or campaign GM | `characterId` |
| `get_character_row` | read | Reads a character via find-character (`full` returns row) | none (`id`, `user_id`, `campaignId`) |
| `list_options` | read | One catalog read by `kind` (class, ancestry, spell, item, …) | `kind` |
| `list_open_choices` | read | Unfilled builder selects with legal options | `characterId` |
| `list_spell_options` | read | Legal spells for one casting source | `characterId` |
| `choose` | write | Sets one option in a selection key, reruns operations | `characterId`, `choiceId`, `optionId` |
| `set_identity` | write | Sets ancestry, background, or class | `characterId`, `slot`, `optionId` |
| `set_books` | write | Adds/removes enabled content sources | `characterId` |
| `add_spell` | write | Adds a spell to a source; optional `prepare` | `characterId`, `spellId`, `rank` |
| `remove_spell` | write | Removes a spell from a source and its prepared slots | `characterId`, `spellId` |
| `set_spells` | write | Replaces one source's spell list / prepared slots | `characterId` |
| `add_inventory_item` | write | Adds a catalog item to inventory, formula book, or container | `characterId`, `itemId` |
| `remove_inventory_item` | write | Removes one inventory entry (incl. inside containers) | `characterId`, `inventoryItemId` |

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

These tools call stock Wanderer's Guide functions (`find-campaign`, `create-campaign`, `find-encounter`, `create-encounter`). There is no `update-campaign` or `update-encounter`; updates POST the existing row to the matching `create-*` function. No new `wgui-ext-*` functions. No delete tools. Writes require the caller to own the campaign or encounter (`CAMPAIGN_FORBIDDEN` / `ENCOUNTER_FORBIDDEN`). Join keys are never returned.

`get_campaign` also appears on PR #20 (art-focused). This copy returns name, description, notes, and merged `meta_data` (including `image_url`) and still omits `join_key`.

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `list_campaigns` | read | Campaigns the caller owns (`find-campaign` `{ user_id }`) | none |
| `get_campaign` | read | One owned campaign (`find-campaign` `{ id }`) | `campaignId` |
| `create_campaign` | write | Insert via `create-campaign`. Default name `My Campaign`, Phase 1 `meta_data.settings` | none (`name`, `description`, `notes`, `meta_data` optional) |
| `update_campaign` | write | Merge name/description/notes/`meta_data` then `create-campaign`. Does not clobber existing `meta_data` keys such as `image_url` | `campaignId` |
| `create_encounter` | write | Insert via `create-encounter`. Omit `campaignId` for standalone (`campaign_id: null`); pass it to file under an owned campaign | none (`name`, `description`, `campaignId`, `meta_data` optional) |
| `update_encounter` | write | Merge name/description/`meta_data` then `create-encounter`. Does not change `campaign_id` | `encounterId` |
| `set_encounter_campaign` | write | Attach an owned encounter to an owned campaign, or detach (`campaignId` null) | `encounterId`, `campaignId` (nullable) |

## Known write gaps

No tool exists today for:

- **Character portrait / art / background image**: nothing sets them.
- **Character notes**: no read or write of notes as a standalone tool (`get_character` returns notes read-only, GM view).
- **Companions**: `choose` can pick a companion feat, but nothing creates or edits the companion (type, name, stats).
- **Equip / invest / wield**: `add_inventory_item` has no equipped or invested flag.
- **Creatures in an encounter**: nothing adds or removes combatants; the only encounter write is `patch_encounter_dice`.
- **Initiative**: `list_combatants` reads it; nothing rolls or writes it.
