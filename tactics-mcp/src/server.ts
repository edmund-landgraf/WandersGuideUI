import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCatalog } from "./catalog.js";

export const TACTICS_MCP_VERSION = "1.0.0";

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
]);

export function scopeForTool(name: string) {
  return READ_TOOLS.has(name) ? "read" : null;
}

export function createTacticsMcpServer(userId: () => string, scopes: () => string[], origin: string) {
  const server = new McpServer({
    name: "wgui-readonly",
    title: "Wanderer's Guide",
    version: TACTICS_MCP_VERSION,
    description: "Read-only encounter and character data for the GM.",
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
  return server;
}
