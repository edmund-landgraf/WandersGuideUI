import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterFetch } from "../src/character-client.js";
import {
  copperValue,
  giveCoins,
  normalizeCoins,
  parseCoinAmount,
  takeCoins,
  type Coins,
} from "../src/character-coins.js";
import { registerCatalog } from "../src/catalog.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

const z = (over: Partial<Coins> = {}): Coins => ({ cp: 0, sp: 0, gp: 0, pp: 0, ...over });

test("normalizeCoins uses 1 pp = 10 gp = 100 sp = 1000 cp", () => {
  assert.deepEqual(normalizeCoins(z({ cp: 1000000 })), z({ pp: 1000 }));
  assert.deepEqual(normalizeCoins(z({ cp: 1234 })), z({ pp: 1, gp: 2, sp: 3, cp: 4 }));
  assert.deepEqual(normalizeCoins(z({ cp: 0 })), z());
  assert.deepEqual(normalizeCoins(z({ cp: 9 })), z({ cp: 9 }));
  assert.deepEqual(normalizeCoins(z({ sp: 10 })), z({ gp: 1 }));
  assert.deepEqual(normalizeCoins(z({ sp: 9, cp: 9 })), z({ sp: 9, cp: 9 }));
  assert.deepEqual(normalizeCoins(z({ gp: 5, sp: 3 })), z({ gp: 5, sp: 3 }));
  assert.deepEqual(normalizeCoins(z({ pp: 1, gp: 10, sp: 100, cp: 1000 })), z({ pp: 4 }));
  assert.equal(copperValue(normalizeCoins(z({ cp: 1234 }))), 1234);
});

test("parseCoinAmount accepts objects and coin strings", () => {
  assert.deepEqual(parseCoinAmount({ cp: 1000000 }), { ok: true, coins: z({ cp: 1000000 }) });
  assert.deepEqual(parseCoinAmount({ gp: 5, sp: 3 }), { ok: true, coins: z({ gp: 5, sp: 3 }) });
  assert.deepEqual(parseCoinAmount("1000000 cp"), { ok: true, coins: z({ cp: 1000000 }) });
  assert.deepEqual(parseCoinAmount("5 gp, 3 sp"), { ok: true, coins: z({ gp: 5, sp: 3 }) });
  assert.deepEqual(parseCoinAmount("1pp 2gp"), { ok: true, coins: z({ pp: 1, gp: 2 }) });
  assert.equal(parseCoinAmount("no coins").ok, false);
  assert.equal(parseCoinAmount("5 gp and a sword").ok, false);
  assert.equal(parseCoinAmount({ cp: 0 }).ok, false);
  assert.equal(parseCoinAmount("0 cp").ok, false);
});

test("takeCoins breaks higher coins, spends lower only when needed, and never goes negative", () => {
  assert.deepEqual(takeCoins(z({ gp: 5, sp: 3 }), z({ gp: 2, sp: 1 })), { ok: true, coins: z({ gp: 3, sp: 2 }) });
  assert.deepEqual(takeCoins(z({ pp: 1 }), z({ gp: 5 })), { ok: true, coins: z({ gp: 5 }) });
  assert.deepEqual(takeCoins(z({ cp: 4, sp: 3, gp: 2, pp: 1 }), z({ cp: 14 })), { ok: true, coins: z({ sp: 2, gp: 2, pp: 1 }) });
  assert.deepEqual(takeCoins(z({ pp: 1 }), z({ cp: 1 })), { ok: true, coins: z({ cp: 9, sp: 9, gp: 9 }) });
  assert.deepEqual(takeCoins(z({ cp: 100, pp: 1 }), z({ gp: 1 })), { ok: true, coins: z({ cp: 100, gp: 9 }) });
  assert.deepEqual(takeCoins(z({ cp: 100 }), z({ gp: 1 })), { ok: true, coins: z() });
  assert.deepEqual(takeCoins(z({ cp: 50, sp: 5 }), z({ gp: 1 })), { ok: true, coins: z() });
  assert.deepEqual(takeCoins(z({ gp: 6 }), z({ gp: 5, sp: 3 })), { ok: true, coins: z({ sp: 7 }) });
  const short = takeCoins(z({ gp: 1 }), z({ gp: 1, cp: 1 }));
  assert.deepEqual(short, { ok: false, code: "INSUFFICIENT_FUNDS" });
  assert.deepEqual(takeCoins(z({ cp: 50 }), z({ gp: 1 })), { ok: false, code: "INSUFFICIENT_FUNDS" });
  const purse = z({ pp: 1 });
  takeCoins(purse, z({ gp: 100 }));
  assert.deepEqual(purse, z({ pp: 1 }));
  const emptied = takeCoins(z({ pp: 2, gp: 3, sp: 4, cp: 5 }), z({ pp: 2, gp: 3, sp: 4, cp: 5 }));
  assert.deepEqual(emptied, { ok: true, coins: z() });
  if (emptied.ok) for (const count of Object.values(emptied.coins)) assert.ok(count >= 0);
});

test("giveCoins adds as given unless normalize is set", () => {
  assert.deepEqual(giveCoins(z({ gp: 1 }), z({ cp: 1000000 }), false), { ok: true, coins: z({ cp: 1000000, gp: 1 }) });
  assert.deepEqual(giveCoins(z({ gp: 1 }), z({ cp: 1000000 }), true), { ok: true, coins: z({ gp: 1, pp: 1000 }) });
  assert.deepEqual(giveCoins(z({ cp: 6 }), z({ cp: 4 }), true), { ok: true, coins: z({ sp: 1 }) });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("give_money and take_money update inventory.coins and convert_coins stays local", async () => {
  let character: Record<string, unknown> = {
    id: 95,
    name: "Pip",
    updated_at: "t0",
    inventory: { coins: { cp: 4, sp: 0, gp: 0, pp: 1 }, items: [{ id: "sword" }], notes: "keep" },
  };
  let fetches = 0;
  setCharacterFetch(async (input, init) => {
    fetches += 1;
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/find-character")) {
      if (body.id === 404) return jsonResponse({ status: "success", data: { __forbidden: true } });
      return jsonResponse({ status: "success", data: character });
    }
    if (url.endsWith("/update-character")) {
      assert.equal(body.expected_updated_at, character.updated_at);
      assert.deepEqual(Object.keys(body).sort(), ["expected_updated_at", "id", "inventory"]);
      const inventory = body.inventory as { coins: Coins; items: unknown[]; notes: string };
      assert.deepEqual(inventory.items, [{ id: "sword" }]);
      assert.equal(inventory.notes, "keep");
      character = { ...character, inventory, updated_at: "t1" };
      return jsonResponse({ status: "success", data: character });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const beforeFetches = fetches;
  const converted = await client.callTool({ name: "convert_coins", arguments: { amount: "1234 cp" } });
  assert.equal(converted.isError, undefined);
  assert.deepEqual((converted.structuredContent as { coins: Coins }).coins, z({ pp: 1, gp: 2, sp: 3, cp: 4 }));
  assert.equal(fetches, beforeFetches);

  const million = await client.callTool({ name: "convert_coins", arguments: { amount: { cp: 1000000 } } });
  assert.deepEqual((million.structuredContent as { coins: Coins }).coins, z({ pp: 1000 }));

  const given = await client.callTool({ name: "give_money", arguments: { characterId: 95, amount: { gp: 5, sp: 3 } } });
  assert.equal(given.isError, undefined);
  assert.deepEqual((given.structuredContent as { before: Coins; after: Coins }).before, z({ cp: 4, pp: 1 }));
  assert.deepEqual((given.structuredContent as { after: Coins }).after, z({ cp: 4, sp: 3, gp: 5, pp: 1 }));

  const normalized = await client.callTool({
    name: "give_money",
    arguments: { characterId: 95, amount: "1000000 cp", normalize: true },
  });
  assert.deepEqual((normalized.structuredContent as { after: Coins }).after, z({ gp: 5, sp: 3, pp: 1001, cp: 4 }));

  const broken = await client.callTool({ name: "take_money", arguments: { characterId: 95, amount: { gp: 15 } } });
  assert.equal(broken.isError, undefined);
  const afterTake = (broken.structuredContent as { before: Coins; after: Coins });
  assert.deepEqual(afterTake.before, z({ gp: 5, sp: 3, pp: 1001, cp: 4 }));
  assert.deepEqual(afterTake.after, z({ pp: 1000, gp: 0, sp: 3, cp: 4 }));
  for (const count of Object.values(afterTake.after)) assert.ok(count >= 0);

  const poor = await client.callTool({ name: "take_money", arguments: { characterId: 95, amount: { pp: 5000 } } });
  assert.equal(poor.isError, true);
  assert.equal((poor.structuredContent as { code: string }).code, "INSUFFICIENT_FUNDS");
  assert.deepEqual((character.inventory as { coins: Coins }).coins, afterTake.after);

  const denied = await client.callTool({ name: "give_money", arguments: { characterId: 404, amount: { cp: 1 } } });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied.structuredContent), /CHARACTER_FORBIDDEN/);

  const junk = await client.callTool({ name: "take_money", arguments: { characterId: 95, amount: "five gold" } });
  assert.equal(junk.isError, true);
  await client.close();
  setCharacterFetch(null);
});

test("give_money and take_money refuse another user's character with no write", async () => {
  const purse = { cp: 4, sp: 0, gp: 0, pp: 1 };
  const calls: string[] = [];
  setCharacterFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/find-character")) {
      return jsonResponse({ status: "success", data: { id: 111, name: "Not mine", updated_at: "t0", user_id: "owner-a", inventory: { coins: purse, items: [{ id: "sword" }] } } });
    }
    if (url.endsWith("/update-character")) return jsonResponse({ status: "success", data: { id: 111 } });
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "test2");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  for (const name of ["give_money", "take_money"] as const) {
    const result = await client.callTool({ name, arguments: { characterId: 111, amount: { gp: 5 } } });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code: string }).code, "CHARACTER_FORBIDDEN");
  }
  assert.deepEqual(calls.filter((url) => url.endsWith("/update-character")), []);
  const owned = calls.length;
  const sameOwner = await client.callTool({ name: "give_money", arguments: { characterId: 111, amount: { cp: 1 } } });
  assert.equal(sameOwner.isError, true);
  assert.equal(calls.length, owned + 1);

  setCharacterFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/find-character")) {
      return jsonResponse({ status: "success", data: { id: 111, name: "Mine", updated_at: "t0", user_id: "Test2", inventory: { coins: purse, items: [] } } });
    }
    if (url.endsWith("/update-character")) return jsonResponse({ status: "success", data: { id: 111, updated_at: "t1", user_id: "Test2", inventory: purse } });
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });
  const allowed = await client.callTool({ name: "give_money", arguments: { characterId: 111, amount: { cp: 1 } } });
  assert.equal(allowed.isError, undefined);
  assert.ok(calls.some((url) => url.endsWith("/update-character")));
  await client.close();
  setCharacterFetch(null);
});

test("other character writes refuse a non-owner before update or delete", async () => {
  const calls: string[] = [];
  setCharacterFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/find-character")) {
      return jsonResponse({
        status: "success",
        data: {
          id: 111, name: "Not mine", updated_at: "t0", user_id: "owner-a",
          content_sources: { enabled: [1] }, details: {}, operation_data: { selections: {} },
          spells: { list: [], slots: [] }, inventory: { coins: { cp: 0, sp: 0, gp: 0, pp: 0 }, items: [] },
        },
      });
    }
    if (url.endsWith("/find-item")) return jsonResponse({ status: "success", data: [{ id: 1, name: "Torch", meta_data: { hp_max: 1 } }] });
    return jsonResponse({ status: "success", data: { id: 111 } });
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "test2");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const books = await client.callTool({ name: "set_books", arguments: { characterId: 111, add: [9] } });
  const removed = await client.callTool({ name: "delete_character", arguments: { characterId: 111 } });
  const item = await client.callTool({ name: "add_inventory_item", arguments: { characterId: 111, itemId: 1 } });
  const spell = await client.callTool({ name: "remove_spell", arguments: { characterId: 111, spellId: 1 } });
  for (const result of [books, removed, item]) {
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code: string }).code, "CHARACTER_FORBIDDEN");
  }
  assert.equal(spell.isError, true);
  assert.deepEqual(calls.filter((url) => url.endsWith("/update-character") || url.endsWith("/delete-content")), []);
  await client.close();
  setCharacterFetch(null);
});
