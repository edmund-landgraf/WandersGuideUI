import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function connect(allowLocalFiles = false) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1", allowLocalFiles);
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
  let nextUploadUrl: string | null = null;
  let character: Record<string, unknown> = {
    id: 95, name: "Pip", user_id: "user-1", updated_at: "t0", details: { ancestry: { name: "Human" } },
  };
  let campaign: Record<string, unknown> = {
    id: 7, name: "Age of Ashes", user_id: "user-1", join_key: "secret-key",
    meta_data: { settings: { dice_3d: true } },
  };
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://files.oaiusercontent.com/")) {
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      if (url.includes("/expired")) return new Response("", { status: 403 });
      if (url.includes("/oversized")) return new Response(PNG, { headers: { "content-length": String(MAX_IMAGE_BYTES + 1) } });
      if (url.includes("/redirect")) return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
      if (url.includes("/fake")) return new Response(SVG, { headers: { "content-type": "image/jpeg" } });
      return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    }
    if (url === "https://images.example/pip.png") return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    if (url === "https://wgui.wandersguide.site/portraits/thalanis-reed.jpg") {
      return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url === "https://images.example/huge.png") return new Response(Buffer.alloc(8), { status: 200, headers: { "content-length": String(MAX_IMAGE_BYTES + 1) } });
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/upload-public-file")) {
      uploads.push(body);
      assert.equal(typeof body.data, "string");
      assert.equal(String(body.data).includes("base64,"), false);
      assert.ok(["png", "jpeg", "webp"].includes(String(body.type)));
      assert.ok(["portraits", "backgrounds"].includes(String(body.category)));
      const returned = nextUploadUrl ?? `https://cdn.example/${body.category}/${body.type}`;
      nextUploadUrl = null;
      return jsonResponse({ status: "success", data: { url: returned } });
    }
    if (url === "https://amba.wandersguide.site/storage/v1/object/public/portraits/user-1/a%20b.jpeg") {
      return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url === "https://amba.wandersguide.site/storage/v1/object/public/backgrounds/user-1/broken.webp") {
      return new Response("not an image", { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url === "https://amba.wandersguide.site/storage/v1/object/public/portraits/user-1/diagnostic.webp?token=hidden-query") {
      return new Response(null, { status: 302, headers: { location: "https://storage.example/storage/v1/object/public/portraits/user-1/diagnostic.webp?signature=hidden-redirect" } });
    }
    if (url === "https://storage.example/storage/v1/object/public/portraits/user-1/diagnostic.webp?signature=hidden-redirect") {
      return jsonResponse({ statusCode: "400", error: "InvalidRequest", message: "Bad Request", secret: "hidden-body" }, 400);
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

  const client = await connect(true);
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

  const generated = join(mkdtempSync(join(tmpdir(), "portrait-")), "generated.jpg");
  writeFileSync(generated, JPEG);
  const fromFile = await client.callTool({ name: "upload_image", arguments: { category: "portraits", file: generated } });
  assert.equal(fromFile.isError, undefined);
  assert.equal(uploads.at(-1)?.type, "jpeg");
  assert.equal(uploads.at(-1)?.data, JPEG.toString("base64"));
  const onCharacter = await client.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitFile: generated } });
  assert.equal(onCharacter.isError, undefined);
  assert.equal((character.details as { image_url?: string }).image_url, "https://cdn.example/portraits/jpeg");

  // Exercise the remote configuration, not the local stdio file reader.
  const remote = await connect();
  const listed = await remote.listTools();
  const artTool = listed.tools.find(t => t.name === "set_character_art");
  const uploadTool = listed.tools.find(t => t.name === "upload_image");
  assert.deepEqual(artTool?._meta?.["openai/fileParams"], ["portraitAttachment", "backgroundAttachment"]);
  assert.deepEqual(uploadTool?._meta?.["openai/fileParams"], ["attachment"]);
  const schema = artTool?.inputSchema.properties?.portraitAttachment as { required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean };
  assert.deepEqual(new Set(schema.required), new Set(["download_url", "file_id"]));
  assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), ["download_url", "file_id", "file_name", "mime_type"]);
  assert.equal(schema.additionalProperties, false);
  const attachment = { download_url: "https://files.oaiusercontent.com/generated?sig=temporary-secret", file_id: "file-test", file_name: "generated.jpg", mime_type: "image/jpeg" };
  const attached = await remote.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitAttachment: attachment } });
  assert.equal(attached.isError, undefined);
  assert.equal(uploads.at(-1)?.data, JPEG.toString("base64"));
  assert.equal(uploads.at(-1)?.category, "portraits");
  assert.equal((character.details as { image_url?: string }).image_url, "https://cdn.example/portraits/jpeg");
  assert.equal((character.details as { ancestry?: { name?: string } }).ancestry?.name, "Human");
  assert.equal(JSON.stringify(attached).includes("temporary-secret"), false);
  const uploadedAttachment = await remote.callTool({ name: "upload_image", arguments: { category: "portraits", attachment } });
  assert.equal(uploadedAttachment.isError, undefined);
  const backgroundAttachment = await remote.callTool({ name: "set_character_art", arguments: { characterId: 95, backgroundAttachment: attachment } });
  assert.equal(backgroundAttachment.isError, undefined);
  assert.equal(uploads.at(-1)?.category, "backgrounds");
  const beforeBad = uploads.length;
  const beforeDetails = structuredClone(character.details);
  for (const download_url of ["http://files.oaiusercontent.com/generated", "https://files.oaiusercontent.com.evil.example/generated", "file:///etc/passwd", "https://files.oaiusercontent.com/expired?sig=temporary-secret", "https://files.oaiusercontent.com/oversized", "https://files.oaiusercontent.com/fake", "https://files.oaiusercontent.com/redirect"]) {
    const rejected = await remote.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitAttachment: { ...attachment, download_url } } });
    assert.equal(rejected.isError, true, download_url.split("?")[0]);
    assert.equal(JSON.stringify(rejected).includes("temporary-secret"), false);
  }
  const ambiguous = await remote.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitAttachment: attachment, portraitData: PNG.toString("base64") } });
  assert.equal(ambiguous.isError, true);
  const remotePath = await remote.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitFile: generated } });
  assert.equal(remotePath.isError, true);
  const remoteUploadPath = await remote.callTool({ name: "upload_image", arguments: { category: "portraits", file: generated } });
  assert.equal(remoteUploadPath.isError, true);
  const owner = character.user_id;
  character.user_id = "another-user";
  const forbidden = await remote.callTool({ name: "set_character_art", arguments: { characterId: 95, portraitAttachment: attachment } });
  assert.equal(forbidden.isError, true);
  character.user_id = owner;
  assert.equal(uploads.length, beforeBad);
  assert.deepEqual(character.details, beforeDetails);
  await remote.close();

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

  const relative = await client.callTool({
    name: "set_character_art",
    arguments: { characterId: 95, portraitUrl: "/portraits/thalanis-reed.jpg" },
  });
  assert.equal(relative.isError, undefined);
  assert.equal((character.details as { image_url?: string }).image_url, "https://cdn.example/portraits/jpeg");
  assert.equal(uploads.at(-1)?.category, "portraits");
  assert.equal(uploads.at(-1)?.type, "jpeg");

  const missed = await client.callTool({
    name: "set_campaign_art",
    arguments: { campaignId: 7, imageUrl: "/portraits/missing.jpg" },
  });
  assert.equal(missed.isError, undefined);
  assert.equal(
    (campaign.meta_data as { image_url?: string }).image_url,
    "https://wgui.wandersguide.site/portraits/missing.jpg",
  );

  nextUploadUrl = "http://kong:8000/storage/v1/object/public/portraits/user-1/a%20b.jpeg";
  const kong = await client.callTool({ name: "upload_image", arguments: { category: "portraits", data: JPEG.toString("base64") } });
  assert.equal(kong.isError, undefined);
  assert.equal(
    (kong.structuredContent as { url: string }).url,
    "https://amba.wandersguide.site/storage/v1/object/public/portraits/user-1/a%20b.jpeg",
  );

  const storedKong = await client.callTool({
    name: "set_character_art",
    arguments: { characterId: 95, portraitUrl: "http://kong:8000/storage/v1/object/public/backgrounds/user-1/broken.webp" },
  });
  assert.equal(storedKong.isError, true);
  assert.match(JSON.stringify(storedKong.content), /not an image|Image must be PNG/);

  const blob = await client.callTool({
    name: "set_character_art",
    arguments: { characterId: 95, portraitUrl: "blob:https://amba.wandersguide.site/11111111-1111-1111-1111-111111111111" },
  });
  assert.equal(blob.isError, true);
  assert.equal((character.details as { image_url?: string }).image_url, "https://cdn.example/portraits/jpeg");

  nextUploadUrl = "http://kong:8000/storage/v1/object/public/backgrounds/user-1/broken.webp";
  const broken = await client.callTool({ name: "upload_image", arguments: { category: "backgrounds", data: WEBP.toString("base64") } });
  assert.equal(broken.isError, true);
  const invalidImageDiagnostics = (broken.structuredContent?.data as { storageDiagnostics?: { reason: string } })?.storageDiagnostics;
  assert.equal(invalidImageDiagnostics?.reason, "storage-response-not-image");

  // The production failure: successful upload, rewritten storage GET returns 400.
  // Capture diagnostics, verify redaction, and prove the character write never runs.
  const beforeFailedStorage = structuredClone(character);
  const priorUploadCount = uploads.length;
  const diagnostics: string[] = [];
  const previousError = console.error;
  const returnedReports: unknown[] = [];
  console.error = (...args: unknown[]) => { diagnostics.push(args.map(String).join(" ")); };
  try {
    nextUploadUrl = "http://kong:8000/storage/v1/object/public/portraits/user-1/diagnostic.webp?token=hidden-query";
    const failedStorage = await client.callTool({
      name: "set_character_art", arguments: { characterId: 95, portraitData: WEBP.toString("base64") },
    });
    assert.equal(failedStorage.isError, true);
    assert.equal(failedStorage.structuredContent?.code, "VALIDATION_ERROR");
    assert.equal(failedStorage.structuredContent?.retryable, false);
    const returnedData = failedStorage.structuredContent?.data as { storageDiagnostics?: unknown };
    assert.ok(returnedData?.storageDiagnostics);
    returnedReports.push(returnedData.storageDiagnostics);
    const content = failedStorage.content as Array<{ type: string; text?: string }>;
    const text = content.find(part => part.type === "text")?.text ?? "";
    assert.ok(text.startsWith("Image URL returned 400.\n"));
    assert.deepEqual(JSON.parse(text.slice(text.indexOf("\n") + 1)), failedStorage.structuredContent);
    assert.doesNotMatch(JSON.stringify(failedStorage), /hidden-query|hidden-redirect|hidden-body|test-token/);
    assert.equal(uploads.length, priorUploadCount + 1);
    assert.deepEqual(character, beforeFailedStorage);

    nextUploadUrl = "http://kong:8000/storage/v1/object/public/portraits/user-1/diagnostic.webp?token=hidden-query";
    const failedUpload = await client.callTool({
      name: "upload_image", arguments: { category: "portraits", data: WEBP.toString("base64") },
    });
    assert.equal(failedUpload.isError, true);
    assert.equal(failedUpload.structuredContent?.retryable, false);
    returnedReports.push((failedUpload.structuredContent?.data as { storageDiagnostics?: unknown })?.storageDiagnostics);
    assert.doesNotMatch(JSON.stringify(failedUpload), /hidden-query|hidden-redirect|hidden-body|test-token/);
    assert.deepEqual(character, beforeFailedStorage);
  } finally {
    console.error = previousError;
  }
  const lines = diagnostics.filter(line => line.startsWith("[wgui-mcp] storage-image-verification "));
  assert.equal(lines.length, 2);
  const log = JSON.parse(lines[0].slice("[wgui-mcp] storage-image-verification ".length));
  assert.deepEqual(returnedReports, [log, log]);
  assert.equal(lines[1], lines[0]);
  assert.equal(log.originalUrl, "http://kong:8000/storage/v1/object/public/portraits/user-1/diagnostic.webp");
  assert.equal(log.rewrittenUrl, "https://amba.wandersguide.site/storage/v1/object/public/portraits/user-1/diagnostic.webp");
  assert.equal(log.publicStorageOrigin, "https://amba.wandersguide.site");
  assert.equal(log.category, "portraits");
  assert.equal(log.reason, "storage-fetch-failed");
  assert.deepEqual(log.hops.map((hop: { status: number }) => hop.status), [302, 400]);
  assert.equal(log.hops[0].redirectUrl, "https://storage.example/storage/v1/object/public/portraits/user-1/diagnostic.webp");
  assert.equal(log.hops[1].finalUrl, log.hops[0].redirectUrl);
  assert.equal(log.hops[1].contentType, "application/json");
  assert.deepEqual(log.responseBody.fields, { statusCode: "400", error: "InvalidRequest", message: "Bad Request" });
  assert.doesNotMatch(lines[0], /hidden-query|hidden-redirect|hidden-body|test-token/);

  await client.close();
  setCharacterFetch(null);
});
