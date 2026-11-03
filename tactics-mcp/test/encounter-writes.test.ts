import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { setCharacterFetch } from "../src/character-client.js";
import { registerCatalog } from "../src/catalog.js";
import { getEncounterReader, setEncounterReader, type EncounterReader } from "../src/reader.js";
import { createTacticsMcpServer } from "../src/server.js";
import { createSupabaseReader } from "../src/supabase-reader.js";
import { callerTokenKind } from "../../supabase/wgui-ext/_wgui-ext/caller-token.ts";
import { creatureForEncounter, placeCreature, type RosterCombatant } from "../../supabase/wgui-ext/_wgui-ext/creature-roster.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  jwt: process.env.JWT_SECRET,
  access: process.env.WG_ACCESS_TOKEN,
};

afterEach(() => {
  setCharacterFetch(null);
  globalThis.fetch = originalFetch;
  restore("SUPABASE_URL", originalEnv.url);
  restore("SUPABASE_ANON_KEY", originalEnv.anon);
  restore("SUPABASE_SERVICE_ROLE_KEY", originalEnv.service);
  restore("JWT_SECRET", originalEnv.jwt);
  restore("WG_ACCESS_TOKEN", originalEnv.access);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function token(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", "secret").update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

test("only a session JWT or the MCP server claim may call wgui-ext", () => {
  assert.equal(callerTokenKind(token({ sub: "user", session_id: "sess-1" })), "session");
  assert.equal(callerTokenKind(token({ sub: "user", wgui_mcp: true })), "mcp");
  assert.equal(callerTokenKind(token({ sub: "user", role: "authenticated" })), "rejected");
  assert.equal(callerTokenKind("not-a-jwt"), "rejected");
});

test("a second creature is numbered and an empty catalog HP starts at the health bonus", () => {
  const goblin = { id: 5, name: "Goblin", hp_current: 0, operations: [{ data: { variable: "MAX_HEALTH_BONUS", value: 16 } }] };
  const prepared = creatureForEncounter(goblin);
  assert.equal(prepared.hp_current, 16);
  assert.equal(goblin.hp_current, 0);

  const first: RosterCombatant = { _id: "a", type: "CREATURE", creature: { name: "Goblin" } };
  const placed = placeCreature([first], { _id: "b", type: "CREATURE", creature: prepared });
  assert.equal(placed[0].creature?.name, "Goblin (1)");
  assert.equal(placed[1].creature?.name, "Goblin (2)");
  assert.equal(placed[1].creature?.hp_current, 16);
  assert.equal(first.creature?.name, "Goblin");
});

test("encounter writes post the edge-function body and do not patch the encounter row", async () => {
  process.env.SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.JWT_SECRET = "jwt-secret";
  delete process.env.WG_ACCESS_TOKEN;
  const encounter = {
    id: 2,
    campaign_id: 1,
    meta_data: { untouched: true, encounter_revision: 4 },
    combatants: { list: [{ _id: "mob", type: "CREATURE", creature: { name: "Goblin" } }, { _id: "pc", type: "CHARACTER", character: 9 }] },
  };
  const calls: { url: string; method: string; body?: Record<string, unknown>; authorization?: string }[] = [];
  const handler: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body, authorization: headers.get("authorization") ?? undefined });
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/rest/v1/campaign")) return json([{ id: 1, user_id: "gm-1" }]);
    if (url.includes("/rest/v1/character?id=eq.9")) return json([{ id: 9, name: "Valeros" }]);
    if (url.includes("/rest/v1/character?campaign_id")) return json(url.includes("user_id=eq.player-1") ? [{ id: 3 }] : []);
    if (url.includes("/rest/v1/encounter") && method === "GET") return json([encounter]);
    if (url.includes("/rest/v1/encounter") && method !== "GET") return json({ error: "encounter row must not be written here" }, 500);
    if (url.endsWith("/functions/v1/wgui-ext-add-encounter-creature")) {
      return json({ status: "success", data: { combatant: { _id: "gob", type: "CREATURE", ally: true, creature: { name: "Goblin (2)", hp_current: 16 } }, encounter_revision: 5 } });
    }
    if (url.endsWith("/functions/v1/wgui-ext-add-encounter-character")) {
      return json({ status: "success", data: { combatant: { _id: "pc-2", type: "CHARACTER", ally: true, character: 9 }, encounter_revision: 5 } });
    }
    if (url.endsWith("/functions/v1/wgui-ext-remove-encounter-combatant")) {
      return json({ status: "success", data: { removed_combatant_id: body?.combatant_id, encounter_revision: 5 } });
    }
    if (url.endsWith("/functions/v1/wgui-ext-patch-encounter-combatant")) {
      return json({ status: "success", data: { combatant: { _id: "mob", type: "CREATURE", initiative: body?.initiative, creature: { name: "Goblin", hp_current: body?.hp_current, details: { conditions: body?.conditions } } }, encounter_revision: 5 } });
    }
    if (url.endsWith("/functions/v1/wgui-ext-roll-initiative")) {
      const rolls = body?.rolls as { combatant_id: string; bonus: number }[];
      const legacy = body?.client_request_id === "old-log";
      return json({
        status: "success",
        data: {
          rolled: rolls.map((roll) => ({
            _id: roll.combatant_id,
            type: roll.combatant_id === "pc-1" ? "CHARACTER" : "CREATURE",
            character: roll.combatant_id === "pc-1" ? 9 : undefined,
            initiative: 11 + roll.bonus,
            initiative_roll: { die: 11, bonus: roll.bonus, source: "Perception" },
            ...(roll.combatant_id === "pc-1" ? {} : { creature: { name: "Goblin" } }),
          })),
          initiative_log_entry: legacy
            ? { id: "log-old", round: 4, entries: [{ combatant_id: "pc-1", name: "Valeros" }] }
            : { id: "log-1", roll_batch: 2, entries: [{ combatant_id: "pc-1", name: "Valeros" }] },
          encounter_revision: 5,
          idempotent: false,
        },
      });
    }
    if (url.includes("/functions/v1/")) return json({ status: "fail", data: { message: "unexpected function", code: "UNEXPECTED" } }, 404);
    return json({ message: url }, 500);
  };
  globalThis.fetch = handler;
  setCharacterFetch(handler);

  const reader = createSupabaseReader();
  const player = await reader.addEncounterCombatant("player-1", 1, 2, { creatureId: 5 });
  assert.equal(player.ok, false);
  if (player.ok) return;
  assert.equal(player.code, "GM_REQUIRED");
  assert.equal(calls.some((call) => call.url.includes("/functions/v1/")), false);
  assert.equal(calls.some((call) => call.method === "PATCH"), false);

  calls.length = 0;
  const added = await reader.addEncounterCombatant("gm-1", 1, 2, { creatureId: 5, ally: true, encounterRevision: 4 });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.data.name, "Goblin (2)");
  assert.equal(added.data.hpCurrent, 16);
  assert.equal(added.data.encounterRevision, 5);
  const creatureCall = calls.find((call) => call.url.endsWith("/functions/v1/wgui-ext-add-encounter-creature"));
  assert.ok(creatureCall);
  assert.equal(creatureCall.method, "POST");
  assert.deepEqual(creatureCall.body, { campaign_id: 1, encounter_id: 2, creature_id: 5, ally: true, encounter_revision: 4 });
  const claims = JSON.parse(Buffer.from(creatureCall.authorization!.replace("Bearer ", "").split(".")[1], "base64url").toString());
  assert.equal(claims.sub, "gm-1");
  assert.equal(claims.wgui_mcp, true);
  assert.equal(claims.session_id, undefined);

  const pc = await reader.addEncounterCombatant("gm-1", 1, 2, { characterId: 9 });
  assert.equal(pc.ok, true);
  if (!pc.ok) return;
  assert.equal(pc.data.kind, "character");
  assert.equal(pc.data.combatantId, "pc-2");
  assert.equal(pc.data.name, "Valeros");
  const characterCall = calls.find((call) => call.url.endsWith("/functions/v1/wgui-ext-add-encounter-character"));
  assert.deepEqual(characterCall?.body, { campaign_id: 1, encounter_id: 2, character_id: 9, encounter_revision: 4 });

  const removed = await reader.removeEncounterCombatant("gm-1", 1, 2, "mob");
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(removed.data.removedCombatantId, "mob");
  const removeCall = calls.find((call) => call.url.endsWith("/functions/v1/wgui-ext-remove-encounter-combatant"));
  assert.deepEqual(removeCall?.body, { campaign_id: 1, encounter_id: 2, combatant_id: "mob", encounter_revision: 4 });

  const patched = await reader.patchEncounterCombatant("gm-1", 1, 2, "mob", { initiative: 12, hpCurrent: 3, conditions: [{ name: "Frightened", value: 1 }] });
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  assert.equal(patched.data.initiative, 12);
  assert.equal(patched.data.hpCurrent, 3);
  const patchCall = calls.find((call) => call.url.endsWith("/functions/v1/wgui-ext-patch-encounter-combatant"));
  assert.deepEqual(patchCall?.body, {
    campaign_id: 1,
    encounter_id: 2,
    combatant_id: "mob",
    encounter_revision: 4,
    initiative: 12,
    hp_current: 3,
    conditions: [{ name: "Frightened", value: 1 }],
  });

  const rolled = await reader.rollInitiative("gm-1", 1, 2, { scope: "all", combatantIds: ["mob"] });
  assert.equal(rolled.ok, true);
  if (!rolled.ok) return;
  assert.equal(rolled.data.rolled[0].initiative, 11);
  assert.equal(rolled.data.rolled[0].name, "Goblin");
  assert.equal(rolled.data.rollBatch, 2);
  const pcRoll = await reader.rollInitiative("gm-1", 1, 2, { scope: "all", rolls: [{ combatantId: "pc-1", bonus: 3, source: "Perception" }], clientRequestId: "old-log" });
  assert.equal(pcRoll.ok, true);
  if (!pcRoll.ok) return;
  assert.equal(pcRoll.data.rolled[0].name, "Valeros");
  assert.equal(pcRoll.data.rollBatch, 4);
  const rollCall = calls.find((call) => call.url.endsWith("/functions/v1/wgui-ext-roll-initiative"));
  assert.deepEqual(rollCall?.body, {
    campaign_id: 1,
    encounter_id: 2,
    encounter_revision: 4,
    scope: "all",
    rolls: [{ combatant_id: "mob", bonus: 0, source: "" }],
  });
  assert.equal(calls.some((call) => call.method === "PATCH" || (call.method === "POST" && call.url.includes("/rest/v1/encounter"))), false);
});

test("a function failure is returned with the function's code", async () => {
  process.env.SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.JWT_SECRET = "jwt-secret";
  delete process.env.WG_ACCESS_TOKEN;
  const handler: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/rest/v1/campaign")) return json([{ id: 1, user_id: "gm-1" }]);
    if (url.includes("/rest/v1/character?campaign_id")) return json([]);
    if (url.includes("/rest/v1/encounter") && method === "GET") return json([{ id: 2, campaign_id: 1, meta_data: {}, combatants: { list: [] } }]);
    if (url.endsWith("/functions/v1/wgui-ext-add-encounter-character")) {
      return json({ status: "fail", data: { message: "That character is not joined to this campaign.", code: "CHARACTER_NOT_IN_CAMPAIGN" } }, 403);
    }
    return json({ message: url }, 500);
  };
  globalThis.fetch = handler;
  setCharacterFetch(handler);
  const result = await createSupabaseReader().addEncounterCombatant("gm-1", 1, 2, { characterId: 4, encounterRevision: 0 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "CHARACTER_NOT_IN_CAMPAIGN");
  assert.match(result.message, /not joined/);
});

test("encounter write tools require gm view and the write scope", async () => {
  const original = getEncounterReader();
  const calls: string[] = [];
  setEncounterReader({
    ...original,
    async addEncounterCombatant() {
      calls.push("add");
      return { ok: true, data: { combatantId: "new", name: null, kind: "character", ally: true, initiative: null, hpCurrent: null, encounterRevision: 2 } };
    },
  } as EncounterReader);
  const granted = { scopes: ["read", "write"] };
  const server = createTacticsMcpServer(() => "gm-1", () => granted.scopes, "http://127.0.0.1");
  const client = new Client({ name: "encounter-writes", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const deniedView = await client.callTool({
      name: "add_encounter_combatant",
      arguments: { view: "player", campaignId: 1, encounterId: 2, characterId: 9 },
    });
    assert.equal(deniedView.isError, true);
    assert.match(String((deniedView.content?.[0] as { text?: string }).text), /view must be gm|expected .*gm/);
    assert.deepEqual(calls, []);

    const added = await client.callTool({
      name: "add_encounter_combatant",
      arguments: { view: "gm", campaignId: 1, encounterId: 2, characterId: 9 },
    });
    assert.equal(added.isError, undefined);
    assert.match(JSON.stringify(added.structuredContent), /"combatantId":"new"/);

    granted.scopes = ["read"];
    const deniedScope = await client.callTool({
      name: "roll_initiative",
      arguments: { view: "gm", campaignId: 1, encounterId: 2, combatantIds: ["mob"] },
    });
    assert.equal(deniedScope.isError, true);
    assert.match(String((deniedScope.content?.[0] as { text?: string }).text), /missing scope write/);
  } finally {
    await client.close();
    await server.close();
    setEncounterReader(original);
  }
});

test("get_encounter reports the revision the roster writes send", async () => {
  const original = getEncounterReader();
  setEncounterReader({
    ...original,
    async loadEncounter() {
      return {
        campaignId: 1,
        encounterId: 2,
        name: "Ambush",
        round: 1,
        encounterRevision: 6,
        combatants: [],
        roundLog: [],
        diceLog: [],
        sheets: {},
      };
    },
  } as EncounterReader);
  const server = new McpServer({ name: "revision-test", version: "1" });
  const client = new Client({ name: "revision-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerCatalog(server, () => "gm-1");
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "get_encounter", arguments: { view: "gm", campaignId: 1, encounterId: 2 } });
    assert.match(String((response.content?.[0] as { text?: string }).text), /Revision: 6/);
    assert.equal((response.structuredContent as { encounterRevision?: number }).encounterRevision, 6);
  } finally {
    await client.close();
    await server.close();
    setEncounterReader(original);
  }
});
