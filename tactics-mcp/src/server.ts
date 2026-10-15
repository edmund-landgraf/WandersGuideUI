import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCatalog } from "./catalog.js";

export const TACTICS_MCP_VERSION = "0.2.0";

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

export function createTacticsMcpServer(userId: () => string, scopes: () => string[]) {
  const server = new McpServer({ name: "wgui-readonly", version: TACTICS_MCP_VERSION });
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
