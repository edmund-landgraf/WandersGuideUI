import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { allowedMcpRedirect, consumeCode, issueCode, resetCodes } from "../src/oauth.js";

const callback = "https://www.cursor.com/agents/mcp/oauth/callback";

test("grokbot must use the pre-registered client and exact callback", () => {
  delete process.env.GROKBOT_MCP_CLIENT_ID;
  delete process.env.GROKBOT_MCP_REDIRECT_URI;
  assert.equal(allowedMcpRedirect(callback, "grokbot-wgui"), true);
  assert.equal(allowedMcpRedirect(callback, "grokbot-amba"), false);
  assert.equal(allowedMcpRedirect("https://www.cursor.com/agents/mcp/oauth/other", "grokbot-wgui"), false);
  assert.equal(allowedMcpRedirect("http://localhost/cb", "grokbot-wgui"), false);
  assert.equal(allowedMcpRedirect("https://chatgpt.com/connector/oauth/abc", "chatgpt"), true);
});

test("token exchange rejects a different client id", () => {
  resetCodes();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const code = issueCode({ userId: "user", clientId: "grokbot-wgui", codeChallenge: challenge, redirectUri: callback });
  assert.equal(consumeCode({ code, verifier, redirectUri: callback, clientId: "grokbot-amba" }), null);
  const again = issueCode({ userId: "user", clientId: "grokbot-wgui", codeChallenge: challenge, redirectUri: callback });
  assert.deepEqual(consumeCode({ code: again, verifier, redirectUri: callback, clientId: "grokbot-wgui" }), {
    userId: "user",
    scopes: ["read"],
  });
});
