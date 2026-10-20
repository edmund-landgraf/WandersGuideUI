import assert from "node:assert/strict";
import { test } from "node:test";
import { readPreparedStatBlock, readLiveStatBlock } from "../src/stat-block.js";
import { createSupabaseReader } from "../src/supabase-reader.js";
import { setEncounterReader, getEncounterReader } from "../src/reader.js";
import { registerCatalog } from "../src/catalog.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.SUPABASE_URL = "https://fixture.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
process.env.SUPABASE_ANON_KEY = "fixture";

// Read the actual UI variable engine, expression compiler, sense collector and
// status calculator. No remote data or mocked defense calculator is involved.
async function prepared(kind: "CHARACTER" | "CREATURE", empty = false) {
  const { sheetEnv } = await import("../src/live-sheet.js");
  sheetEnv();
  const { resetVariables, setVariable } = await import("../../src/process/variables/variable-manager.ts");
  const storeId = `${kind}_stat-regression`;
  resetVariables(storeId);
  setVariable(storeId, "LEVEL", 10);
  setVariable(storeId, "SENSES_PRECISE", empty ? [] : ["normal vision", "darkvision"]);
  setVariable(storeId, "SENSES_IMPRECISE", empty ? [] : ["scent, 30"]);
  setVariable(storeId, "SENSES_VAGUE", empty ? [] : ["lifesense, 60"]);
  setVariable(storeId, "RESISTANCES", empty ? [] : ["fire, 3", "fire, 5", "cold, -1"]);
  setVariable(storeId, "WEAKNESSES", empty ? [] : ["holy, {{floor(LEVEL / 2)}}"]);
  setVariable(storeId, "IMMUNITIES", empty ? [] : ["poison", "disease"]);
  setVariable(storeId, "SPEED", 25);
  setVariable(storeId, "SPEED_SWIM", 15);
  setVariable(storeId, "SPEED_FLY", 40);
  const entity = { name: "Fixture", level: 10, hp_current: 7, hp_temp: 4, details: { conditions: [] }, inventory: { items: [] }, operations: [], meta_data: {} };
  return { entity, content: { abilityBlocks: [], traits: [] }, storeId, kind } as unknown as import("../../src/pages/phase1/phase1-entity.ts").PreparedPhase1Entity;
}

for (const kind of ["CHARACTER", "CREATURE"] as const) {
  test(`${kind}: stat arrays use evaluated WG values, all sense categories and movement types`, async () => {
    const stats = await readPreparedStatBlock(await prepared(kind));
    assert.deepEqual(stats.sheet.resistances, ["Fire 5"]);
    assert.deepEqual(stats.sheet.weaknesses, ["Holy 5"]);
    assert.deepEqual(stats.sheet.immunities, ["Poison", "Disease"]);
    assert.deepEqual(stats.sheet.senses, ["Darkvision", "Scent (30 ft.)", "Lifesense (60 ft.)"]);
    assert.equal(stats.sheet.speeds?.swim, 15);
    assert.equal(stats.sheet.speeds?.fly, 40);
    assert.equal(Object.keys(stats.sheet.abilityModifiers!).length, 6);
    assert.equal(stats.row.tempHp, 4);
  });
}

test("empty defenses stay empty; exported creature operation fallbacks survive", async () => {
  const p = await prepared("CREATURE", true);
  let stats = await readPreparedStatBlock(p);
  for (const key of ["resistances", "weaknesses", "immunities", "senses"] as const) assert.deepEqual(stats.sheet[key], []);
  p.entity.operations = [
    { type: "adjValue", data: { variable: "WEAKNESSES", value: "cold iron, 10" } },
    { type: "adjValue", data: { variable: "RESISTANCES", value: "physical, 5" } },
    { type: "adjValue", data: { variable: "IMMUNITIES", value: "sleep" } },
  ] as never;
  stats = await readPreparedStatBlock(p);
  assert.deepEqual(stats.sheet.weaknesses, ["cold iron, 10"]);
  assert.deepEqual(stats.sheet.resistances, ["physical, 5"]);
  assert.deepEqual(stats.sheet.immunities, ["sleep"]);
});

test("invalid PC data fails explicitly rather than returning empty defense arrays", async () => {
  await assert.rejects(readLiveStatBlock({}, "character", "invalid"), /Full character details are unavailable/);
});

test("MCP stat block returns calculated arrays for PCs and creatures and retains existing detail arrays", async () => {
  const savedFetch = globalThis.fetch;
  const previousReader = getEncounterReader();
  const entity = { id: 7, name: "Fixture", level: 2, details: { conditions: [{ name: "frightened", value: 1 }] },
    meta_data: { calculated_stats: { profs: { SKILL_STEALTH: { total: 8, type: "T" } } } },
    abilities_base: [{ type: "action", name: "Strike", actions: "ONE-ACTION" }, { type: "feat", name: "Feat", actions: "ONE-ACTION", traits: [1437] }, { type: "class-feature", name: "Feature" }] };
  const rawStats = await readPreparedStatBlock(await prepared("CREATURE"));
  const calls: string[] = [];
  const characterQueries: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/campaign")) return Response.json([{ id: 1, user_id: "gm" }]);
    if (url.pathname.endsWith("/character")) {
      characterQueries.push(url.search);
      return Response.json([entity]);
    }
    if (url.pathname.endsWith("/encounter")) return Response.json([{ id: 2, campaign_id: 1, combatants: { list: [
      { _id: "pc", type: "CHARACTER", data: { id: 7 } }, { _id: "monster", type: "CREATURE", creature: entity },
    ] } }]);
    throw new Error(`Unexpected request ${url}`);
  };
  setEncounterReader(createSupabaseReader(async (_entity, kind, id) => { calls.push(`${kind}:${id}`); return rawStats; }));
  const server = new McpServer({ name: "stats-test", version: "1" });
  const client = new Client({ name: "stats-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  registerCatalog(server, () => "gm");
  try {
    await server.connect(st); await client.connect(ct);
    for (const id of ["pc", "monster"]) {
      const args = { campaignId: 1, encounterId: 2, combatantId: id, view: "gm" };
      const response = await client.callTool({ name: "get_stat_block", arguments: args });
      assert.ok(!response.isError);
      const text = response.content?.find((item) => item.type === "text")?.text ?? "";
      assert.match(text, /"hpCurrent"/);
      assert.match(text, /"conditions"/);
      const data = response.structuredContent!;
      for (const key of ["resistances", "weaknesses", "immunities", "senses"] as const) assert.deepEqual(data[key], rawStats.sheet[key]);
      assert.deepEqual(data.conditions, [{ name: "frightened", value: 1 }]);
      const record = await getEncounterReader().loadEncounter("gm", 1, 2);
      const sheet = record!.sheets[id];
      assert.equal(sheet.skills[0].name, "stealth");
      assert.equal(sheet.groups[0].actions[0].name, "Strike");
      assert.equal(sheet.classFeatures[0].name, "Feature");
      // Catalog hydration must not erase embedded creature/PC feats when no ids are available.
      assert.equal(sheet.feats[0]?.name, "Feat");
      assert.equal(sheet.feats[0]?.section, "general");
    }
    assert.deepEqual(calls, ["character:pc", "creature:monster"]);
    assert.ok(characterQueries.some((query) => query.includes("id=in.(7)")));
  } finally {
    await client.close(); await server.close(); globalThis.fetch = savedFetch; setEncounterReader(previousReader);
  }
});
