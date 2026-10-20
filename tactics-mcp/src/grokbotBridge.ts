import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";

// One process per user. Secrets never enter tool arguments or stdout diagnostics.
const token = process.env.WGUI_MCP_TOKEN?.trim();
if (!token) throw new Error("Set WGUI_MCP_TOKEN in the bot host's secret environment");
const endpoint = new URL(process.env.WGUI_MCP_URL ?? "https://wgui.wandersguide.site/mcp");
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) ||
    endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
  throw new Error("WGUI_MCP_URL requires HTTPS (HTTP allowed only on loopback), without credentials, query or fragment");
}

let client!: Client;
let catalog: Tool[] = [];
const validator = new AjvJsonSchemaValidator();
let validators = new Map<string, ReturnType<typeof validator.getValidator>>();

async function connect() {
  const next = new Client({ name: "grokbot-wgui", version: "1.0.0" });
  await next.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
  }));
  client = next;
}

async function discover() {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("Repeated discovery cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const nextValidators = new Map(tools.map(tool => [tool.name, validator.getValidator(tool.inputSchema)]));
  catalog = tools;
  validators = nextValidators;
}

async function refresh() {
  try {
    await discover();
  } catch (error) {
    if (!(error instanceof StreamableHTTPError) || error.code !== 404) throw error;
    await client.close();
    await connect();
    await discover();
  }
}

function failure(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

const server = new Server({ name: "grokbot-wgui-bridge", version: "1.0.0" }, {
  capabilities: { tools: {} },
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    await refresh();
    return { tools: catalog };
  } catch {
    throw new Error("WGUI discovery failed; check endpoint and token");
  }
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const check = validators.get(request.params.name);
  if (!check) return failure("Unknown WGUI tool. Refresh tools/list before calling.");
  if (!check(request.params.arguments ?? {}).valid) return failure("Arguments do not match the discovered WGUI tool schema.");
  try {
    return await client.callTool({ name: request.params.name, arguments: request.params.arguments });
  } catch {
    return failure("WGUI call failed. Refresh tools/list, inspect current state, and decide whether to retry.");
  }
});

async function close() {
  await server.close();
  await client?.close();
}
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
let startupStage = "connect";
try {
  await connect();
  startupStage = "discover tools";
  await discover();
  startupStage = "start stdio";
  await server.connect(new StdioServerTransport());
} catch {
  console.error(`Grokbot WGUI bridge failed to ${startupStage}; check WGUI_MCP_URL and WGUI_MCP_TOKEN`);
  await client?.close();
  process.exitCode = 1;
}
