import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { invokeFunction, type InvokeResult } from "./character-client.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const id = z.union([z.number().int(), z.array(z.number().int())]).optional();
const name = z.string().optional();
const sources = z.array(z.number().int()).optional().describe("Content source ids to search (not content_source_id).");
const ids = z.array(z.number().int()).optional();

/**
 * Filters each find-* edge function actually reads from its body
 * (wanderers-guide/supabase/functions/find-<slug>/index.ts).
 */
const FIND_FILTERS = {
  "content-source": {
    id,
    foundry_id: z.string().optional(),
    group: z.string().optional(),
    homebrew: z.boolean().optional(),
    published: z.boolean().optional(),
  },
  trait: { id, name, content_sources: sources },
  "ability-block": {
    id,
    type: z.string().optional(),
    name,
    content_sources: sources,
    traits: ids,
    prerequisites: z.array(z.string()).optional(),
  },
  ancestry: { id, content_sources: sources },
  background: { id, content_sources: sources },
  class: { id, content_sources: sources },
  archetype: { id, content_sources: sources, dedication_feat_id: z.number().int().optional() },
  "versatile-heritage": { id, content_sources: sources, heritage_id: z.number().int().optional() },
  "class-archetype": { id, content_sources: sources, class_id: z.number().int().optional() },
  item: { id, name, content_sources: sources },
  language: { id, name, content_sources: sources },
  creature: { id, name, content_sources: sources, type: z.enum(["creature", "hazard"]).optional().describe("Defaults to creature.") },
  spell: { id, name, content_sources: sources, traits: ids },
} as const;

type ContentSlug = keyof typeof FIND_FILTERS;
const CONTENT_SLUGS = Object.keys(FIND_FILTERS) as ContentSlug[];

/** Hyphenated content types deleteContent() sends; delete-content maps them to table names. */
export const DELETE_TYPES = [
  "ability-block", "content-source", "ancestry", "trait", "class", "background", "item",
  "spell", "creature", "language", "archetype", "versatile-heritage", "class-archetype",
] as const;
const BLOCKED_DELETE_TYPES = new Set(["character", "campaign", "encounter"]);

function toolName(slug: string) {
  return `wgui_ext_hb_${slug.replace(/-/g, "_")}`;
}

function textResult(text: string, structuredContent: Record<string, unknown>, isError = false) {
  return {
    isError: isError || undefined,
    content: [{ type: "text" as const, text: `${text}\n${JSON.stringify(structuredContent)}` }],
    structuredContent,
  };
}

function respond(fn: string, result: InvokeResult) {
  if (!result.ok) {
    return textResult(result.message, { code: result.code, retryable: false, ...(result.data ? { data: result.data } : {}) }, true);
  }
  const count = Array.isArray(result.data) ? `${result.data.length} row(s)` : result.data == null ? "no data" : "ok";
  return textResult(`${fn}: ${count}`, { data: result.data ?? null });
}

function sourceTitle(row: Record<string, unknown>, titles: Map<number, string>) {
  const nested = row.content_source;
  if (nested && typeof nested === "object" && typeof (nested as { name?: unknown }).name === "string") {
    return (nested as { name: string }).name;
  }
  const id = typeof row.content_source_id === "number" ? row.content_source_id : 0;
  const metadata = row.meta_data as { source?: { book?: unknown } } | undefined;
  return titles.get(id) || (typeof metadata?.source?.book === "string" ? metadata.source.book : "");
}

function bookRank(title: string) {
  const text = title.toLowerCase();
  if (/monster core 2\b/.test(text)) return 4;
  if (/monster core|npc core|player core|remaster/.test(text)) return 3;
  if (/\bbestiary\b/.test(text)) return 0;
  return 1;
}

const normalizedName = (value: unknown) => String(value ?? "").trim().toLowerCase();

/** Rank within each name group without mixing unrelated names or relying on a
 * non-transitive comparator. Explicit id/source queries bypass this ranking. */
export function preferLatestCreatures(rows: Record<string, unknown>[], titles: Map<number, string>, requestedName?: string) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = normalizedName(row.name);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const deprecated = Number(left.deprecated === true) - Number(right.deprecated === true);
      if (deprecated) return deprecated;
      const byBook = bookRank(sourceTitle(right, titles)) - bookRank(sourceTitle(left, titles));
      if (byBook) return byBook;
      return Number(right.id ?? 0) - Number(left.id ?? 0);
    });
  }
  const exact = normalizedName(requestedName);
  const first = groups.get(exact);
  if (first) groups.delete(exact);
  return [...(first ?? []), ...Array.from(groups.values()).flat()];
}

export function creatureLookupWarning(rows: Record<string, unknown>[], titles: Map<number, string>, requestedName: string) {
  const exact = rows.find((row) => normalizedName(row.name) === normalizedName(requestedName) && row.deprecated !== true);
  if (!exact) return "No active exact-name catalog match; do not substitute a partial match automatically.";
  const title = sourceTitle(exact, titles);
  if (bookRank(title) === 0) return `Legacy catalog fallback: ${title}. A newer published version may be missing; confirm before use.`;
  if (!title) return "Catalog source is unknown; newest published version cannot be verified.";
  return undefined;
}

async function sourceTitles(userId: string, rows: Record<string, unknown>[]) {
  const ids = [...new Set(rows.flatMap((row) => typeof row.content_source_id === "number" ? [row.content_source_id] : []))];
  const titles = new Map<number, string>();
  if (!ids.length) return titles;
  const found = await invokeFunction(userId, "find-content-source", { id: ids });
  const sources = found.ok && Array.isArray(found.data) ? found.data as Record<string, unknown>[] : [];
  for (const source of sources) {
    if (typeof source.id === "number" && typeof source.name === "string") titles.set(source.id, source.name);
  }
  return titles;
}

async function call(userId: () => string, fn: string, body: Record<string, unknown>) {
  try {
    const result = await invokeFunction(userId(), fn, body);
    if (result.ok && fn === "find-creature" && body.id == null && body.content_sources == null && typeof body.name === "string" && body.name.trim() && Array.isArray(result.data)) {
      const rows = result.data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
      const titles = await sourceTitles(userId(), rows);
      const ordered = preferLatestCreatures(rows, titles, body.name);
      const warning = creatureLookupWarning(ordered, titles, body.name);
      return textResult(`${fn}: ${ordered.length} row(s)${warning ? ` — ${warning}` : ""}`, { data: ordered, ...(warning ? { warning } : {}) });
    }
    return respond(fn, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Homebrew call failed.";
    return textResult(message, { code: "INTERNAL_ERROR", retryable: true }, true);
  }
}

export function registerHomebrew(server: McpServer, userId: () => string) {
  for (const slug of CONTENT_SLUGS) {
    const findFn = `find-${slug}`;
    server.registerTool(
      toolName(findFn),
      {
        title: `Find ${slug}`,
        description: `Raw ${slug} rows from ${findFn}. Only the filters ${findFn} reads are accepted.${slug === "content-source" ? "" : " Returns official rows too when filters match."}${slug === "creature" ? " Exact name matches are ordered newest source first: a Monster Core or other remaster book comes before a legacy Bestiary, and a deprecated row comes last. Explicit id/source filters are respected. Legacy-only and unresolved exact-name lookups include a warning." : ""}`,
        annotations: readOnly,
        inputSchema: { query: z.object(FIND_FILTERS[slug]).strict().optional() },
      },
      async (args: { query?: Record<string, unknown> }) => call(userId, findFn, args.query ?? {}),
    );

    const createFn = `create-${slug}`;
    server.registerTool(
      toolName(createFn),
      {
        title: `Create or update ${slug}`,
        description: `Upserts a ${slug} row with ${createFn}. A record with id updates that row; omit id (or -1) to insert.${slug === "content-source" ? " Requires a public user with Patreon tier 2; that error is returned as-is." : ""}`,
        annotations: writes,
        inputSchema: { record: z.record(z.string(), z.unknown()) },
      },
      async (args: { record: Record<string, unknown> }) => call(userId, createFn, args.record),
    );
  }

  server.registerTool(
    "wgui_ext_hb_find_content_update",
    {
      title: "Find content updates",
      description: "Content update proposals from find-content-update.",
      annotations: readOnly,
      inputSchema: {
        query: z.object({
          id,
          user_id: z.string().optional(),
          state: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
          created: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
        }).strict().optional(),
      },
    },
    async (args: { query?: Record<string, unknown> }) => call(userId, "find-content-update", args.query ?? {}),
  );

  server.registerTool(
    "wgui_ext_hb_create_content_update",
    {
      title: "Propose a content update",
      description: "Inserts a PENDING proposal with create-content-update. The function sets user_id and status; it does not write the content row.",
      annotations: writes,
      inputSchema: {
        type: z.string(),
        action: z.enum(["UPDATE", "CREATE", "DELETE"]),
        data: z.record(z.string(), z.unknown()),
        content_source_id: z.number().int(),
        ref_id: z.number().int().optional(),
      },
    },
    async (args: { type: string; action: string; data: Record<string, unknown>; content_source_id: number; ref_id?: number }) =>
      call(userId, "create-content-update", {
        type: args.type,
        action: args.action,
        data: args.data,
        content_source_id: args.content_source_id,
        ...(args.ref_id === undefined ? {} : { ref_id: args.ref_id }),
      }),
  );

  server.registerTool(
    "wgui_ext_hb_get_content_source_stats",
    {
      title: "Content source stats",
      description: "The source row and its subscriber count from get-content-source-stats.",
      annotations: readOnly,
      inputSchema: { content_source_id: z.number().int().positive() },
    },
    async (args: { content_source_id: number }) =>
      call(userId, "get-content-source-stats", { content_source_id: args.content_source_id }),
  );

  server.registerTool(
    "wgui_ext_hb_delete_content",
    {
      title: "Delete homebrew content",
      description: `Deletes a content row with delete-content. type is one of: ${DELETE_TYPES.join(", ")}. character, campaign and encounter are rejected.`,
      annotations: writes,
      inputSchema: { id: z.number().int(), type: z.string() },
    },
    async (args: { id: number; type: string }) => {
      if (BLOCKED_DELETE_TYPES.has(args.type) || !(DELETE_TYPES as readonly string[]).includes(args.type)) {
        return textResult(`wgui_ext_hb_delete_content does not accept type ${args.type}.`, { code: "INVALID_TYPE", retryable: false, allowed: [...DELETE_TYPES] }, true);
      }
      return call(userId, "delete-content", { id: args.id, type: args.type });
    },
  );
}
