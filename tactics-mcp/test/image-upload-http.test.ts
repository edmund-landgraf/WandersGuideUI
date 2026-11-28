import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startTacticsHttp } from "../src/http.js";
import { mintToken, resetTokens } from "../src/tokens.js";
import { setCharacterFetch } from "../src/character-client.js";
import { MAX_IMAGE_BYTES } from "../src/image-upload.js";

// A valid small PNG fixture; the attachment download URL is only a mock.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const attachment = {
  file_id: "file-generated-fixture",
  download_url: "https://files.oaiusercontent.com/generated?sig=temporary-secret",
  file_name: "generated.png",
  mime_type: "image/png",
};
const json = (data: unknown) => Response.json({ status: "success", data });

test("remote HTTP MCP advertises attachment fields and saves uploaded bytes only for an authorized owner", { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "wgui-portrait-http-"));
  const env = { TACTICS_MCP_TOKEN_FILE: join(directory, "tokens.json"), TACTICS_MCP_HOST: "127.0.0.1", TACTICS_MCP_PORT: "0", WG_ACCESS_TOKEN: "fixture-token", SUPABASE_URL: "http://127.0.0.1:8000", SUPABASE_ANON_KEY: "fixture-anon" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  resetTokens();
  const writeToken = mintToken({ userId: "owner", scopes: ["read", "write"] }).token;
  const readToken = mintToken({ userId: "owner", scopes: ["read"] }).token;
  let row = { id: 49, user_id: "owner", updated_at: "t0", details: { image_url: "https://cdn.example/old.png", ancestry: { name: "Human" } } };
  let downloads = 0;
  let uploads = 0;
  let saves = 0;
  let oversizedCancelled = false;
  setCharacterFetch(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "files.oaiusercontent.com") {
      downloads++;
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      assert.equal(new Headers(init?.headers).has("apikey"), false);
      if (url.pathname === "/oversized") {
        // No Content-Length: the body itself must be bounded.
        let sent = 0;
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
            sent += 64 * 1024;
            if (sent > MAX_IMAGE_BYTES + 128 * 1024) controller.close();
          },
          cancel() { oversizedCancelled = true; },
        }), { headers: { "content-type": "image/png" } });
      }
      if (url.pathname === "/expired") return new Response(null, { status: 403 });
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.pathname.endsWith("/find-character")) {
      assert.equal(body.id, 49);
      return json(row);
    }
    if (url.pathname.endsWith("/upload-public-file")) {
      uploads++;
      assert.equal(body.category, "portraits");
      assert.equal(body.type, "png");
      assert.equal(body.data, PNG.toString("base64"));
      return json({ url: "https://cdn.example/new.png" });
    }
    if (url.pathname.endsWith("/update-character")) {
      saves++;
      assert.equal(body.id, 49);
      assert.equal(body.expected_updated_at, row.updated_at);
      row = { ...row, details: body.details, updated_at: "t1" };
      return json(row);
    }
    throw new Error("Unexpected fixture request");
  });

  const server = startTacticsHttp();
  const clients: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
  try {
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    async function connect(token: string) {
      const client = new Client({ name: "portrait-http-regression", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
      clients.push({ client, transport });
      await client.connect(transport);
      return client;
    }
    const client = await connect(writeToken);
    const listed = await client.listTools();
    const art = listed.tools.find(tool => tool.name === "set_character_art");
    const upload = listed.tools.find(tool => tool.name === "upload_image");
    const campaign = listed.tools.find(tool => tool.name === "set_campaign_art");
    assert.deepEqual(art?._meta?.["openai/fileParams"], ["portraitAttachment", "backgroundAttachment"]);
    assert.deepEqual(upload?._meta?.["openai/fileParams"], ["attachment"]);
    assert.deepEqual(campaign?._meta?.["openai/fileParams"], ["imageAttachment"]);
    const property = art?.inputSchema.properties?.portraitAttachment as { required?: string[] };
    assert.deepEqual(new Set(property.required), new Set(["download_url", "file_id"]));

    const reader = await connect(readToken);
    const denied = await reader.callTool({ name: "set_character_art", arguments: { characterId: 49, portraitAttachment: attachment } });
    assert.equal(denied.isError, true);
    assert.equal(downloads, 0);
    assert.equal(uploads, 0);
    assert.equal(saves, 0);

    const saved = await client.callTool({ name: "set_character_art", arguments: { characterId: 49, portraitAttachment: attachment } });
    assert.ok(!saved.isError, JSON.stringify(saved.content));
    assert.equal(saved.structuredContent?.image_url, "https://cdn.example/new.png");
    assert.equal(row.details.image_url, "https://cdn.example/new.png");
    assert.equal(row.details.ancestry.name, "Human");
    assert.equal(downloads, 1);
    assert.equal(uploads, 1);
    assert.equal(saves, 1);
    assert.ok(!JSON.stringify(saved).includes("temporary-secret"));

    const uploaded = await client.callTool({ name: "upload_image", arguments: { category: "portraits", attachment } });
    assert.ok(!uploaded.isError, JSON.stringify(uploaded.content));
    assert.equal(uploaded.structuredContent?.url, "https://cdn.example/new.png");
    assert.equal(uploads, 2);
    assert.equal(saves, 1);

    for (const path of ["expired", "oversized"]) {
      const failed = await client.callTool({ name: "set_character_art", arguments: { characterId: 49, portraitAttachment: { ...attachment, download_url: `https://files.oaiusercontent.com/${path}?sig=temporary-secret` } } });
      assert.equal(failed.isError, true);
      assert.ok(!JSON.stringify(failed).includes("temporary-secret"));
      if (path === "oversized") assert.match(JSON.stringify(failed.content), /2 MB/);
    }
    assert.equal(oversizedCancelled, true);
    assert.equal(uploads, 2);
    assert.equal(saves, 1);
    assert.equal(row.details.image_url, "https://cdn.example/new.png");
  } finally {
    for (const { client, transport } of clients.reverse()) {
      await transport.terminateSession().catch(() => {});
      await client.close().catch(() => {});
    }
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    setCharacterFetch(null);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
