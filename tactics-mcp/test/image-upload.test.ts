import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterFetch } from "../src/character-client.js";
import { registerCatalog } from "../src/catalog.js";
import { MAX_IMAGE_BYTES, imageType } from "../src/image-upload.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x1a, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from("body")]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const GIF = Buffer.from("GIF89a");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function connect() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test("image bytes accept png, jpeg, and webp and reject svg", () => {
  assert.equal(imageType(PNG), "png");
  assert.equal(imageType(JPEG), "jpeg");
  assert.equal(imageType(WEBP), "webp");
  assert.equal(imageType(SVG), "svg");
  assert.equal(imageType(GIF), null);
});

test("upload_image posts upload-public-file and the art tools store the returned URL", async () => {
  const uploads: Record<string, unknown>[] = [];
  let character: Record<string, unknown> = {
    id: 95, name: "Pip", user_id: "user-1", updated_at: "t0", details: { ancestry: { name: "Human" } },
  };
  let campaign: Record<string, unknown> = {
    id: 7, name: "Age of Ashes", user_id: "user-1", join_key: "secret-key",
    meta_data: { settings: { dice_3d: true } },
  };
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    if (url === "https://images.example/pip.png") return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    if (url === "https://images.example/huge.png") return new Response(Buffer.alloc(8), { status: 200, headers: { "content-length": String(MAX_IMAGE_BYTES + 1) } });
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/upload-public-file")) {
      uploads.push(body);
      assert.equal(typeof body.data, "string");
      assert.equal(String(body.data).includes("base64,"), false);
      assert.ok(["png", "jpeg", "webp"].includes(String(body.type)));
      assert.ok(["portraits", "backgrounds"].includes(String(body.category)));
      return jsonResponse({ status: "success", data: { url: `https://cdn.example/${body.category}/${body.type}` } });
    }
    if (url.endsWith("/find-character")) return jsonResponse({ status: "success", data: character });
    if (url.endsWith("/update-character")) {
      assert.equal(body.expected_updated_at, character.updated_at);
      character = { ...character, ...body, updated_at: "t1" };
      return jsonResponse({ status: "success", data: character });
    }
    if (url.endsWith("/find-campaign")) return jsonResponse({ status: "success", data: [campaign] });
    if (url.endsWith("/create-campaign")) {
      campaign = { ...campaign, ...body };
      return jsonResponse({ status: "success", data: campaign });
    }
    return jsonResponse({ status: "error", message: `unexpected ${url}` }, 404);
  });

  const client = await connect();
  const png = await client.callTool({ name: "upload_image", arguments: { category: "portraits", data: PNG.toString("base64") } });
  assert.equal(png.isError, undefined);
  assert.equal((png.structuredContent as { url: string }).url, "https://cdn.example/portraits/png");
  assert.equal(uploads[0].type, "png");
  assert.equal(uploads[0].category, "portraits");
  assert.equal(uploads[0].data, PNG.toString("base64"));

  const prefixed = await client.callTool({
    name: "upload_image",
    arguments: { category: "backgrounds", data: `data:image/jpeg;base64,${JPEG.toString("base64")}` },
  });
  assert.equal(prefixed.isError, undefined);
  assert.equal(uploads.at(-1)?.type, "jpeg");
  assert.equal(uploads.at(-1)?.data, JPEG.toString("base64"));

  const webp = await client.callTool({ name: "upload_image", arguments: { category: "backgrounds", data: WEBP.toString("base64") } });
  assert.equal(webp.isError, undefined);
  assert.equal((webp.structuredContent as { type: string }).type, "webp");

  const beforeReject = uploads.length;
  const svg = await client.callTool({ name: "upload_image", arguments: { category: "portraits", data: SVG.toString("base64") } });
  assert.equal(svg.isError, true);
  assert.match(String(svg.structuredContent?.code), /VALIDATION_ERROR/);
  assert.match(JSON.stringify(svg.content), /SVG/);
  const gif = await client.callTool({ name: "upload_image", arguments: { category: "portraits", data: GIF.toString("base64") } });
  assert.equal(gif.isError, true);
  const huge = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(MAX_IMAGE_BYTES)]);
  const oversized = await client.callTool({ name: "upload_image", arguments: { category: "portraits", data: huge.toString("base64") } });
  assert.equal(oversized.isError, true);
  assert.match(JSON.stringify(oversized.content), /2 MB/);
  const local = await client.callTool({ name: "upload_image", arguments: { category: "portraits", sourceUrl: "http://127.0.0.1/secret.png" } });
  assert.equal(local.isError, true);
  assert.equal(uploads.length, beforeReject);

  const fetched = await client.callTool({ name: "upload_image", arguments: { category: "portraits", sourceUrl: "https://images.example/pip.png" } });
  assert.equal(fetched.isError, undefined);
  assert.equal(uploads.at(-1)?.data, PNG.toString("base64"));
  const tooBig = await client.callTool({ name: "upload_image", arguments: { category: "portraits", sourceUrl: "https://images.example/huge.png" } });
  assert.equal(tooBig.isError, true);

  const portrait = await client.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitData: PNG.toString("base64") } });
  assert.equal(portrait.isError, undefined);
  assert.equal((character.details as { image_url?: string }).image_url, "https://cdn.example/portraits/png");
  assert.equal((character.details as { ancestry?: { name?: string } }).ancestry?.name, "Human");
  const both = await client.callTool({
    name: "set_character_art",
    arguments: { characterId: 95, portraitUrl: "https://example.com/a.png", portraitData: PNG.toString("base64") },
  });
  assert.equal(both.isError, true);

  const campaignArt = await client.callTool({ name: "set_campaign_art", arguments: { campaignId: 7, imageData: WEBP.toString("base64") } });
  assert.equal(campaignArt.isError, undefined);
  assert.equal((campaign.meta_data as { image_url?: string }).image_url, "https://cdn.example/backgrounds/webp");
  assert.equal((campaign.meta_data as { settings?: { dice_3d?: boolean } }).settings?.dice_3d, true);
  assert.equal(JSON.stringify(campaignArt).includes("secret-key"), false);

  await client.close();
  setCharacterFetch(null);
});
