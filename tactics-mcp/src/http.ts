import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { consumeCode, issueCode } from "./oauth.js";
import { createTacticsMcpServer } from "./server.js";
import { listTokens, mintToken, resolveBearer, revokeToken } from "./tokens.js";

const MCP_BODY_BYTES = 64 * 1024;
const MAX_INFLIGHT = 8;
const REQUEST_TIMEOUT_MS = 15_000;

const PUBLIC_PATHS = new Set([
  "/health",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/oauth/mcp/authorize",
  "/oauth/mcp/token",
]);

type Session = { transport: StreamableHTTPServerTransport };
const sessions = new Map<string, Session>();
let inflight = 0;

function log(message: string) {
  console.error(`[wgui-mcp] ${message}`);
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra?: Record<string, string>) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    ...extra,
  });
  res.end(payload);
}

function pathOf(url: string) {
  return url.split("?")[0] ?? "/";
}

function readBearer(req: IncomingMessage) {
  const header = req.headers.authorization;
  if (!header || Array.isArray(header) || !header.toLowerCase().startsWith("bearer ")) return undefined;
  return header.slice("bearer ".length).trim();
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MCP_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as Record<string, unknown>;
}

function metadataUrl(req: IncomingMessage) {
  const host = req.headers.host ?? "127.0.0.1:3104";
  return `http://${host}/.well-known/oauth-protected-resource`;
}

function issuer(req: IncomingMessage) {
  return `http://${req.headers.host ?? "127.0.0.1:3104"}`;
}

function userFromDevOrBearer(req: IncomingMessage) {
  if (process.env.TACTICS_MCP_DEV_MINT === "1") {
    const dev = req.headers["x-wgui-user"];
    const userId = Array.isArray(dev) ? dev[0] : dev;
    if (userId) return userId;
  }
  const secret = readBearer(req);
  if (!secret) return null;
  return resolveBearer(secret)?.userId ?? null;
}

export function readHttpConfig() {
  const host = process.env.TACTICS_MCP_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.TACTICS_MCP_PORT ?? "3104");
  return { host, port };
}

export function startTacticsHttp() {
  const { host, port } = readHttpConfig();
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(`WGUI MCP will not bind ${host}. Use 127.0.0.1.`);
    process.exit(1);
  }

  const httpServer = createServer((req, res) => {
    const requestId = randomUUID();
    const started = Date.now();
    const timer = setTimeout(() => {
      if (!res.headersSent) sendJson(res, 408, { error: "Request timeout", requestId });
      req.destroy();
    }, REQUEST_TIMEOUT_MS);

    void (async () => {
      try {
        const path = pathOf(req.url ?? "/");
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, x-wgui-user",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          });
          res.end();
          return;
        }
        if (req.method === "GET" && path === "/health") {
          sendJson(res, 200, { ok: true, transport: "streamable-http", surface: "wgui-readonly" });
          return;
        }
        if (req.method === "GET" && path === "/.well-known/oauth-protected-resource") {
          const base = issuer(req);
          sendJson(res, 200, {
            resource: `${base}/mcp`,
            authorization_servers: [base],
            scopes_supported: ["read"],
            bearer_methods_supported: ["header"],
          });
          return;
        }
        if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") {
          const base = issuer(req);
          sendJson(res, 200, {
            issuer: base,
            authorization_endpoint: `${base}/oauth/mcp/authorize`,
            token_endpoint: `${base}/oauth/mcp/token`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
            scopes_supported: ["read"],
          });
          return;
        }
        if (req.method === "POST" && path === "/oauth/mcp/authorize") {
          const body = await readJson(req);
          const userId = userFromDevOrBearer(req);
          if (!userId) {
            sendJson(res, 401, { error: "Unauthorized", code: "AUTH_REQUIRED" });
            return;
          }
          const challenge = typeof body?.code_challenge === "string" ? body.code_challenge : "";
          const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : "";
          if (!challenge || !redirectUri) {
            sendJson(res, 400, { error: "VALIDATION_ERROR" });
            return;
          }
          const code = issueCode({ userId, codeChallenge: challenge, redirectUri });
          sendJson(res, 200, { code, state: body?.state ?? null });
          return;
        }
        if (req.method === "POST" && path === "/oauth/mcp/token") {
          // The token endpoint accepts a code and PKCE verifier. It does not read a session.
          const body = await readJson(req);
          const code = typeof body?.code === "string" ? body.code : "";
          const verifier = typeof body?.code_verifier === "string" ? body.code_verifier : "";
          const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : "";
          const userId = consumeCode({ code, verifier, redirectUri });
          if (!userId) {
            sendJson(res, 400, { error: "INVALID_GRANT" });
            return;
          }
          const minted = mintToken({ userId, label: "OAuth" });
          sendJson(res, 200, { access_token: minted.token, token_type: "Bearer", scope: "read" });
          return;
        }

        if (process.env.TACTICS_MCP_DEV_MINT === "1" && req.method === "POST" && path === "/api/mcp-tokens" && !readBearer(req)) {
          const dev = req.headers["x-wgui-user"];
          const userId = Array.isArray(dev) ? dev[0] : dev;
          if (!userId) {
            sendJson(res, 401, { error: "Unauthorized", code: "AUTH_REQUIRED" });
            return;
          }
          const body = await readJson(req);
          const minted = mintToken({ userId, label: typeof body?.label === "string" ? body.label : "dev", scopes: body?.scopes });
          sendJson(res, 201, minted);
          return;
        }

        if (!PUBLIC_PATHS.has(path)) {
          const secret = readBearer(req);
          const row = secret ? resolveBearer(secret) : null;
          if (!row) {
            // The wrapper rejects unauthenticated /mcp. The SDK never sees this request, and its auth handling is unused.
            sendJson(res, 401, { error: "Unauthorized", code: "AUTH_REQUIRED" }, {
              "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl(req)}", scope="read"`,
            });
            return;
          }
          if (path === "/api/mcp-tokens" && req.method === "GET") {
            sendJson(res, 200, { tokens: listTokens(row.userId) });
            return;
          }
          if (path === "/api/mcp-tokens" && req.method === "POST") {
            const body = await readJson(req);
            const minted = mintToken({ userId: row.userId, label: typeof body?.label === "string" ? body.label : undefined, scopes: body?.scopes });
            sendJson(res, 201, minted);
            return;
          }
          if (path.startsWith("/api/mcp-tokens/") && req.method === "DELETE") {
            const id = path.slice("/api/mcp-tokens/".length);
            const removed = revokeToken(row.userId, id);
            if (!removed) sendJson(res, 404, { error: "NOT_FOUND" });
            else {
              res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
              res.end();
            }
            return;
          }
          if (path === "/mcp") {
            if (inflight >= MAX_INFLIGHT) {
              sendJson(res, 429, { error: "Too many requests", code: "RATE_LIMITED" });
              return;
            }
            inflight += 1;
            try {
              const parsed = await readJson(req);
              await handleMcp(req, res, parsed, row.userId, row.scopes);
            } finally {
              inflight -= 1;
            }
            return;
          }
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        sendJson(res, 404, { error: "Not found" });
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
        const emptyScopes = error instanceof Error && error.message === "EMPTY_SCOPES";
        if (!res.headersSent) {
          if (tooLarge) sendJson(res, 413, { error: "Payload too large" });
          else if (emptyScopes || error instanceof SyntaxError) sendJson(res, 400, { error: "VALIDATION_ERROR" });
          else sendJson(res, 500, { error: "INTERNAL_ERROR" });
        }
        log(`error requestId=${requestId}`);
      } finally {
        clearTimeout(timer);
        if (pathOf(req.url ?? "/") !== "/health") {
          log(`${req.method ?? "?"} ${pathOf(req.url ?? "/")} -> ${res.statusCode} ${Date.now() - started}ms`);
        }
      }
    })();
  });

  httpServer.listen(port, host, () => {
    log(`listening on http://${host}:${port}/mcp`);
  });
  return httpServer;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, parsedBody: unknown, userId: string, scopes: string[]) {
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (!existing) {
      sendJson(res, 404, { error: "Unknown MCP session" });
      return;
    }
    await existing.transport.handleRequest(req, res, parsedBody);
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 400, { error: "Missing mcp-session-id" });
    return;
  }
  const mcp = createTacticsMcpServer(() => userId, () => scopes);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport });
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  await mcp.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}

const isDirectRun = process.argv[1]?.replaceAll("\\", "/").endsWith("/src/http.ts");
if (isDirectRun) startTacticsHttp();
