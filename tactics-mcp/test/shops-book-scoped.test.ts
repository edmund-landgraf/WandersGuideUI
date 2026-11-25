import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setCharacterFetch } from "../src/character-client.js";
import { addShopItem, type ShopNode } from "../src/shops.js";

afterEach(() => {
  setCharacterFetch(null);
  delete process.env.WG_ACCESS_TOKEN;
  delete process.env.SUPABASE_URL;
});

test("batch shop append resolves items and traits one book at a time, preserving existing stock", async () => {
  process.env.WG_ACCESS_TOKEN = "test-token";
  process.env.SUPABASE_URL = "http://unit.test";

  const node: ShopNode = {
    id: "test-shop",
    user_id: "test-user",
    content_kind: "shop",
    kind: "entry",
    name: "Test Market",
    parent_id: null,
    draft: {
      preset: "general",
      settlement: "city",
      markup: 1,
      stock: [{
        id: 77, name: "Existing Stock", level: 0, rarity: "COMMON",
        group: "GENERAL", price: "1 gp", quantity: 1, bulk: "",
        traits: [], description: "", source: "wanderers-guide",
      }],
      books: [11, 22],
    },
    published: false,
    public_token: null,
    snapshot: null,
    published_at: null,
  };
  const requests: { name: string; book: number; ids: number[] }[] = [];
  let fetchRetries = 0;

  setCharacterFetch((async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/rest/v1/syndicated_nodes")) {
      if (method === "GET") return new Response(JSON.stringify([node]), { status: 200 });
      assert.equal(method, "PATCH");
      const patch = JSON.parse(String(init?.body)) as Partial<ShopNode>;
      return new Response(JSON.stringify([{ ...node, ...patch }]), { status: 200 });
    }

    const functionName = url.split("/functions/v1/")[1];
    if (functionName === "find-content-source") return Response.json({ data: [{ id: 11 }, { id: 22 }] });
    assert.ok(functionName === "find-item" || functionName === "find-trait", url);
    const body = JSON.parse(String(init?.body)) as { id: number | number[]; content_sources: number[] };
    assert.equal(body.content_sources.length, 1, "lookup must be restricted to one book");
    const book = body.content_sources[0];
    const ids = Array.isArray(body.id) ? body.id : [body.id];
    assert.ok(ids.length <= 20, "each lookup must cap its id batch");
    requests.push({ name: functionName, book, ids });

    if (functionName === "find-item" && ids.includes(101) && book === 11 && fetchRetries++ === 0) {
      throw new Error("fetch failed");
    }
    const itemRows = [
      { id: 101, name: "Second Book Item", level: 2, rarity: "COMMON",
        group: "GENERAL", traits: [202], price: { gp: 2 }, content_source_id: 22 },
      { id: 102, name: "First Book Item", level: 1, rarity: "COMMON",
        group: "GENERAL", traits: [201], price: { gp: 1 }, content_source_id: 11 },
    ];
    const traitRows = [{ id: 201, name: "magical", book: 11 }, { id: 202, name: "alchemical", book: 22 }];
    const rows = functionName === "find-item"
      ? itemRows.filter((item) => ids.includes(item.id) && item.content_source_id === book)
      : traitRows.filter((trait) => ids.includes(trait.id) && trait.book === book).map(({ id, name }) => ({ id, name }));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }) as typeof fetch);

  // Supplying items[] should not require a duplicate top-level source or itemId.
  const result = await addShopItem("test-user", "test-shop", {
    items: [
      { source: "wanderers-guide", id: 101, quantity: 2 },
      { source: "wanderers-guide", id: 102, quantity: 3 },
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const stock = result.data.shop.draft?.stock ?? [];
  assert.deepEqual(stock.map((line) => line.id), [77, 101, 102]);
  assert.equal(stock[1].quantity, 2);
  assert.equal(stock[2].quantity, 3);
  assert.deepEqual(stock[1].traits, ["alchemical"]);
  assert.deepEqual(stock[2].traits, ["magical"]);
  assert.equal(requests.filter((call) => call.name === "find-item" && call.ids.includes(101) && call.book === 11).length, 2, "fetch failure should retry once");
  assert.ok(requests.some((call) => call.name === "find-item" && call.ids.includes(101) && call.book === 22), "should continue to next book");
  assert.ok(requests.some((call) => call.name === "find-trait" && call.ids.includes(202) && call.book === 22), "traits should also search the right book");
});
