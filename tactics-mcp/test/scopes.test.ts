import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startTacticsHttp } from "../src/http.js";
import { consumeCode, issueCode, rememberLogin, resetCodes, takeLogin } from "../src/oauth.js";
import { getEncounterReader, setEncounterReader, type EncounterReader } from "../src/reader.js";
import { createTacticsMcpServer, scopeForTool, TACTICS_MCP_DESCRIPTION, TACTICS_MCP_NAME } from "../src/server.js";
import { mintToken, normalizeScopes, resetTokens, resolveBearer } from "../src/tokens.js";

const WRITE_TOOLS = ["ensure_public_user", "join_campaign", "patch_encounter_dice"];

function textOf(response: { content?: unknown[] }) {
  return String((response.content?.[0] as { text?: string } | undefined)?.text ?? "");
}

describe("tactics scopes", { concurrency: 1 }, () => {
  before(() => {
    process.env.TACTICS_MCP_TOKEN_FILE = join(mkdtempSync(join(tmpdir(), "tactics-scopes-")), "tokens.json");
    resetTokens();
    resetCodes();
  });

  test("omitted scopes stay read-only and unknown scopes are rejected", () => {
    assert.deepEqual(normalizeScopes(undefined), ["read"]);
    assert.deepEqual(normalizeScopes(null), ["read"]);
    assert.deepEqual(normalizeScopes(["write", "read", "read"]), ["read", "write"]);
    assert.deepEqual(normalizeScopes("  write   read  "), ["read", "write"]);
    assert.throws(() => normalizeScopes(""), { message: "EMPTY_SCOPES" });
    assert.throws(() => normalizeScopes([]), { message: "EMPTY_SCOPES" });
    assert.throws(() => normalizeScopes(["read", "admin"]), { message: "UNKNOWN_SCOPE" });

    resetTokens();
    const existing = mintToken({ userId: "user-1" });
    assert.deepEqual(existing.row.scopes, ["read"]);
    assert.deepEqual(resolveBearer(existing.token)?.scopes, ["read"]);
    assert.deepEqual(mintToken({ userId: "user-1", scopes: "read write" }).row.scopes, ["read", "write"]);
    assert.throws(() => mintToken({ userId: "user-1", scopes: ["write", "owner"] }), { message: "UNKNOWN_SCOPE" });
  });

  test("authorization codes carry the requested scopes", () => {
    resetCodes();
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUri = "https://chatgpt.com/connector/oauth/abc";
    const code = issueCode({ userId: "user", clientId: "chatgpt", codeChallenge: challenge, redirectUri, scopes: "write read" });
    assert.deepEqual(consumeCode({ code, verifier, redirectUri, clientId: "chatgpt" }), {
      userId: "user",
      scopes: ["read", "write"],
    });

    const login = rememberLogin({
      state: "state-1",
      clientId: "chatgpt",
      challenge,
      redirectUri,
      scopes: ["write"],
    });
    assert.deepEqual(takeLogin(login.id)?.scopes, ["write"]);
  });

  test("read tokens call lookup tools and write tokens call the three writes", async () => {
    const original = getEncounterReader();
    let writes = 0;
    setEncounterReader({
      ...original,
      async profile(userId) {
        return { id: userId, email: "gm@example.com", name: "GM" };
      },
      async ensurePublicUser(userId) {
        writes += 1;
        return { ok: true, data: { userId, displayName: "GM", created: false } };
      },
      async joinCampaign(_userId, characterId) {
        writes += 1;
        return { ok: true, data: { characterId, campaignId: 44, campaignName: "s2", already: false } };
      },
      async patchEncounterDice() {
        writes += 1;
        return { ok: true, data: { diceRollState: { title: "t" }, diceRollLog: [] } };
      },
    } as EncounterReader);

    const granted = { scopes: ["read"] };
    const server = createTacticsMcpServer(() => "user-1", () => granted.scopes, "http://127.0.0.1");
    const client = new Client({ name: "scope-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const info = client.getServerVersion();
      assert.equal(info?.name, TACTICS_MCP_NAME);
      assert.equal(info?.description, TACTICS_MCP_DESCRIPTION);

      const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
      assert.equal(names.length, 23);
      assert.deepEqual(names.filter((name) => scopeForTool(name) === "write"), [...WRITE_TOOLS].sort());
      assert.equal(names.filter((name) => scopeForTool(name) === "read").length, 20);
      assert.equal(scopeForTool("not_a_tool"), null);

      const profile = await client.callTool({ name: "get_profile", arguments: {} });
      assert.match(textOf(profile), /gm@example.com/);
      const encounters = await client.callTool({ name: "list_encounters", arguments: { view: "gm", campaignId: 1 } });
      assert.match(textOf(encounters), /No encounters/);

      for (const name of WRITE_TOOLS) {
        const denied = await client.callTool({
          name,
          arguments: name === "join_campaign"
            ? { characterId: 7, joinKey: "secret" }
            : name === "patch_encounter_dice"
              ? { campaignId: 1, encounterId: 2, diceRollState: { title: "t" } }
              : {},
        });
        assert.equal(denied.isError, true);
        assert.equal(textOf(denied), `MCP token missing scope write for ${name}.`);
      }
      assert.equal(writes, 0);

      granted.scopes = ["write"];
      const readDenied = await client.callTool({ name: "get_profile", arguments: {} });
      assert.equal(textOf(readDenied), "MCP token missing scope read for get_profile.");
      const ensured = await client.callTool({ name: "ensure_public_user", arguments: {} });
      assert.match(textOf(ensured), /Profile already exists/);
      const joined = await client.callTool({ name: "join_campaign", arguments: { characterId: 7, joinKey: "secret" } });
      assert.match(textOf(joined), /Joined the campaign/);
      const patched = await client.callTool({
        name: "patch_encounter_dice",
        arguments: { campaignId: 1, encounterId: 2, diceRollState: { title: "t" } },
      });
      assert.match(textOf(patched), /Dice updated/);
      assert.equal(writes, 3);

      granted.scopes = ["read", "write"];
      const again = await client.callTool({ name: "get_profile", arguments: {} });
      assert.match(textOf(again), /gm@example.com/);
    } finally {
      await client.close();
      await server.close();
      setEncounterReader(original);
    }
  });

  test("discovery and the token endpoint grant write only when the client asks", async () => {
    const saved = {
      port: process.env.TACTICS_MCP_PORT,
      dev: process.env.TACTICS_MCP_DEV_MINT,
      host: process.env.TACTICS_MCP_HOST,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnon: process.env.SUPABASE_ANON_KEY,
      serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
      chatgpt: process.env.CHATGPT_MCP_CLIENT_ID,
    };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CHATGPT_MCP_CLIENT_ID;
    process.env.TACTICS_MCP_DEV_MINT = "1";
    process.env.TACTICS_MCP_HOST = "127.0.0.1";
    process.env.TACTICS_MCP_PORT = "0";
    resetTokens();
    resetCodes();

    const original = getEncounterReader();
    const httpServer = startTacticsHttp();
    setEncounterReader({
      ...original,
      async profile(userId) {
        return { id: userId, email: "gm@example.com", name: "GM" };
      },
      async ensurePublicUser(userId) {
        return { ok: true, data: { userId, displayName: "GM", created: true } };
      },
    } as EncounterReader);
    await new Promise<void>((resolve) => httpServer.once("listening", resolve));
    const address = httpServer.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    function authorizeQuery(scope?: string) {
      const params = new URLSearchParams({
        response_type: "code",
        code_challenge_method: "S256",
        state: "state-1",
        code_challenge: "challenge-1",
        redirect_uri: "https://chatgpt.com/connector/oauth/abc",
        client_id: "chatgpt",
      });
      if (scope !== undefined) params.set("scope", scope);
      return `${base}/oauth/mcp/authorize?${params}`;
    }

    const clients: Client[] = [];
    try {
      const health = await fetch(`${base}/health`).then((response) => response.json()) as { surface?: string };
      assert.equal(health.surface, "wgui-tactics");

      const resource = await fetch(`${base}/.well-known/oauth-protected-resource`).then((response) => response.json()) as { scopes_supported?: string[] };
      const authorization = await fetch(`${base}/.well-known/oauth-authorization-server`).then((response) => response.json()) as { scopes_supported?: string[] };
      assert.deepEqual(resource.scopes_supported, ["read", "write"]);
      assert.deepEqual(authorization.scopes_supported, ["read", "write"]);

      const missing = await fetch(`${base}/mcp`);
      assert.equal(missing.status, 401);
      assert.match(missing.headers.get("www-authenticate") ?? "", /scope="read"/);

      const unknownScope = await fetch(authorizeQuery("read admin"));
      assert.equal(unknownScope.status, 400);
      assert.equal((await unknownScope.json() as { error?: string }).error, "invalid_scope");
      const writeOnly = await fetch(authorizeQuery("write"));
      assert.equal(writeOnly.status, 500);

      process.env.SUPABASE_URL = "https://example.supabase.co";
      process.env.SUPABASE_ANON_KEY = "anon";
      const loginPage = await fetch(authorizeQuery("read write"));
      assert.equal(loginPage.status, 200);
      const cookie = /wgui_mcp_login=([^;]+)/.exec(loginPage.headers.get("set-cookie") ?? "");
      assert.ok(cookie);
      assert.deepEqual(takeLogin(decodeURIComponent(cookie[1]))?.scopes, ["read", "write"]);

      const minted = await fetch(`${base}/api/mcp-tokens`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wgui-user": "user-1" },
        body: JSON.stringify({ label: "existing" }),
      });
      assert.equal(minted.status, 201);
      const readToken = await minted.json() as { token: string; row: { scopes: string[] } };
      assert.deepEqual(readToken.row.scopes, ["read"]);

      const rejected = await fetch(`${base}/api/mcp-tokens`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wgui-user": "user-1" },
        body: JSON.stringify({ scopes: ["read", "admin"] }),
      });
      assert.equal(rejected.status, 400);

      async function exchange(scope?: string) {
        const verifier = randomBytes(32).toString("base64url");
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        const authorized = await fetch(`${base}/oauth/mcp/authorize`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${readToken.token}` },
          body: JSON.stringify({
            code_challenge: challenge,
            redirect_uri: "http://localhost/cb",
            ...(scope === undefined ? {} : { scope }),
          }),
        });
        assert.equal(authorized.status, 200);
        const code = (await authorized.json() as { code: string }).code;
        const traded = await fetch(`${base}/oauth/mcp/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: "http://localhost/cb" }),
        });
        assert.equal(traded.status, 200);
        return traded.json() as Promise<{ access_token: string; scope: string }>;
      }

      const implicit = await exchange();
      assert.equal(implicit.scope, "read");
      const asked = await exchange("write read");
      assert.equal(asked.scope, "read write");
      const bad = await fetch(`${base}/oauth/mcp/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${readToken.token}` },
        body: JSON.stringify({ code_challenge: "x", redirect_uri: "http://localhost/cb", scope: "read owner" }),
      });
      assert.equal(bad.status, 400);
      assert.equal((await bad.json() as { error?: string }).error, "invalid_scope");

      async function call(token: string, name: string) {
        const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        });
        const mcp = new Client({ name: "scope-http", version: "1" });
        clients.push(mcp);
        await mcp.connect(transport);
        return mcp.callTool({ name, arguments: {} });
      }

      const denied = await call(readToken.token, "ensure_public_user");
      assert.equal(textOf(denied), "MCP token missing scope write for ensure_public_user.");
      const stillReads = await call(implicit.access_token, "get_profile");
      assert.match(textOf(stillReads), /gm@example.com/);
      const written = await call(asked.access_token, "ensure_public_user");
      assert.match(textOf(written), /Profile created/);
    } finally {
      await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      setEncounterReader(original);
      if (saved.port === undefined) delete process.env.TACTICS_MCP_PORT;
      else process.env.TACTICS_MCP_PORT = saved.port;
      if (saved.dev === undefined) delete process.env.TACTICS_MCP_DEV_MINT;
      else process.env.TACTICS_MCP_DEV_MINT = saved.dev;
      if (saved.host === undefined) delete process.env.TACTICS_MCP_HOST;
      else process.env.TACTICS_MCP_HOST = saved.host;
      if (saved.supabaseUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = saved.supabaseUrl;
      if (saved.supabaseAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
      else process.env.SUPABASE_ANON_KEY = saved.supabaseAnon;
      if (saved.serviceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.serviceRole;
      if (saved.chatgpt === undefined) delete process.env.CHATGPT_MCP_CLIENT_ID;
      else process.env.CHATGPT_MCP_CLIENT_ID = saved.chatgpt;
    }
  });
});
