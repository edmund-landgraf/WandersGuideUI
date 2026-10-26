import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCatalog } from "./catalog.js";
import { registerHomebrew } from "./homebrew-catalog.js";

export const TACTICS_MCP_VERSION = "1.0.0";
export const TACTICS_MCP_NAME = "wgui-tactics";
export const TACTICS_MCP_DESCRIPTION = "Encounter and character data for the GM. Mostly read-only, with scoped writes.";

const READ_TOOLS = new Set([
  "get_profile",
  "list_encounters",
  "get_encounter",
  "list_pcs",
  "list_combatants",
  "list_roster_edges",
  "get_round_log",
  "get_dice_log",
  "get_stat_block",
  "list_ability_groups",
  "get_abilities",
  "get_feats",
  "get_class_features",
  "get_skills",
  "get_spells",
  "get_character",
  "get_monster",
  "get_campaign_owner_contacts",
  "list_campaign_characters",
  "export_character",
  "get_character_row",
  "list_options",
  "list_open_choices",
  "wgui_ext_hb_find_content_source",
  "wgui_ext_hb_find_trait",
  "wgui_ext_hb_find_ability_block",
  "wgui_ext_hb_find_ancestry",
  "wgui_ext_hb_find_background",
  "wgui_ext_hb_find_class",
  "wgui_ext_hb_find_archetype",
  "wgui_ext_hb_find_versatile_heritage",
  "wgui_ext_hb_find_class_archetype",
  "wgui_ext_hb_find_item",
  "wgui_ext_hb_find_language",
  "wgui_ext_hb_find_creature",
  "wgui_ext_hb_find_spell",
  "wgui_ext_hb_find_content_update",
  "wgui_ext_hb_get_content_source_stats",
]);

const WRITE_TOOLS = new Set([
  "ensure_public_user",
  "join_campaign",
  "patch_encounter_dice",
  "create_character",
  "set_books",
  "set_identity",
  "choose",
  "delete_character",
  "wgui_ext_hb_create_content_source",
  "wgui_ext_hb_create_trait",
  "wgui_ext_hb_create_ability_block",
  "wgui_ext_hb_create_ancestry",
  "wgui_ext_hb_create_background",
  "wgui_ext_hb_create_class",
  "wgui_ext_hb_create_archetype",
  "wgui_ext_hb_create_versatile_heritage",
  "wgui_ext_hb_create_class_archetype",
  "wgui_ext_hb_create_item",
  "wgui_ext_hb_create_language",
  "wgui_ext_hb_create_creature",
  "wgui_ext_hb_create_spell",
  "wgui_ext_hb_create_content_update",
  "wgui_ext_hb_delete_content",
]);

export function scopeForTool(name: string) {
  if (WRITE_TOOLS.has(name)) return "write";
  return READ_TOOLS.has(name) ? "read" : null;
}

export function createTacticsMcpServer(userId: () => string, scopes: () => string[], origin: string) {
  const server = new McpServer({
    name: TACTICS_MCP_NAME,
    title: "Wanderer's Guide",
    version: TACTICS_MCP_VERSION,
    description: TACTICS_MCP_DESCRIPTION,
    websiteUrl: "https://wgui.wandersguide.site",
    icons: [{ src: `${origin}/icon.png`, mimeType: "image/png", sizes: ["512x512"] }],
  });
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: unknown, handler: (...args: never[]) => unknown) => {
    return register(name, config as never, (async (...args: never[]) => {
      // Scope is looked up from the resolved tool name before the handler runs.
      const needed = scopeForTool(name);
      if (!needed || !scopes().includes(needed)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `MCP token missing scope ${needed ?? "unknown"} for ${name}.` }],
          structuredContent: { code: "AUTH_REQUIRED", scope: needed, retryable: false },
        };
      }
      return handler(...args);
    }) as never);
  }) as typeof server.registerTool;

  registerCatalog(server, userId);
  registerHomebrew(server, userId);
  return server;
}
