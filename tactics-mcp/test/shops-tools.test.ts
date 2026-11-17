import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterFetch } from "../src/character-client.js";
import { startTacticsHttp } from "../src/http.js";
import { createTacticsMcpServer } from "../src/server.js";
import { mintToken, resetTokens } from "../src/tokens.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.PF2E_SHOP_API = "http://127.0.0.1:3333";

type Node = Record<string, unknown>;
const nodes: Node[] = [];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function parseQuery(url: string) {
  const query = url.split("?")[1] ?? "";
  return Object.fromEntries(new URLSearchParams(query.replaceAll("&", "&")));
}

function installFetch() {
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.includes("/api/equipment")) {
      return jsonResponse({
        rows: [
          { EquipmentId: 1, Name: "AoN Rope", Level: 0, Rarity: "common", Traits: "", ItemCategory: "adventuring gear", ItemSubcategory: null, SourceBook: "Core", Summary: "Aon rope", PriceCp: 50, BulkText: "L", WeaponGroup: null, WeaponCategory: null, WeaponType: null, ArmorCategory: null, ArmorGroupText: null, Hands: null, AmmunitionText: null },
        ],
        total: 1,
        limit: 500,
        offset: 0,
      });
    }
    if (url.endsWith("/find-content-source")) {
      return jsonResponse({ status: "success", data: [{ id: 1, name: "Core" }, { id: 2, name: "Lost" }] });
    }
    if (url.endsWith("/find-trait")) {
      return jsonResponse({ status: "success", data: [{ id: 1, name: "Magical" }] });
    }
    if (url.endsWith("/find-item")) {
      const sources = body.content_sources as number[] | undefined;
      const catalog = [
        { id: 1, name: "WG Rope", level: 0, rarity: "COMMON", group: "GENERAL", price: { gp: 1 }, bulk: "L", traits: [], description: "wg rope", content_source_id: 1, meta_data: {} },
        { id: 2, name: "Lost Lamp", level: 1, rarity: "COMMON", group: "GENERAL", price: { gp: 2 }, bulk: "1", traits: [], description: "lamp", content_source_id: 2, meta_data: {} },
      ];
      const rows = sources ? catalog.filter((row) => sources.includes(row.content_source_id)) : catalog;
      return jsonResponse({ status: "success", data: rows });
    }
    if (url.includes("/rest/v1/syndicated_public")) {
      const token = decodeURIComponent(url.split("public_token=eq.")[1]?.split("&")[0] ?? "");
      const published = nodes.find((row) => row.public_token === token && row.published);
      return jsonResponse(published ? [{ name: published.name, snapshot: published.snapshot, published_at: published.published_at, content_kind: "shop" }] : []);
    }
    if (url.includes("/rest/v1/syndicated_nodes")) {
      const params = parseQuery(url);
      if (method === "GET") {
        let rows = [...nodes];
        if (params.id) rows = rows.filter((row) => row.id === params.id.replace("eq.", ""));
        return jsonResponse(rows);
      }
      if (method === "POST") {
        const row = { id: `shop-${nodes.length + 1}`, published: false, public_token: null, snapshot: null, published_at: null, parent_id: null, ...body };
        nodes.push(row);
        return jsonResponse([row], 201);
      }
      if (method === "PATCH") {
        const id = (params.id ?? "").replace("eq.", "");
        const index = nodes.findIndex((row) => row.id === id);
        if (index < 0) return jsonResponse([], 404);
        nodes[index] = { ...nodes[index], ...body };
        return jsonResponse([nodes[index]]);
      }
      if (method === "DELETE") {
        const id = (params.id ?? "").replace("eq.", "");
        const index = nodes.findIndex((row) => row.id === id);
        if (index >= 0) nodes.splice(index, 1);
        return jsonResponse([]);
      }
    }
    return jsonResponse({ status: "error", message: url }, 404);
  });
}

before(() => {
  nodes.length = 0;
  installFetch();
});

after(() => {
  setCharacterFetch(null);
});

async function clientFor(scopes: string[]) {
  const server = createTacticsMcpServer(() => "user-1", () => scopes, "http://127.0.0.1");
  const mcp = new Client({ name: "shop-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { mcp, close: async () => { await mcp.close(); await server.close(); } };
}

test("create, rename, resize, add and remove shop lines from both catalogs", async () => {
  nodes.length = 0;
  const { mcp, close } = await clientFor(["read", "write"]);
  try {
    const created = await mcp.callTool({
      name: "create_shop",
      arguments: { name: "General", generate: true, sources: ["wanderers-guide"], books: [1], size: 2, preset: "general", settlement: "village" },
    });
    assert.equal(created.isError, undefined);
    const shop = (created.structuredContent as { shop: { id: string; draft: { stock: { source: string; id: number }[] } } }).shop;
    assert.equal(shop.draft.stock.every((row) => row.source === "wanderers-guide"), true);
    assert.ok(shop.draft.stock.length >= 1);

    const renamed = await mcp.callTool({ name: "update_shop", arguments: { shopId: shop.id, name: "Renamed", campaignId: 57 } });
    assert.equal((renamed.structuredContent as { shop: { name: string; draft: { campaignId: number } } }).shop.name, "Renamed");
    assert.equal((renamed.structuredContent as { shop: { draft: { campaignId: number } } }).shop.draft.campaignId, 57);

    const listed = await mcp.callTool({ name: "list_shops", arguments: {} });
    assert.equal((listed.structuredContent as { shops: unknown[] }).shops.length, 1);

    await mcp.callTool({ name: "add_shop_item", arguments: { shopId: shop.id, source: "pf2e", itemId: 1 } });
    const withBoth = await mcp.callTool({ name: "get_shop", arguments: { shopId: shop.id } });
    const stock = (withBoth.structuredContent as { shop: { draft: { stock: { source: string; id: number }[] } }; stockKeys: string[] }).shop.draft.stock;
    assert.ok(stock.some((row) => row.source === "wanderers-guide" && row.id === 1));
    assert.ok(stock.some((row) => row.source === "pf2e" && row.id === 1));
    const keys = (withBoth.structuredContent as { stockKeys: string[] }).stockKeys;
    assert.ok(keys.some((key) => key === "wanderers-guide:1" || key === "wanderers-guide:1:formula"));
    assert.ok(keys.includes("pf2e:1"));

    await mcp.callTool({ name: "remove_shop_item", arguments: { shopId: shop.id, key: "pf2e:1" } });
    const afterRemove = await mcp.callTool({ name: "get_shop", arguments: { shopId: shop.id } });
    assert.equal((afterRemove.structuredContent as { shop: { draft: { stock: { source: string }[] } } }).shop.draft.stock.some((row) => row.source === "pf2e"), false);

    const resized = await mcp.callTool({ name: "resize_shop", arguments: { shopId: shop.id, size: 1 } });
    assert.ok(((resized.structuredContent as { shop: { draft: { stock: unknown[] } } }).shop.draft.stock.length) <= 1);

    const published = await mcp.callTool({ name: "publish_shop", arguments: { shopId: shop.id } });
    const token = (published.structuredContent as { shop: { public_token: string } }).shop.public_token;
    const publicShop = await mcp.callTool({ name: "get_published_shop", arguments: { token } });
    assert.equal(publicShop.isError, undefined);

    const folder = await mcp.callTool({ name: "create_shop_folder", arguments: { name: "Town" } });
    const folderId = (folder.structuredContent as { shop: { id: string } }).shop.id;
    await mcp.callTool({ name: "move_shop", arguments: { shopId: shop.id, parentId: folderId } });
  } finally {
    await close();
  }
});

test("read-only tokens cannot create shops", async () => {
  const { mcp, close } = await clientFor(["read"]);
  try {
    const denied = await mcp.callTool({ name: "create_shop", arguments: { name: "Nope" } });
    assert.equal(denied.isError, true);
    assert.match(String((denied.content as { text: string }[])[0].text), /missing scope write/);
  } finally {
    await close();
  }
});

test("HTTP POST /api/shops matches create_shop draft shape", async () => {
  nodes.length = 0;
  process.env.TACTICS_MCP_TOKEN_FILE = join(mkdtempSync(join(tmpdir(), "shop-http-")), "tokens.json");
  resetTokens();
  const minted = mintToken({ userId: "user-1", scopes: ["read", "write"] });
  const previousPort = process.env.TACTICS_MCP_PORT;
  process.env.TACTICS_MCP_PORT = "0";
  const httpServer = startTacticsHttp();
  await new Promise<void>((resolve) => httpServer.once("listening", () => resolve()));
  try {
    const { port } = httpServer.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/shops`, {
      method: "POST",
      headers: { authorization: `Bearer ${minted.token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP Shop", generate: true, sources: ["wanderers-guide"], books: [1], size: 1 }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { shop: { draft: { stock: { source: string }[] } } };
    assert.equal(body.shop.draft.stock[0].source, "wanderers-guide");
  } finally {
    httpServer.close();
    if (previousPort === undefined) delete process.env.TACTICS_MCP_PORT;
    else process.env.TACTICS_MCP_PORT = previousPort;
  }
});
