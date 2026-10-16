import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseReader } from "../src/supabase-reader.js";
import { getEncounterReader, setEncounterReader } from "../src/reader.js";
import { registerCatalog } from "../src/catalog.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("explicit casualties override positive HP in roster and stat block; restoring keeps HP", async () => {
  const originalFetch = globalThis.fetch;
  const originalReader = getEncounterReader();
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const originalEnv = keys.map((key) => process.env[key]);
  process.env.SUPABASE_URL = "https://fixture.invalid";
  process.env.SUPABASE_ANON_KEY = "fixture";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  let restored = false;
  const creature = (hp: number) => ({ name: "Rootling", hp_current: hp, meta_data: { calculated_stats: { hp_max: 18 } } });
  const character = { id: 7, name: "PC", hp_current: 5 };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/campaign")) return Response.json([{ id: 1, user_id: "gm" }]);
    if (url.pathname.endsWith("/character")) return Response.json([character]);
    if (url.pathname.endsWith("/encounter")) return Response.json([{
      id: 2, campaign_id: 1, combatants: { list: [
        { _id: "rootling1", type: "CREATURE", creature: creature(2), ...(restored ? {} : { out: "dead" }) },
        { _id: "rootling2", type: "CREATURE", creature: creature(1), out: "dead" },
        { _id: "incap", type: "CREATURE", creature: creature(4), out: "incapacitated" },
        { _id: "zero", type: "CREATURE", creature: creature(0) },
        { _id: "active", type: "CREATURE", creature: creature(10) },
        { _id: "pc", type: "CHARACTER", character: 7, out: "incapacitated" },
      ] },
    }]);
    throw new Error(`Unexpected request ${url}`);
  };
  // Stat calculation must not overwrite encounter HP or explicit casualty flags.
  setEncounterReader(createSupabaseReader(async () => ({ row: { hpMax: 18 }, sheet: {} })));
  const server = new McpServer({ name: "out-test", version: "1" });
  const client = new Client({ name: "out-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  registerCatalog(server, () => "gm");
  try {
    await server.connect(st); await client.connect(ct);
    const args = { campaignId: 1, encounterId: 2, view: "gm" };
    let response = await client.callTool({ name: "list_combatants", arguments: args });
    assert.ok(!response.isError);
    const rows = response.structuredContent!.combatants as Array<Record<string, unknown>>;
    assert.deepEqual(rows.map(({ id, hpCurrent, place, out }) => ({ id, hpCurrent, place, out })), [
      { id: "rootling1", hpCurrent: 2, place: "down", out: "dead" },
      { id: "rootling2", hpCurrent: 1, place: "down", out: "dead" },
      { id: "incap", hpCurrent: 4, place: "down", out: "incapacitated" },
      { id: "zero", hpCurrent: 0, place: "down", out: null },
      { id: "active", hpCurrent: 10, place: "fighting", out: null },
      { id: "pc", hpCurrent: 5, place: "down", out: "incapacitated" },
    ]);
    response = await client.callTool({ name: "get_stat_block", arguments: { ...args, combatantId: "rootling1" } });
    assert.ok(!response.isError);
    assert.equal(response.structuredContent!.out, "dead");
    assert.equal(response.structuredContent!.place, "down");
    assert.equal(response.structuredContent!.hpCurrent, 2);
    restored = true;
    response = await client.callTool({ name: "list_combatants", arguments: args });
    const first = (response.structuredContent!.combatants as Array<Record<string, unknown>>)[0];
    assert.equal(first.out, null);
    assert.equal(first.place, "fighting");
    assert.equal(first.hpCurrent, 2);
  } finally {
    await client.close(); await server.close(); globalThis.fetch = originalFetch; setEncounterReader(originalReader);
    keys.forEach((key, i) => { if (originalEnv[i] === undefined) delete process.env[key]; else process.env[key] = originalEnv[i]; });
  }
});
