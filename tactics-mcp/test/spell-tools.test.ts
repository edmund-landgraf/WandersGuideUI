import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterFetch } from "../src/character-client.js";
import { registerCatalog } from "../src/catalog.js";
import { maxSpellRank, parseCastingSources, setSpellcastingRunner } from "../src/character-spells.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SPELLS = [
  { id: 1, name: "Electric Arc", rank: 0, traditions: ["arcane", "primal"], rarity: "COMMON" },
  { id: 2, name: "Tangle Vine", rank: 0, traditions: ["primal"], rarity: "COMMON" },
  { id: 3, name: "Heal", rank: 1, traditions: ["divine", "primal"], rarity: "COMMON" },
  { id: 4, name: "Fireball", rank: 3, traditions: ["arcane", "primal"], rarity: "COMMON" },
  { id: 5, name: "Daze", rank: 0, traditions: ["arcane", "divine", "occult"], rarity: "COMMON" },
  { id: 6, name: "Rare Leaf", rank: 1, traditions: ["primal"], rarity: "RARE" },
  { id: 7, name: "Fear", rank: 1, traditions: ["arcane", "divine", "occult", "primal"], rarity: "COMMON" },
];

function caster(id: number, value: string, spells?: unknown) {
  return {
    id,
    name: `caster-${id}`,
    level: 1,
    updated_at: "2026-10-27T00:00:00.000Z",
    content_sources: { enabled: [1, 842] },
    details: { class: { name: "Test" } },
    casting: value,
    ...(spells === undefined ? {} : { spells }),
  };
}

async function harness(start: Record<string, unknown>) {
  let character = start;
  setSpellcastingRunner(async (row) => ({
    sources: parseCastingSources([row.casting]),
    slots: [
      { rank: 0, source: String(row.casting).split(":::")[0], amount: 5 },
      { rank: 1, source: String(row.casting).split(":::")[0], amount: 1 },
    ],
  }));
  const updates: Record<string, unknown>[] = [];
  const spellCalls: Record<string, unknown>[] = [];
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/find-character")) return jsonResponse({ status: "success", data: character });
    if (url.endsWith("/find-spell")) {
      spellCalls.push(body);
      assert.deepEqual(body.content_sources, [3, 1, 842]);
      const ids = Array.isArray(body.id) ? body.id : undefined;
      return jsonResponse({ status: "success", data: ids ? SPELLS.filter((s) => ids.includes(s.id)) : SPELLS });
    }
    if (url.endsWith("/update-character")) {
      assert.equal(body.expected_updated_at, character.updated_at);
      updates.push(body);
      character = { ...character, ...body, updated_at: `2026-10-27T00:0${updates.length}:00.000Z` };
      return jsonResponse({ status: "success", data: character });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, updates, spellCalls, current: () => character };
}

test("casting sources parse CASTING_SOURCES values", () => {
  const sources = parseCastingSources(["SUMMONER:::SPONTANEOUS-REPERTOIRE:::PRIMAL:::ATTRIBUTE_CHA", 3]);
  assert.deepEqual(sources, [{ name: "SUMMONER", type: "SPONTANEOUS-REPERTOIRE", tradition: "PRIMAL", attribute: "ATTRIBUTE_CHA" }]);
  assert.equal(maxSpellRank(1), 1);
  assert.equal(maxSpellRank(5), 3);
});

test("list_spell_options filters by tradition, rank, and rarity", async () => {
  const { client } = await harness(caster(80, "SUMMONER:::SPONTANEOUS-REPERTOIRE:::PRIMAL:::ATTRIBUTE_CHA"));
  const all = await client.callTool({ name: "list_spell_options", arguments: { characterId: 80 } });
  const out = all.structuredContent as { max_rank: number; options: { id: number }[] };
  assert.equal(out.max_rank, 1);
  assert.deepEqual((all.structuredContent as { slots: unknown[] }).slots.length, 2);
  assert.deepEqual(out.options.map((o) => o.id), [1, 2, 7, 3]);
  const cantrips = await client.callTool({ name: "list_spell_options", arguments: { characterId: 80, rank: 0 } });
  assert.deepEqual((cantrips.structuredContent as { options: { id: number }[] }).options.map((o) => o.id), [1, 2]);
  const rare = await client.callTool({ name: "list_spell_options", arguments: { characterId: 80, rank: 1, includeUncommon: true } });
  assert.ok((rare.structuredContent as { options: { id: number }[] }).options.some((o) => o.id === 6));
});

test("add_spell writes the ManageSpellsModal list entry and rejects illegal spells", async () => {
  const { client, updates, current } = await harness(caster(80, "SUMMONER:::SPONTANEOUS-REPERTOIRE:::PRIMAL:::ATTRIBUTE_CHA"));
  const added = await client.callTool({ name: "add_spell", arguments: { characterId: 80, spellId: 2, rank: 0 } });
  assert.equal(added.isError, undefined);
  assert.deepEqual(current().spells, {
    slots: [],
    list: [{ spell_id: 2, rank: 0, source: "SUMMONER" }],
    focus_point_current: 0,
    innate_casts: [],
  });
  const again = await client.callTool({ name: "add_spell", arguments: { characterId: 80, spellId: 2, rank: 0 } });
  assert.equal(again.isError, undefined);
  assert.equal((current().spells as { list: unknown[] }).list.length, 1);

  for (const [spellId, rank, pattern] of [
    [999, 1, /not in the character's enabled books/],
    [5, 0, /not on the primal list/],
    [3, 0, /not a cantrip/],
    [2, 1, /cantrip; use rank 0/],
    [4, 3, /Rank 3 is above/],
  ] as const) {
    const bad = await client.callTool({ name: "add_spell", arguments: { characterId: 80, spellId, rank } });
    assert.equal(bad.isError, true, String(spellId));
    assert.match(JSON.stringify(bad.content), pattern);
  }
  const notPrepared = await client.callTool({ name: "add_spell", arguments: { characterId: 80, spellId: 3, rank: 1, prepare: true } });
  assert.equal(notPrepared.isError, true);
  assert.equal(updates.length, 2);

  const removed = await client.callTool({ name: "remove_spell", arguments: { characterId: 80, spellId: 2 } });
  assert.equal(removed.isError, undefined);
  assert.deepEqual((current().spells as { list: unknown[] }).list, []);
});

test("set_spells replaces one source's list and prepared slots and keeps the rest", async () => {
  const start = caster(81, "NECROMANCER:::PREPARED-LIST:::OCCULT:::ATTRIBUTE_INT", {
    slots: [{ rank: 0, source: "OTHER", spell_id: 9 }, { rank: 0, source: "NECROMANCER", spell_id: 5 }],
    list: [{ spell_id: 9, rank: 0, source: "OTHER" }],
    focus_point_current: 1,
    innate_casts: [{ spell_id: 8 }],
  });
  const { client, updates, current } = await harness(start);
  const bad = await client.callTool({
    name: "set_spells",
    arguments: { characterId: 81, prepared: [{ spellId: 5, rank: 0 }, { spellId: 2, rank: 0 }] },
  });
  assert.equal(bad.isError, true);
  assert.match(JSON.stringify(bad.structuredContent), /Tangle Vine is not on the occult list/);
  assert.equal(updates.length, 0);

  const tooMany = await client.callTool({
    name: "set_spells",
    arguments: { characterId: 81, prepared: [{ spellId: 7, rank: 1 }, { spellId: 7, rank: 1 }] },
  });
  assert.equal(tooMany.isError, true);
  assert.match(JSON.stringify(tooMany.structuredContent), /1 rank 1 slots; 2 prepared/);

  const ok = await client.callTool({
    name: "set_spells",
    arguments: { characterId: 81, prepared: [{ spellId: 5, rank: 0 }, { spellId: 7, rank: 1 }] },
  });
  assert.equal(ok.isError, undefined);
  assert.deepEqual(current().spells, {
    slots: [
      { rank: 0, source: "OTHER", spell_id: 9 },
      { rank: 0, source: "NECROMANCER", spell_id: 5 },
      { rank: 1, source: "NECROMANCER", spell_id: 7 },
    ],
    list: [{ spell_id: 9, rank: 0, source: "OTHER" }],
    focus_point_current: 1,
    innate_casts: [{ spell_id: 8 }],
  });
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0]).sort(), ["expected_updated_at", "id", "spells"]);
});
