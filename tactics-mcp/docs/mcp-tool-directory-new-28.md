# WGUI MCP tool directory: 28 new tools

Generated Nov 3, 2026 from the live `wgui` MCP server tool list (main at `117c62d`, after PRs #20-#24), with scopes checked against `READ_TOOLS` / `WRITE_TOOLS` in `src/server.ts`. These are the tools added since the 67-tool directory as of `fcd0f62` (prod `0f98ec5`, 67 tools). 67 + 28 = 95. The full current list is [mcp-tool-directory-95.md](./mcp-tool-directory-95.md).

**28 tools: 5 require `read`, 23 require `write`.** `tools/list` returns every tool for any token; scope is enforced at call time. The 4 encounter tools marked **GM** require `view: "gm"`. Groups: campaign / encounter / combat (5), character (16), campaign/encounter create-update (7). No homebrew tools were added. See [adr-oauth.md](./adr-oauth.md).

Common encounter params: `campaignId`, `encounterId`, and for per-combatant tools `combatantId`.

## Campaign, encounter, and combat (5: 0 read, 5 write)

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `set_campaign_art` | write | Sets `meta_data.image_url` and/or `meta_data.image_focus_y`. `imageData` uploads via `upload-public-file` (`backgrounds`) first. Owner/GM only | `campaignId` (+ `imageUrl`, `imageData`, or `focusY`) |
| `add_encounter_combatant` | write ┬╖ GM | GM adds one joined PC (`wgui-ext-add-encounter-character`) or one catalog/homebrew creature (`wgui-ext-add-encounter-creature`). The reply includes that character or creature name. `ally` is for creatures | `view`, `campaignId`, `encounterId`, and one id |
| `remove_encounter_combatant` | write ┬╖ GM | GM removes one PC, creature, or hazard via `wgui-ext-remove-encounter-combatant`. Does not delete the character or catalog row | `view`, `campaignId`, `encounterId`, `combatantId` |
| `patch_encounter_combatant` | write ┬╖ GM | GM sets initiative, current HP, temp HP, and/or conditions via `wgui-ext-patch-encounter-combatant` | `view`, ids, `combatantId`, and one field |
| `roll_initiative` | write ┬╖ GM | GM rolls d20 + bonus via `wgui-ext-roll-initiative`. Reply names use the character or creature name. `rollBatch` counts initiative logs (older logs stored this as `round`). `scope` `empty` fills blanks; `all` rerolls. A repeated `clientRequestId` does not roll again | `view`, `campaignId`, `encounterId` |

## Character (16: 3 read, 13 write)

| Tool | Scope | What it does / returns | Required params |
| --- | --- | --- | --- |
| `get_character_notes` | read | `notes.pages` (name, icon, color, shared, contents, text) for the owner | `characterId` |
| `set_character_notes` | write | Append or replace one `notes.pages` entry. Owner only | `characterId`, `mode` (`append`/`replace`), `text` |
| `add_character_note` | write | Inserts one `{ name, icon, color, contents }` page. Owner only | `characterId`, `title`, `contents` (`position` optional) |
| `edit_character_note` | write | Replaces one page's `contents` by `pageIndex` or stored `pageId`. Owner only | `characterId`, `contents`, `pageIndex` or `pageId` |
| `rename_character_note` | write | Changes one page's `name`. Owner only | `characterId`, `title`, `pageIndex` or `pageId` |
| `delete_character_note` | write | Removes one page. Other pages stay. Owner only | `characterId`, `pageIndex` or `pageId` |
| `upload_image` | write | PNG/JPEG/WebP through `upload-public-file`. Returns `{ url }`. Category `portraits` or `backgrounds` | `category` (+ `data` or `sourceUrl`) |
| `set_character_art` | write | Sets `details.image_url` (portrait) and/or `details.background_image_url`. `portraitData` / `backgroundData` upload first. Owner only | `characterId` (+ a URL or image data) |
| `set_inventory_item` | write | Sets `is_equipped` and/or `is_invested` on an existing entry. Owner only. `item.hands` is returned, not written | `characterId`, `inventoryItemId` (+ `equipped` or `invested`) |
| `convert_coins` | read | Normalizes a coin amount at PF2e rates (1 pp = 10 gp = 100 sp = 1000 cp). Does not touch a character | `amount` |
| `give_money` | write | Adds coins to `inventory.coins` (`cp`/`sp`/`gp`/`pp`). `normalize:true` rebalances the purse | `characterId`, `amount` |
| `take_money` | write | Removes coins, breaking higher denominations; `INSUFFICIENT_FUNDS` if the purse is short | `characterId`, `amount` |
| `list_companions` | read | `companions.list`: type, name, level, added abilities, open selects | `characterId` |
| `add_companion` | write | Appends a catalog creature (companion type, or any creature that is not level -100) | `characterId`, `creatureId` |
| `update_companion` | write | Sets type (`creatureId`), name, `abilities_added`, or one operation select. Same list for animal companions, familiars, and eidolons | `characterId`, `index` |
| `remove_companion` | write | Removes `companions.list[index]` | `characterId`, `index` |

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
