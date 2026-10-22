import { createHash, randomBytes } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startTacticsHttp } from "./http.js";
import { setEncounterReader, type EncounterReader } from "./reader.js";
import { resetTokens } from "./tokens.js";
import { resetCodes } from "./oauth.js";

process.env.TACTICS_MCP_DEV_MINT = "1";
process.env.TACTICS_MCP_PORT = "3194";
resetTokens();
resetCodes();

const fixture: EncounterReader = {
  async profile(userId) {
    return { id: userId, email: "gm@example.com", name: "GM" };
  },
  async listEncounters() {
    return [{ id: 44, name: "s2", combatantCount: 2 }];
  },
  async loadEncounter() {
    return {
      campaignId: 44,
      encounterId: 44,
      name: "s2",
      round: 1,
      difficulty: "Extreme",
      xp: 160,
      combatants: [
        { id: "pc", name: "Joey Turtle", side: "ally", kind: "character", level: 3, place: "fighting", hpCurrent: 15, hpMax: 32, conditions: [], ac: 16, fortitude: 7, reflex: 6, will: 9 },
        { id: "mob", name: "Shikigami", side: "enemy", kind: "creature", level: 1, place: "fighting", hpCurrent: 25, hpMax: 25, conditions: [] },
      ],
      roundLog: [],
      diceLog: [],
      sheets: {
        pc: { groups: [{ id: "weapon-attacks", label: "Weapon Attacks", actions: [{ name: "Jaws", actions: 1 }] }], feats: [], classFeatures: [], skills: [{ name: "Athletics", modifier: 5 }], spells: [], senses: ["low-light vision"] },
        mob: { groups: [], feats: [], classFeatures: [], skills: [], spells: [] },
      },
    };
  },
  async ensurePublicUser(userId) {
    return { ok: true, data: { userId, displayName: "GM", created: false } };
  },
  async joinCampaign(_userId, characterId) {
    return { ok: true, data: { characterId, campaignId: 44, campaignName: "s2", already: true } };
  },
  async campaignOwnerContacts() {
    return { ok: true, data: [] };
  },
  async patchEncounterDice() {
    return { ok: true, data: { diceRollState: {}, diceRollLog: [] } };
  },
  async listCampaignCharacters() {
    return { ok: true, data: [{ id: 7, name: "Joey Turtle", level: 3, ancestry: "Kobold", className: "Kineticist" }] };
  },
  async exportCharacter(_userId, _characterId, format = "json") {
    return format === "pdf"
      ? { ok: true, data: { format: "pdf", filename: "character-7.pdf", mimeType: "application/pdf", base64: "JVBERi0x" } }
      : { ok: true, data: { format: "json", file: { name: "Joey Turtle" } } };
  },
};
setEncounterReader(fixture);

const server = startTacticsHttp();
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:3194";

const health = await fetch(`${base}/health`);
const healthBody = await health.json() as { surface?: string };
if (!health.ok || healthBody.surface !== "wgui-tactics") throw new Error("health");

const discovery = await fetch(`${base}/.well-known/oauth-protected-resource`);
const discoveryBody = await discovery.json() as { scopes_supported?: string[] };
if (!discovery.ok || discoveryBody.scopes_supported?.join(" ") !== "read write") throw new Error("discovery should be public");

const missing = await fetch(`${base}/mcp`);
if (missing.status !== 401) throw new Error(`mcp 401, got ${missing.status}`);
if (!missing.headers.get("www-authenticate")?.includes("resource_metadata")) throw new Error("missing resource_metadata");

const minted = await fetch(`${base}/api/mcp-tokens`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-wgui-user": "user-1" },
  body: JSON.stringify({ label: "smoke" }),
});
if (minted.status !== 201) throw new Error(`mint ${minted.status}`);
const secret = (await minted.json() as { token: string }).token;

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorized = await fetch(`${base}/oauth/mcp/authorize`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
  body: JSON.stringify({ code_challenge: challenge, redirect_uri: "http://localhost/cb" }),
});
const code = (await authorized.json() as { code: string }).code;
const traded = await fetch(`${base}/oauth/mcp/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: "http://localhost/cb" }),
});
const tradedBody = await traded.json() as { access_token?: string; scope?: string };
if (traded.status !== 200 || tradedBody.scope !== "read" || !tradedBody.access_token) throw new Error(`token ${traded.status} ${tradedBody.scope ?? ""}`);
const access = tradedBody.access_token;

const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${access}` } },
});
const client = new Client({ name: "wgui-smoke", version: "0.1.0" });
await client.connect(transport);
const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
if (!names.includes("get_stat_block") || !names.includes("get_profile") || !names.includes("export_character")) throw new Error(names.join(","));
const profile = JSON.stringify(await client.callTool({ name: "get_profile", arguments: {} }));
if (!profile.includes("gm@example.com")) throw new Error(profile);
const hurt = JSON.stringify(await client.callTool({ name: "list_pcs", arguments: { view: "gm", campaignId: 44, encounterId: 44 } }));
if (!hurt.includes("15") || !hurt.includes("32")) throw new Error(hurt);
const wrongKind = JSON.stringify(await client.callTool({ name: "get_monster", arguments: { view: "gm", campaignId: 44, encounterId: 44, combatantId: "pc" } }));
if (!wrongKind.includes("NOT_FOUND")) throw new Error(wrongKind);
const wrongView = JSON.stringify(await client.callTool({ name: "list_pcs", arguments: { view: "player", campaignId: 44, encounterId: 44 } }));
if (!wrongView.includes("VALIDATION_ERROR") && !wrongView.includes("expected \\\"gm\\\"")) throw new Error(wrongView);
await client.close();
server.close();
console.log("wgui MCP smoke ok");
