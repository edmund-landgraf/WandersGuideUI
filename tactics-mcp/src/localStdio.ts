import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createTacticsMcpServer } from "./server.js";
import { installSupabaseReader } from "./supabase-reader.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const DEFAULT_TEST_EMAIL = "test2@tester.com";
const DEFAULT_TEST_PASSWORD = "atest2";

async function signIn(email: string, password: string) {
  const base = required("SUPABASE_URL").replace(/\/$/, "");
  const anon = required("SUPABASE_ANON_KEY");
  const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; user?: { id?: string }; msg?: string; error_description?: string };
  if (!response.ok || !body.access_token || !body.user?.id) {
    throw new Error(body.error_description || body.msg || `Supabase sign-in failed (${response.status})`);
  }
  return { token: body.access_token, userId: body.user.id };
}

const email = process.env.WG_STDIO_TEST_EMAIL?.trim() || DEFAULT_TEST_EMAIL;
const password = process.env.WG_STDIO_TEST_PASSWORD?.trim() || DEFAULT_TEST_PASSWORD;
const session = await signIn(email, password);
process.env.WG_ACCESS_TOKEN = session.token;
if (!installSupabaseReader()) throw new Error("Supabase reader requires SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY");

const server = createTacticsMcpServer(() => session.userId, () => ["read", "write"], "http://127.0.0.1:0");
await server.connect(new StdioServerTransport());
