import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterFetch } from "../src/character-client.js";
import { registerCatalog } from "../src/catalog.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textOf(response: { content?: unknown[] }) {
  return String((response.content?.[0] as { text?: string } | undefined)?.text ?? "");
}

async function connect() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test("character art, notes, and equip/invest follow the sheet fields", async () => {
  const tiptap = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Kept" }] }] };
  let character: Record<string, unknown> = {
    id: 95,
    name: "Pip",
    level: 1,
    user_id: "user-1",
    updated_at: "t0",
    content_sources: { enabled: [1] },
    details: { ancestry: { name: "Human" }, image_url: "https://example.com/old.png" },
    notes: {
      pages: [
        { name: "GM Notes", icon: "notebook", color: "#359fdf", contents: "secret" },
        { name: "Notes", icon: "notebook", color: "#359fdf", shared: true, contents: "Hello" },
        { name: "Journal", icon: "book", color: "#111111", contents: tiptap },
      ],
    },
    inventory: {
      coins: { cp: 0, sp: 0, gp: 0, pp: 0 },
      items: [
        { id: "sword", item: { id: 10, name: "Longsword", group: "WEAPON", hands: "1", traits: [], meta_data: { damage: { damageType: "slashing" } } }, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
        { id: "torch", item: { id: 11, name: "Torch", group: "GENERAL", hands: null, traits: [], meta_data: {} }, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
        { id: "cloak", item: { id: 12, name: "Cloak of Elvenkind", group: "WORN", hands: null, traits: [1527], meta_data: {} }, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
        { id: "armor", item: { id: 13, name: "Explorer's Clothing", group: "ARMOR", hands: null, traits: [1527], meta_data: { dex_cap: 0 } }, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
        { id: "shield", item: { id: 14, name: "Steel Shield", group: "SHIELD", hands: "1", traits: [], meta_data: { ac_bonus: 2 } }, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
        { id: "staff", item: { id: 15, name: "Staff", group: "WEAPON", hands: "2", traits: [1546], meta_data: {} }, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
        { id: "formula", item: { id: 16, name: "Formula", group: "WEAPON", hands: "1", traits: [1527], meta_data: { damage: { damageType: "fire" } } }, is_formula: true, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
        {
          id: "pack",
          item: { id: 17, name: "Backpack", group: "GENERAL", traits: [1527], meta_data: { bulk: { capacity: 4 } } },
          is_formula: false, is_equipped: false, is_invested: false, is_implanted: false,
          container_contents: [
            { id: "ring", item: { id: 18, name: "Ring", group: "WORN", hands: null, traits: [1527], meta_data: {} }, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
            { id: "dagger", item: { id: 19, name: "Dagger", group: "WEAPON", hands: "1", traits: [], meta_data: { damage: { damageType: "piercing" } } }, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
          ],
        },
      ],
    },
  };
  const updates: Record<string, unknown>[] = [];
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/find-character")) return jsonResponse({ status: "success", data: character });
    if (url.endsWith("/update-character")) {
      updates.push(body);
      assert.equal(body.expected_updated_at, character.updated_at);
      character = { ...character, ...body, updated_at: `t${updates.length}` };
      return jsonResponse({ status: "success", data: character });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const client = await connect();
  const art = await client.callTool({
    name: "set_character_art",
    arguments: { characterId: 95, portraitUrl: "https://example.com/pip.png", backgroundUrl: " https://example.com/woods.png " },
  });
  assert.equal(art.isError, undefined);
  const details = character.details as { image_url?: string; background_image_url?: string; ancestry?: { name?: string } };
  assert.equal(details.image_url, "https://example.com/pip.png");
  assert.equal(details.background_image_url, "https://example.com/woods.png");
  assert.equal(details.ancestry?.name, "Human");
  assert.deepEqual(Object.keys(updates.at(-1) ?? {}).sort(), ["details", "expected_updated_at", "id"]);
  const row = await client.callTool({ name: "get_character_row", arguments: { id: 95 } });
  assert.equal((row.structuredContent as { image_url?: string }).image_url, "https://example.com/pip.png");
  assert.equal((row.structuredContent as { background_image_url?: string }).background_image_url, "https://example.com/woods.png");

  const cleared = await client.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitUrl: "" } });
  assert.equal(cleared.isError, undefined);
  assert.equal((character.details as { image_url?: string }).image_url, undefined);
  assert.equal((character.details as { background_image_url?: string }).background_image_url, "https://example.com/woods.png");
  assert.equal((cleared.structuredContent as { image_url: string | null }).image_url, null);

  const badUrl = await client.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitUrl: "javascript:alert(1)" } });
  assert.equal(badUrl.isError, true);
  assert.equal(badUrl.structuredContent?.code, "VALIDATION_ERROR");
  const neither = await client.callTool({ name: "set_character_art", arguments: { characterId: 95 } });
  assert.equal(neither.isError, true);

  character = { ...character, user_id: "someone-else" };
  const updatesBefore = updates.length;
  const stolen = await client.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitUrl: "https://example.com/nope.png" } });
  assert.equal(stolen.isError, true);
  assert.equal(stolen.structuredContent?.code, "CHARACTER_FORBIDDEN");
  assert.equal(updates.length, updatesBefore);
  character = { ...character, user_id: "user-1" };

  const notes = await client.callTool({ name: "get_character_notes", arguments: { characterId: 95 } });
  assert.equal(notes.isError, undefined);
  const pages = (notes.structuredContent as { pages: { name: string; text: string; shared?: boolean }[] }).pages;
  assert.equal(pages[1].name, "Notes");
  assert.equal(pages[1].text, "Hello");
  assert.equal(pages[1].shared, true);
  assert.match(pages[2].text, /Kept/);

  const appended = await client.callTool({ name: "set_character_notes", arguments: { characterId: 95, mode: "append", text: "There" } });
  assert.equal(appended.isError, undefined);
  const notePage = ((character.notes as { pages: { name: string; contents: unknown; shared?: boolean }[] }).pages).find((page) => page.name === "Notes")!;
  assert.equal(notePage.contents, "Hello\nThere");
  assert.equal(notePage.shared, true);
  assert.equal(((character.notes as { pages: { name: string; contents: unknown }[] }).pages)[0].contents, "secret");
  assert.deepEqual(Object.keys(updates.at(-1) ?? {}).sort(), ["expected_updated_at", "id", "notes"]);

  const replaced = await client.callTool({ name: "set_character_notes", arguments: { characterId: 95, mode: "replace", pageName: "Notes", text: "Fresh" } });
  assert.equal(replaced.isError, undefined);
  assert.equal(((character.notes as { pages: { contents: string }[] }).pages)[1].contents, "Fresh");

  const journal = await client.callTool({ name: "set_character_notes", arguments: { characterId: 95, mode: "append", pageIndex: 2, text: "More" } });
  assert.equal(journal.isError, undefined);
  const journalPage = ((character.notes as { pages: { contents: { type?: string; content?: unknown[] } }[] }).pages)[2].contents;
  assert.equal(journalPage.type, "doc");
  assert.equal(journalPage.content?.length, 2);
  assert.equal((journalPage.content?.[0] as { content?: { text?: string }[] }).content?.[0].text, "Kept");

  const emptyAppend = await client.callTool({ name: "set_character_notes", arguments: { characterId: 95, mode: "append", text: "" } });
  assert.equal(emptyAppend.isError, true);
  const missingIndex = await client.callTool({ name: "set_character_notes", arguments: { characterId: 95, mode: "replace", pageIndex: 9, text: "nope" } });
  assert.equal(missingIndex.structuredContent?.code, "NOT_FOUND");

  character = { ...character, notes: { pages: [{ name: "GM Notes", icon: "notebook", color: "#359fdf", contents: "gm" }] } };
  const created = await client.callTool({ name: "set_character_notes", arguments: { characterId: 95, mode: "replace", text: "Mine" } });
  assert.equal(created.isError, undefined);
  const createdPages = (character.notes as { pages: { name: string; icon: string; color: string; contents: string }[] }).pages;
  assert.equal(createdPages[0].name, "Notes");
  assert.equal(createdPages[0].icon, "notebook");
  assert.equal(createdPages[0].color, "#359fdf");
  assert.equal(createdPages[0].contents, "Mine");
  assert.equal(createdPages[1].contents, "gm");

  const wielded = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "sword", equipped: true } });
  assert.equal(wielded.isError, undefined);
  assert.equal((wielded.structuredContent as { hands: string }).hands, "1");
  assert.equal((wielded.structuredContent as { is_equipped: boolean }).is_equipped, true);
  const items = () => (character.inventory as { items: { id: string; is_equipped: boolean; is_invested: boolean; container_contents: { id: string; is_equipped: boolean; is_invested: boolean }[] }[] }).items;
  assert.equal(items().find((item) => item.id === "sword")!.is_equipped, true);

  const torch = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "torch", equipped: true } });
  assert.equal(torch.isError, true);
  assert.match(textOf(torch), /weapons, armor, shields, and staves/);
  const clothing = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "armor", equipped: true, invested: true } });
  assert.equal(clothing.isError, undefined);
  assert.equal(items().find((item) => item.id === "armor")!.is_equipped, true);
  assert.equal(items().find((item) => item.id === "armor")!.is_invested, true);
  const shield = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "shield", equipped: true } });
  assert.equal(shield.isError, undefined);
  const staff = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "staff", equipped: true } });
  assert.equal(staff.isError, undefined);
  assert.equal((staff.structuredContent as { hands: string }).hands, "2");

  const formula = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "formula", equipped: true } });
  assert.equal(formula.isError, true);
  const bagWeapon = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "dagger", equipped: true } });
  assert.equal(bagWeapon.isError, true);
  assert.match(textOf(bagWeapon), /inside a container/);
  const ring = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "ring", invested: true } });
  assert.equal(ring.isError, undefined);
  assert.equal(items().find((item) => item.id === "pack")!.container_contents.find((item) => item.id === "ring")!.is_invested, true);
  assert.equal(items().find((item) => item.id === "pack")!.container_contents.find((item) => item.id === "dagger")!.is_equipped, false);

  const plain = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "torch", invested: true } });
  assert.equal(plain.isError, true);
  assert.match(textOf(plain), /invested trait/);

  for (let n = 0; n < 8; n += 1) {
    items().push({ id: `extra-${n}`, is_equipped: false, is_invested: true, container_contents: [] });
  }
  const limited = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "cloak", invested: true } });
  assert.equal(limited.isError, true);
  assert.equal(limited.structuredContent?.code, "VALIDATION_ERROR");
  assert.equal(items().find((item) => item.id === "cloak")!.is_invested, false);
  const missing = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "nope", equipped: true } });
  assert.equal(missing.structuredContent?.code, "NOT_FOUND");
  const noFlag = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "sword" } });
  assert.equal(noFlag.structuredContent?.code, "VALIDATION_ERROR");

  character = { ...character, user_id: "other" };
  const stolenItem = await client.callTool({ name: "set_inventory_item", arguments: { characterId: 95, inventoryItemId: "sword", equipped: false } });
  assert.equal(stolenItem.structuredContent?.code, "CHARACTER_FORBIDDEN");
  const stolenNotes = await client.callTool({ name: "set_character_notes", arguments: { characterId: 95, mode: "replace", text: "no" } });
  assert.equal(stolenNotes.structuredContent?.code, "CHARACTER_FORBIDDEN");

  await client.close();
  setCharacterFetch(null);
});

test("campaign art writes meta_data.image_url and image_focus_y for the owner", async () => {
  let campaign: Record<string, unknown> = {
    id: 7,
    name: "Age of Ashes",
    user_id: "user-1",
    join_key: "secret-key",
    description: "A campaign",
    meta_data: { image_url: "https://example.com/old.jpg", settings: { dice_3d: true }, row_color: "#123456" },
  };
  const writes: Record<string, unknown>[] = [];
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/find-campaign")) {
      return jsonResponse({ status: "success", data: Number(body.id) === 7 ? [campaign] : [] });
    }
    if (url.endsWith("/create-campaign")) {
      writes.push(body);
      assert.equal(body.id, 7);
      campaign = { ...campaign, ...body };
      return jsonResponse({ status: "success", data: campaign });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const client = await connect();
  const read = await client.callTool({ name: "get_campaign", arguments: { campaignId: 7 } });
  assert.equal(read.isError, undefined);
  assert.equal((read.structuredContent as { image_url: string }).image_url, "https://example.com/old.jpg");
  assert.equal((read.structuredContent as { image_focus_y: unknown }).image_focus_y, null);
  assert.equal((read.structuredContent as { isOwner: boolean }).isOwner, true);
  assert.equal(JSON.stringify(read.structuredContent).includes("secret-key"), false);
  assert.equal(JSON.stringify(read).includes("join_key"), false);

  const saved = await client.callTool({
    name: "set_campaign_art",
    arguments: { campaignId: 7, imageUrl: "https://example.com/campaign.png", focusY: 140 },
  });
  assert.equal(saved.isError, undefined);
  const meta = campaign.meta_data as { image_url: string; image_focus_y: number; settings: { dice_3d: boolean }; row_color: string };
  assert.equal(meta.image_url, "https://example.com/campaign.png");
  assert.equal(meta.image_focus_y, 100);
  assert.equal(meta.settings.dice_3d, true);
  assert.equal(meta.row_color, "#123456");
  assert.equal((saved.structuredContent as { image_focus_y: number }).image_focus_y, 100);
  assert.equal(JSON.stringify(saved).includes("secret-key"), false);

  const cleared = await client.callTool({ name: "set_campaign_art", arguments: { campaignId: 7, imageUrl: null } });
  assert.equal(cleared.isError, undefined);
  assert.equal((campaign.meta_data as { image_url: string }).image_url, "");
  assert.equal((campaign.meta_data as { image_focus_y: number }).image_focus_y, 100);

  const bad = await client.callTool({ name: "set_campaign_art", arguments: { campaignId: 7, imageUrl: "not a url" } });
  assert.equal(bad.structuredContent?.code, "VALIDATION_ERROR");
  const missing = await client.callTool({ name: "get_campaign", arguments: { campaignId: 8 } });
  assert.equal(missing.structuredContent?.code, "NOT_FOUND");

  campaign = { ...campaign, user_id: "gm-other" };
  const writesBefore = writes.length;
  const stolen = await client.callTool({ name: "set_campaign_art", arguments: { campaignId: 7, imageUrl: "https://example.com/nope.png" } });
  assert.equal(stolen.structuredContent?.code, "CAMPAIGN_FORBIDDEN");
  assert.equal(writes.length, writesBefore);
  const notOwnerRead = await client.callTool({ name: "get_campaign", arguments: { campaignId: 7 } });
  assert.equal(notOwnerRead.structuredContent?.code, "CAMPAIGN_FORBIDDEN");

  await client.close();
  setCharacterFetch(null);
});
