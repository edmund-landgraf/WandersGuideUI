# LLMOps and MCP-to-API observability

Status: planning only. This document does not change the MCP server, the UI, or the edge functions.

The question is whether LLMOps is worth adding to WandersGuideUI, and if so how small the first slice can be. The useful outcome is a measured picture of how agents use the `wgui-tactics` tools, which Supabase calls those tools turn into, and which of those sequences are worth changing in the tool surface or in the API.

## Questions to answer

1. **How the tools are actually used.** Which tools run most and least often, in what order, with what error codes, retries, validation failures, latency, and response size. Split by MCP session and, once we have it, by client family (Cursor, ChatGPT, Grokbot, a local stdio process).
2. **How a tool call maps onto the backend.** For each invocation, the list of `functions/v1/*`, PostgREST, and GoTrue admin calls, whether that list is one call or a fan-out, and how much of the tool’s wall time is downstream HTTP versus local work inside the MCP process.
3. **Where the sequence is wasteful, and which side should change.** Repeated catalog reads, tools that refetch a whole encounter to return one tab, exports that fall back to the multi-megabyte file, and tool descriptions that still lead a model to call `choose` thirty times. Each finding should name the tool or the function to change.

A prior session already shows why the current logs cannot answer these. [docs/perf/aragorn-mcp-session-2026-11-02.md](./perf/aragorn-mcp-session-2026-11-02.md) reconstructed a level-5 build from the Kong access log: 57 inferred tool calls, 196 Supabase calls, all HTTP 200, 87% of the six minutes spent between tools. Tool names were guessed by clustering completions that were more than 1.5 s apart. The `wgui-mcp` PM2 log had durations and no timestamps, tool names, or session ids. Kong recorded completion time and status, not request duration.

`choose_many` has since landed specifically to collapse that 33-call `choose` loop (`tactics-mcp/src/server.ts` instructions, `tactics-mcp/docs/tool-endpoint-map.md`). We still cannot see whether clients use it.

## What exists today

```
MCP client (Cursor, ChatGPT, Grokbot, Codex, local stdio)
        │  Streamable HTTP  /mcp     or    stdio
        ▼
tactics-mcp   src/http.ts on 127.0.0.1:3104, PM2 name wgui-mcp
        │  POST /functions/v1/<name>     character-client.ts invokeFunction
        │  POST /functions/v1/<name>     supabase-reader.ts contentRows, exportCharacter
        │  GET/POST /rest/v1/...         shops.ts and supabase-reader.ts
        │  GET  /auth/v1/admin/users/:id supabase-reader.ts adminUser
        ▼
Kong → GoTrue, PostgREST, edge functions (stock find-*/create-* plus supabase/wgui-ext and supabase/wgui-export)
```

Production is `https://wgui.wandersguide.site/mcp`. The process refuses to bind anything except loopback; Apache proxies the public path. Details are in [tactics-mcp/docs/mcp-client-guide.md](../tactics-mcp/docs/mcp-client-guide.md).

| Piece | Where | What a trace can hook |
| --- | --- | --- |
| HTTP entry, session, inflight cap | `tactics-mcp/src/http.ts` | Already allocates `requestId` and logs `METHOD path -> status ms` on stderr. The id is returned only on the 408 timeout. `/health` is not logged. Body cap is 64 KiB on `/mcp` and 2 MiB on the shop API. More than 64 in-flight `/mcp` calls return `RATE_LIMITED`. Handler timeout is 30 s. |
| Tool registry and scopes | `tactics-mcp/src/server.ts` | `createTacticsMcpServer` wraps every `registerTool`. The wrapper checks `read` / `write` before the handler. `READ_TOOLS` and `WRITE_TOOLS` are the live tool list. The markdown directories drift; do not count tools from them. `TACTICS_MCP_VERSION` is `1.5.0`. |
| Stdio | `tactics-mcp/src/localStdio.ts`, `tactics-mcp/src/grokbotBridge.ts` | Local stdio constructs the same server. The Grokbot bridge is a second process in front of HTTP `/mcp`, so a span on both sides would double-count. |
| User-scoped function calls | `tactics-mcp/src/character-client.ts` `invokeFunction` | One POST to `${SUPABASE_URL}/functions/v1/${name}` with a 10-minute HS256 JWT (`wgui_mcp: true`) or `WG_ACCESS_TOKEN`. Builders, campaigns, spells, inventory, companions, homebrew, and shop catalog reads go through here. |
| Encounter fan-out that bypasses `invokeFunction` | `tactics-mcp/src/supabase-reader.ts` | `contentRows` POSTs with the service role (id batches, max 300). `hydrateSources` calls it once per identity slot (`find-class`, `find-ancestry`, `find-background`, `find-class-archetype`, including the `_2` slots). `loadEncounter` then loops `find-ability-block` and finishes with `find-spell`. `exportCharacter` calls `wgui-export-character-slim` and, on 404 or 5xx, calls `wgui-export-character`. |
| PostgREST | `shops.ts` `rest` (user JWT, `syndicated_nodes`); `supabase-reader.ts` `rest` / `restWrite` (service role) | Shop inventory and several account/encounter reads never touch an edge function. |
| Auth admin | `supabase-reader.ts` `adminUser` | `GET /auth/v1/admin/users/:id` for profile display names. The response contains email. |
| Tokens | `tactics-mcp/src/tokens.ts` | SHA-256 hashes in `data/tokens.json` (override `TACTICS_MCP_TOKEN_FILE`). Scopes are `read` and `write`. OAuth mints with label `"OAuth"` and does not store `client_id`. |
| Tool-to-function map | `tactics-mcp/docs/tool-endpoint-map.md` | The intended mapping. Several encounter sheet tools share one `loadEncounter`, so the map’s “same two calls” is a fan-out once `hydrateSources` runs. |
| Edge functions this repo owns | `supabase/wgui-ext/*`, `supabase/wgui-export/*` | Narrow campaign and encounter commands, notes, and character export. Stock `find-*` / `update-character` / `create-encounter` live in the wanderers-guide repo. |
| Production API logs | [docs/production-logging-analytics.md](./production-logging-analytics.md) | Kong `file-log` and nginx access logs are an amba-only override. They are not in the compose file that `stack:up` loads. Logflare stays off. |

Error codes the tools already return, and that a metric should keep as labels: `AUTH_REQUIRED`, `VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`, `RATE_LIMITED`, `CONFLICT`, `ENCOUNTER_REVISION_CONFLICT`, `FUNCTION_ERROR`, `CHARACTER_FORBIDDEN`, `CAMPAIGN_FORBIDDEN`, `NOT_IN_BOOKS`. `retryable` is already on the tool result. Shop catalog reads retry once inside `invokeBook` when the message matches `fetch failed`. Export retries once by calling the full function after slim fails.

Local caches that change the fan-out, and that a trace should record as a hit or a miss: shop catalog TTL of 5 minutes (`shops.ts` `CATALOG_TTL_MS`), Foundry lookup file cache (`foundry-shop-lookup.ts`). There is no session cache for `find-class-archetype` or for `loadEncounter`.

## Instrumentation

One trace per MCP tool call. Child spans for each outbound HTTP call and for the local sheet work that sits between them. The MCP process is the source of truth for timing. Kong’s access log has no duration, and the stock edge functions are not in this repo, so a dashboard that waits for upstream spans will not answer the mapping question.

### Shared context

Use `AsyncLocalStorage` in the MCP process. `invokeFunction`, `contentRows`, `exportCharacter`’s `call`, both `rest` helpers, and `adminUser` read the store and attach headers. Callers do not thread an id through every tool.

| Field | Set from |
| --- | --- |
| `trace_id` | New id at the start of a `tools/call`. Accept an incoming W3C `traceparent` on `/mcp` when a client sends one. |
| `mcp_session_id` | `mcp-session-id` header already read in `handleMcp`. |
| `http_request_id` | The `requestId` `http.ts` already creates. |
| `tool` | The name argument of the `registerTool` wrapper in `server.ts`. |
| `scope` | `scopeForTool`. |
| `token_id` | `McpTokenRow.id` from `resolveBearer`. Never the bearer, the hash, or the file contents. |
| `user_id` | Supabase user id already on the token row. It is an opaque id. |
| `toolset_sha` | SHA-256 of the sorted registered names plus each tool’s description and JSON schema. `TACTICS_MCP_VERSION` is recorded beside it and is too coarse on its own. |
| `git_sha` | Build-time env, if the PM2 start script has it. |

Stdio (`localStdio.ts`) enters the same wrapper, with `mcp_session_id` empty and `transport: "stdio"`. The Grokbot bridge logs only its own proxy hop (`transport: "bridge"`) and does not start a second tool span.

### Spans

| Span | Starts | Records |
| --- | --- | --- |
| `mcp.http` | Each `/mcp` request in `http.ts` | Method, status, duration, bytes in, bytes out, inflight count. Replaces the current free-text stderr line for `/mcp`. Leave `/health` quiet. |
| `mcp.tool` | The wrapper in `server.ts`, including the scope rejection | Tool, scope, duration, `isError`, error `code`, `retryable`, argument key names, response bytes. |
| `mcp.downstream` | Each outbound fetch at the six sites above | `target` (`functions`, `rest`, `auth_admin`), function or table name, HTTP status, duration, attempt number, request bytes, response bytes, `auth_mode` (`user_jwt`, `service_role`, `wg_access_token`). |
| `mcp.local` | `loadEncounter` after the fetches return, around `readLiveStatBlock` and the ability scan | Duration only. Keeps sheet math from being blamed on Kong. |

A tool span lists its child downstream spans in order. That list is the mapping: 1 call, N sequential calls, or a retry. `hydrateSources` should appear as several `find-class` / `find-ancestry` / `find-class-archetype` children, not as one opaque “load encounter”.

Downstream calls send two headers and nothing else:

- `traceparent` with the tool’s trace id
- `x-wgui-trace` set to the same trace id, for log grep when the peer does not parse W3C headers

`wgui-ext` and `wgui-export` handlers may log that header with their existing status line. Stock `find-*` will ignore the header until wanderers-guide changes, which is acceptable: the child span already has the function name, status, and duration measured from the MCP process.

### Arguments, bodies, and secrets

Log the shape, never the secret and never the document.

| Allowed | Left out |
| --- | --- |
| Tool name, error code, `retryable`, HTTP status | `Authorization`, `apikey`, raw or hashed bearer, JWT, `JWT_SECRET`, service-role key, GoTrue codes |
| Numeric ids (`characterId`, `campaignId`, `encounterId`, option id) | `join_key`, passwords, email, note and dice-log text, character `details`, spell text, shop descriptions |
| Argument keys that were present, and the byte length of string arguments | Request or response JSON. `list_open_choices`, `export_character`, and catalog reads are large; size is the metric |
| `export` format and `detail` (`slim` or `full`), and which function was actually called | PDF bytes and the base64 the tool returns |
| A short hash of the argument object after the fields above are removed, so duplicate calls can be compared | Owner email from `get_campaign_owner_contacts` or `adminUser` |
| Cache hit or miss for the shop catalog | OAuth authorize and token bodies. Those paths stay on the current log line and are not tool traces |

The first implementation should include a unit test with a stand-in sink: a call whose arguments contain a join key and whose `Authorization` header is set must not write either value. `invokeFunction`’s error path currently returns `record.message` from the function body to the model; that text can stay in the tool result and stay out of the log, replaced by the function name and status.

### Sessions, chains, and retries

Phase 1 does not ask clients to send a task id. A chain is the ordered `mcp.tool` spans that share `mcp_session_id`. Gap time between spans is the model and client, which the Aragorn note could only estimate.

Classify retries in the log review, not with a new protocol:

- **Inside the process.** `attempt > 1` on a downstream span (`invokeBook`, the slim-to-full export fallback).
- **Model retry.** Same session, same tool, same argument hash, previous result `retryable: true` or `ENCOUNTER_REVISION_CONFLICT` / `CONFLICT` / `INTERNAL_ERROR`.
- **Redundant read.** Same session, same tool, same argument hash, previous result success, gap under a few seconds. The Aragorn session had two identical `list_open_choices` results and two identical item searches.

`choose` versus `choose_many` is a first-class counter. So is `list_open_choices` calls per `choose_many`.

### Where the numbers land in phase 1

One JSON object per line on stderr, the stream PM2 already keeps for `wgui-mcp`. No new container, no table, and no change to the compose file `stack:up` loads. That matches the constraint in [docs/production-logging-analytics.md](./production-logging-analytics.md): extra logging services stay off the shared stack and off dev. Stdout JSON from the MCP process is fine in dev; it is not a Kong plugin.

Suggested line:

```json
{
  "ts": "2026-11-02T23:57:36.100Z",
  "span": "mcp.tool",
  "trace_id": "…",
  "mcp_session_id": "…",
  "tool": "choose_many",
  "scope": "write",
  "toolset_sha": "…",
  "version": "1.5.0",
  "token_id": "…",
  "user_id": "…",
  "duration_ms": 1400,
  "status": "ok",
  "code": null,
  "retryable": false,
  "arg_keys": ["characterId", "picks"],
  "arg_hash": "…",
  "response_bytes": 4200,
  "downstream": [
    {"target": "functions", "name": "find-character", "status": 200, "duration_ms": 180, "attempt": 1, "req_bytes": 40, "res_bytes": 80000, "auth_mode": "user_jwt"},
    {"target": "functions", "name": "update-character", "status": 200, "duration_ms": 900, "attempt": 1, "req_bytes": 12000, "res_bytes": 80000, "auth_mode": "user_jwt"}
  ],
  "local_ms": 40
}
```

A small script under `docs/perf/` (same idea as `aragorn_session_chart.py`) can answer the three questions from a log file: tool counts, downstream calls per tool, duplicate argument hashes, error codes, and the duration split. That script is part of phase 1, so the Aragorn reconstruction does not have to be repeated by hand.

## Stack options

Keep phase 1 on the JSON log. Add a UI only after a week of lines shows the volume and the questions the script cannot answer comfortably. All of the options below are self-hosted or local. None of them belong in the shared `docker-compose.yml`.

### Tracing and the dashboard

| Option | Fit for this repo | Cost on amba |
| --- | --- | --- |
| JSON logs + the `docs/perf` script | Matches the logging doc. Answers usage, mapping, and fan-out as soon as the spans exist. Weak at ad-hoc slicing across weeks. | None beyond PM2’s existing log file. |
| OpenTelemetry SDK in `tactics-mcp`, OTLP to a collector on localhost | The span model above maps onto OTel spans without a vendor. Export can be added beside the JSON line so phase 1 keeps working if the collector is down. | Collector plus a store. An all-in-one trace UI is a separate choice. |
| Arize Phoenix, self-hosted, OTLP in | One container, traces and eval datasets in the same place. Enough for a single PM2 process. Prefer this if phase 2 wants a UI. | One container on localhost, Apache in front only if someone other than the operator needs it. |
| Langfuse, self-hosted | Strong prompt and dataset UI. The tool schemas live in Zod inside `registerTool`, not in a prompt CMS, so the prompt product is a poor fit. The trace UI is real, and the deploy is several services (web, worker, Postgres, ClickHouse, Redis, a blob bucket). | Heavier than this host’s logging stance. Choose it only for the dataset UI, not for traces alone. |

Recommendation: phase 1 is JSON only. Phase 2 adds the OTel SDK with the JSON line still written, and points OTLP at Phoenix on localhost. Revisit Langfuse only if the eval workflow outgrows Phoenix datasets. Do not add Logflare.

Sampling stays at 100%. The Aragorn session was 57 tool calls in six minutes. Drop sampling only after the log volume says the process or the disk cares.

### Evals

Two different checks, in order:

1. **Deterministic replay, no model.** Extend the existing `node:test` style in `tactics-mcp/test/`. A recorded tool sequence (level-5 build, add a combatant, stock a shop) runs against the stand-in fetch and asserts downstream call count, error code, and that the log sink stayed redacted. This locks a fan-out improvement the day it lands. It does not need Promptfoo or a live model.
2. **Model-in-the-loop, Promptfoo.** A config outside the request path, run by hand or in CI against a local stack, with a fixed model and three golden tasks:
   - Build a level-5 character and `export_character` (the Aragorn task). Budget: on the order of the 5–7 `choose_many` batches the server instructions already state, not 33 `choose` calls. Downstream budget: one `find-character` and one `update-character` per batch, plus the catalog reads `set_identity` needs.
   - Open an encounter and read skills, feats, and spells for one PC. Budget: the `wgui-ext-find-encounter` plus `wgui-ext-find-campaign-characters` pair, and a counted number of `find-ability-block` / `find-spell` / identity `find-*` calls. A drop in that count is the signal that `hydrateSources` got batched.
   - Create a shop from `search_foundry_shop_items` and `set_shop_stock`. Budget: no second catalog walk inside the TTL, and one `syndicated_nodes` write.

   Assert tool-call count, downstream-call count, and zero `VALIDATION_ERROR` on the happy path. Record `toolset_sha` on the eval result so a description edit is comparable to the previous run. Promptfoo grades the model’s behavior. The deterministic replay grades the server. Keep both.

`npm run character:smoke` stays a live connectivity check. It is not the regression suite.

### Tool-schema lifecycle

The descriptions and Zod schemas in `registerTool` are the prompt. They stay in git. `toolset_sha` on every span is the version that correlates a description edit with a change in calls per task.

Do not mirror schemas into Langfuse or another CMS. Two copies will diverge the way `tactics-mcp/docs/mcp-tool-directory.md` has already diverged from `READ_TOOLS` / `WRITE_TOOLS`. When a schema change ships, the eval result names the sha before and after. `TACTICS_MCP_INSTRUCTIONS` is part of the hash input, because the `choose_many` guidance lives there and changes call counts without changing a tool’s parameters.

### Drift

From the phase 1 lines, weekly, per tool and per `toolset_sha`:

- call count, and calls per session
- error-code rate, split by `code`
- mean and p95 `duration_ms`, and the sum of downstream `duration_ms` versus `local_ms`
- downstream calls per tool call (fan-out)
- response-byte p95
- duplicate argument-hash rate
- retry rate, in-process and model-level
- `choose` / `choose_many` ratio and `list_open_choices` per `choose_many`

A regression worth opening a task for: fan-out or p95 latency up by a large step on the same sha, or the `choose_many` ratio falling after an instruction edit. Exact thresholds are an open decision; start by paging the weekly script into the existing perf notes rather than inventing an alert.

### Governance

The scope wrapper in `server.ts` stays the authorization check. Observability does not grant a second path.

| Need | How |
| --- | --- |
| Audit of writes | `mcp.tool` lines with `scope: "write"` are the audit trail: who (`token_id`, `user_id`), which tool, which numeric ids, which error code, when. Join keys and note bodies are not in the line. |
| Read vs write visibility | `scope` is already on the span. A reviewer can list write calls without holding `write`. |
| Token inventory | `tokens.ts` already stores hash, label, scopes, `lastUsedAt`, expiry, revocation. Adding `client_id` at mint time (see open decisions) is what makes “which agent” true. The token file stays out of the log. |
| Operator access | PM2 logs on amba are readable by the people who already SSH there. Phase 2’s Phoenix container binds to localhost the same way. Do not put traces on the public origin. |
| Dev | The JSON line is process stderr. No compose service, no Kong plugin, no analytics script in the Vite app. |

`get_campaign_owner_contacts` and `adminUser` return email. Those spans record the tool name, the user id, duration, and status. They do not record the address.

## Rollout

### Phase 1 — correlation and structured logs

Ship inside `tactics-mcp` only.

1. Add the async context, the `registerTool` timing wrapper, and downstream timing at `invokeFunction`, `contentRows`, `exportCharacter`, both REST helpers, and `adminUser`.
2. Emit the JSON line. Keep a one-line human log if PM2’s current tail is still useful, without the request body.
3. Propagate `traceparent` and `x-wgui-trace`. No wanderers-guide change required for the MCP-side numbers.
4. Add the redaction test and a replay test that a `loadEncounter`-style fan-out produces one parent and the expected children.
5. Add `docs/perf` reader script and run it once on a dev session that builds a character and opens an encounter. Check the three questions against that file before any dashboard.

Exit: a session can be counted without guessing tool names from Kong, and a join key cannot appear in the log.

### Phase 2 — trace UI

1. Add the OTel SDK, still writing the JSON line.
2. Run Phoenix on localhost on amba only, same rule as the logging override: not in the compose file `stack:up` always loads.
3. Optionally log `x-wgui-trace` inside `supabase/wgui-ext` and `supabase/wgui-export`. Leave stock functions alone.
4. Confirm one tool span in the UI shows the same children as the JSON line.

Exit: an operator can open one `trace_id` and see the fan-out without the script. Phase 1 remains the fallback when Phoenix is down.

### Phase 3 — evals and the API loop

1. Turn the phase 1 replay into a checked-in budget for the three golden tasks (downstream call counts).
2. Add Promptfoo for the same three tasks against a local stack and a fixed model. Fail the run when tool-call count or `VALIDATION_ERROR` exceeds the budget.
3. Use the traces to pick one change, then remeasure. Candidates already visible in the code, to be confirmed by phase 1 numbers before anyone edits them:
   - `hydrateSources` issues one `contentRows` per identity slot per creature. `contentRows` already accepts an id list. Grouping by function name is the obvious batch.
   - Sheet tools each call `loadEncounter`, which refetches the encounter and the catalog. A short session cache, like the shop catalog TTL, is the same idea as the Aragorn note’s `find-class-archetype` cache.
   - `list_encounters` downloads the campaign’s encounters and slices them, because `wgui-ext-find-encounter` has no cursor (`tool-endpoint-map.md`).
   - Slim export falls back to the full function (about 0.12 MB versus about 4 MB). The trace should show how often that fallback runs before anyone changes it.
   - `choose` is still registered for one-off fixes. If phase 1 shows long `choose` runs, the fix is the instruction and the schema text, which the Promptfoo task measures.

Exit: one shipped change (tool schema or a batched read) with a before/after on call count and error rate, tied to two `toolset_sha` values.

## Open decisions

1. **Phoenix versus staying on the script.** Phase 2 is optional until the weekly script is painful. Decide after phase 1 has real lines.
2. **Store `client_id` on the token row at OAuth mint.** `issueCode` in `tactics-mcp/src/oauth.ts` keeps `clientId` on the one-minute auth-code row. `consumeCode` returns only `userId` and `scopes`, and `http.ts` then mints the token with label `"OAuth"`. Persisting the id means returning it from `consumeCode` and adding a field on `McpTokenRow`. The id is not a secret; the bearer is. Without it, Cursor, ChatGPT, and Grokbot cannot be separated. `allowedMcpRedirect` already treats the Grokbot and ChatGPT client ids differently.
3. **Whether a client may send a task id** (`x-wgui-task` or an MCP meta field) so a multi-session build counts as one task. Phase 1 uses `mcp_session_id` only.
4. **Retention.** How long PM2 keeps `wgui-mcp` logs, and whether write-span lines are copied anywhere else. Character and campaign ids will be in the file.
5. **Alert thresholds** for fan-out and for the `choose` / `choose_many` ratio. Start without paging.
6. **Echo `x-wgui-trace` in `wgui-ext` responses** or only in their logs. Clients do not need it for phase 1.
7. **Kong.** Leave the access log as the cross-check it already is. Teaching the file-log plugin to store `x-wgui-trace` is a wanderers-guide / amba change and is not required to split latency, because the MCP process times the fetch itself.

## Out of scope

- Editing tool handlers, edge functions, or schemas in the same change as the log line. Measure first.
- A prompt CMS, a hosted LLMOps vendor, or Logflare.
- Logging on the Vite app, Umami/Plausible, or the page-analytics work in the production logging doc.
- Tracing GoTrue authorize and token requests. Those paths handle credentials and are not tool calls.
- Any service-worker change on `amba.wandersguide.site`.
