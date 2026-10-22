# Connect Grokbot to Wanderer's Guide MCP tools

Updated: 2026-10-22. The MCP server is `tactics-mcp` (`wgui-tactics`), deployed at `https://wgui.wandersguide.site/mcp`. This is separate from AMBA. Do not point Grokbot at AMBA's `grokbotBridge.js`.

## Values for Grokbot

```text
WGUI_MCP_URL          https://wgui.wandersguide.site/mcp
WGUI_MCP_AUTH_MODE    custom OAuth, or bearer token, or the stdio bridge in this package
WGUI_MCP_CLIENT_ID    grokbot-wgui
WGUI_MCP_REDIRECT_URI https://www.cursor.com/agents/mcp/oauth/callback
```

`WGUI_MCP_TOKEN` is only for bearer or stdio mode. Create it from a signed-in Wanderer's Guide session. Do not put it in a prompt, tool argument, or repository file.

Override the registered pair on the MCP server with `GROKBOT_MCP_CLIENT_ID` and `GROKBOT_MCP_REDIRECT_URI`. The callback must be public HTTPS, with no userinfo, fragment, localhost name, or IP address. A mismatch is rejected. ChatGPT callbacks under `https://chatgpt.com/connector/oauth/<id>` stay allowed. Set `CHATGPT_MCP_CLIENT_ID` to pin that connector to one client id.

## Remote MCP

```text
Server name: wgui
Transport: Streamable HTTP
URL: https://wgui.wandersguide.site/mcp
Authentication: OAuth client grokbot-wgui, or Authorization: Bearer <WGUI_MCP_TOKEN>
```

OAuth endpoints:

| Purpose | URL |
| --- | --- |
| Authorize | `https://wgui.wandersguide.site/oauth/mcp/authorize` |
| Token | `https://wgui.wandersguide.site/oauth/mcp/token` |
| Protected resource metadata | `https://wgui.wandersguide.site/.well-known/oauth-protected-resource` |
| Authorization server metadata | `https://wgui.wandersguide.site/.well-known/oauth-authorization-server` |

Grokbot generates `state` and a PKCE verifier, opens authorize with `response_type=code`, `client_id=grokbot-wgui`, the exact redirect URI, `code_challenge_method=S256`, and `scope=read write`, then exchanges the code with the same client id, redirect URI, and verifier. The browser signs in with the same providers as the campaign UI. Granted scopes are the ones requested. Omitting `scope` grants `read` only, which still runs the lookup tools and does not run `ensure_public_user`, `join_campaign`, or `patch_encounter_dice`. Discovery advertises both scopes. An existing token that only has `read` keeps working for lookups until the next sign-in. Encounter reads still require GM view.

## stdio bridge

Official bridge for this server: `tactics-mcp/src/grokbotBridge.ts`. Build with `npx tsc` in `tactics-mcp`, then launch `node` on `dist/grokbotBridge.js` so npm output stays off stdout.

```json
{
  "mcpServers": {
    "wgui": {
      "command": "node",
      "args": ["<absolute-path>/tactics-mcp/dist/grokbotBridge.js"]
    }
  }
}
```

Set `WGUI_MCP_TOKEN` in that process. Optional `WGUI_MCP_URL` defaults to the URL above. HTTP is allowed only on loopback, with no credentials, query, or fragment. One process per user.

## Bot instructions

> Use only tools discovered from the wgui MCP server. Start with get_profile, then list_encounters or list_campaign_characters. Treat returned IDs as authoritative. Encounter reads need GM view. ensure_public_user, join_campaign, and patch_encounter_dice write data and need the write scope. patch_encounter_dice changes the dice tray and dice log only. Say what will change before using a write tool, and only when the user asked. Re-read state after a failed or successful write before retrying. Do not invent endpoints, tool names, or schemas. Keep tokens, authorization codes, PKCE verifiers, and cookies out of prompts, logs, and tool arguments.

## Checks

1. Discovery lists the tools in [mcp-tool-directory.md](./mcp-tool-directory.md).
2. `get_profile` returns the signed-in user.
3. List campaigns or encounters and read one record by a returned id.
4. A token with only `read` cannot call `ensure_public_user`, `join_campaign`, or `patch_encounter_dice`. A token with `write` can, and those tools still check ownership or campaign access.
5. Logs contain no token, code, or verifier.
