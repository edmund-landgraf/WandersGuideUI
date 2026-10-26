import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterFetch } from "../src/character-client.js";
import { createTacticsMcpServer } from "../src/server.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

const SLUGS = [
  "content-source",
  "trait",
  "ability-block",
  "ancestry",
  "background",
  "class",
  "archetype",
  "versatile-heritage",
  "class-archetype",
  "item",
  "language",
  "creature",
  "spell",
] as const;

const FIND_QUERIES: Record<(typeof SLUGS)[number], Record<string, unknown>> = {
  "content-source": { homebrew: true, published: false },
  trait: { name: "homebrew-trait", content_sources: [900] },
  "ability-block": { name: "homebrew-feat", type: "feat", content_sources: [900], traits: [1], prerequisites: ["Trained in Athletics"] },
  ancestry: { id: 11, content_sources: [900] },
  background: { id: 12, content_sources: [900] },
  class: { id: 13, content_sources: [900] },
  archetype: { dedication_feat_id: 44, content_sources: [900] },
  "versatile-heritage": { heritage_id: 55, content_sources: [900] },
  "class-archetype": { class_id: 66, content_sources: [900] },
  item: { name: "Rope", content_sources: [900] },
  language: { name: "Thalassic", content_sources: [900] },
  creature: { name: "Goblin", type: "creature", content_sources: [900] },
  spell: { name: "Fireball", traits: [8], content_sources: [900] },
};

function toolName(slug: string) {
  return `wgui_ext_hb_${slug.replace(/-/g, "_")}`;
}

const ALL_TOOLS = [
  ...SLUGS.flatMap((slug) => [toolName(`find-${slug}`), toolName(`create-${slug}`)]),
  "wgui_ext_hb_find_content_update",
  "wgui_ext_hb_create_content_update",
  "wgui_ext_hb_get_content_source_stats",
  "wgui_ext_hb_delete_content",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textOf(response: { content?: unknown[] }) {
  return String((response.content?.[0] as { text?: string } | undefined)?.text ?? "");
}

function fnFromUrl(url: string) {
  const match = /\/functions\/v1\/([^/?]+)$/.exec(url);
  assert.ok(match, url);
  return match[1];
}

test("homebrew tools find, create, reject a blocked delete type, and enforce scopes", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    const fn = fnFromUrl(url);
    if (fn.startsWith("find-") || fn === "get-content-source-stats") {
      return jsonResponse({ status: "success", data: [{ ...body, id: 5, function: fn }] });
    }
    if (fn.startsWith("create-") || fn === "delete-content") {
      return jsonResponse({ status: "success", data: { ...body, id: 77, function: fn } });
    }
    return jsonResponse({ status: "error", message: `unexpected ${fn}` }, 404);
  });

  const granted = { scopes: ["read", "write"] };
  const server = createTacticsMcpServer(() => "user-1", () => granted.scopes, "http://127.0.0.1");
  const client = new Client({ name: "homebrew-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(ALL_TOOLS.length, 30);
    for (const name of ALL_TOOLS) assert.ok(names.includes(name), name);

    for (const slug of SLUGS) {
      const query = FIND_QUERIES[slug];
      const found = await client.callTool({ name: toolName(`find-${slug}`), arguments: { query } });
      assert.equal(found.isError, undefined, toolName(`find-${slug}`));
      assert.deepEqual(calls.at(-1), { url: `http://127.0.0.1:8000/functions/v1/find-${slug}`, body: query });
      assert.match(JSON.stringify(found.structuredContent), new RegExp(`"function":"find-${slug}"`));

      const record = { id: -1, name: `hb-${slug}`, content_source_id: 900, meta_data: {}, traits: [] };
      const created = await client.callTool({ name: toolName(`create-${slug}`), arguments: { record } });
      assert.equal(created.isError, undefined, toolName(`create-${slug}`));
      assert.deepEqual(calls.at(-1)?.url, `http://127.0.0.1:8000/functions/v1/create-${slug}`);
      assert.deepEqual(calls.at(-1)?.body, record);
      assert.match(JSON.stringify(created.structuredContent), /"id":77/);
    }

    const updates = await client.callTool({
      name: "wgui_ext_hb_find_content_update",
      arguments: { query: { state: "PENDING", user_id: "user-1" } },
    });
    assert.equal(updates.isError, undefined);
    assert.deepEqual(calls.at(-1), {
      url: "http://127.0.0.1:8000/functions/v1/find-content-update",
      body: { state: "PENDING", user_id: "user-1" },
    });

    const proposal = await client.callTool({
      name: "wgui_ext_hb_create_content_update",
      arguments: { type: "spell", action: "CREATE", data: { name: "Spark" }, content_source_id: 900, ref_id: 4 },
    });
    assert.equal(proposal.isError, undefined);
    assert.deepEqual(calls.at(-1), {
      url: "http://127.0.0.1:8000/functions/v1/create-content-update",
      body: { type: "spell", action: "CREATE", data: { name: "Spark" }, content_source_id: 900, ref_id: 4 },
    });

    const stats = await client.callTool({
      name: "wgui_ext_hb_get_content_source_stats",
      arguments: { content_source_id: 900 },
    });
    assert.equal(stats.isError, undefined);
    assert.deepEqual(calls.at(-1), {
      url: "http://127.0.0.1:8000/functions/v1/get-content-source-stats",
      body: { content_source_id: 900 },
    });

    const deleted = await client.callTool({
      name: "wgui_ext_hb_delete_content",
      arguments: { id: 77, type: "item" },
    });
    assert.equal(deleted.isError, undefined);
    assert.deepEqual(calls.at(-1), {
      url: "http://127.0.0.1:8000/functions/v1/delete-content",
      body: { id: 77, type: "item" },
    });

    assert.equal(calls.length, 30);

    const before = calls.length;
    const rejected = await client.callTool({ name: "wgui_ext_hb_delete_content", arguments: { id: 3, type: "character" } });
    assert.equal(rejected.isError, true);
    assert.match(textOf(rejected), /does not accept type character/);
    assert.equal(calls.length, before);

    granted.scopes = ["read"];
    const denied = await client.callTool({
      name: "wgui_ext_hb_create_item",
      arguments: { record: { name: "denied" } },
    });
    assert.equal(denied.isError, true);
    assert.equal(textOf(denied), "MCP token missing scope write for wgui_ext_hb_create_item.");
    assert.equal(calls.length, before);
  } finally {
    await client.close();
    await server.close();
    setCharacterFetch(null);
  }
});
