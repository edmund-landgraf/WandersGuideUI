import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asRow, invokeFunction } from "./character-client.js";
import { fail, loadRow, ownerGuard, saveRow, textResult } from "./character-catalog.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

// Phase 1's default note page (src/pages/phase1/Phase1SheetPage.tsx, GUIDE_BLUE).
const NOTE_ICON = "notebook";
const NOTE_COLOR = "#359fdf";

type NotePage = Record<string, unknown> & {
  name?: unknown;
  icon?: unknown;
  color?: unknown;
  shared?: unknown;
  contents?: unknown;
};

function sameUser(left: unknown, right: string) {
  return typeof left === "string" && left.trim().toLowerCase() === right.trim().toLowerCase();
}

function imageUrl(value: string | null): { ok: true; url: string | undefined } | { ok: false } {
  if (value == null) return { ok: true, url: undefined };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, url: undefined };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false };
  } catch {
    return { ok: false };
  }
  return { ok: true, url: trimmed };
}

function detailsOf(row: Record<string, unknown>) {
  const details = row.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  return structuredClone(details) as Record<string, unknown>;
}

function assignUrl(details: Record<string, unknown>, key: "image_url" | "background_image_url", url: string | undefined) {
  if (url === undefined) delete details[key];
  else details[key] = url;
}

function plainNote(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const row = value as { type?: unknown; text?: unknown; content?: unknown };
  const text = typeof row.text === "string" ? row.text : "";
  const content = Array.isArray(row.content) ? row.content.map(plainNote).join("") : "";
  if (row.type === "paragraph") return `${text || content}\n\n`;
  if (row.type === "heading") return `### ${(text || content).trim()}\n\n`;
  if (row.type === "hardBreak") return "\n";
  return text || content;
}

function isGmNotes(name: unknown) {
  return typeof name === "string" && name.trim().toLowerCase() === "gm notes";
}

function notesBag(row: Record<string, unknown>) {
  const notes = row.notes;
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return { pages: [] as NotePage[] };
  const bag = structuredClone(notes) as Record<string, unknown>;
  const pages = Array.isArray(bag.pages) ? bag.pages.filter((page): page is NotePage => !!page && typeof page === "object") : [];
  bag.pages = pages;
  return bag as Record<string, unknown> & { pages: NotePage[] };
}

function pageView(page: NotePage, index: number) {
  return {
    index,
    name: typeof page.name === "string" ? page.name : "",
    icon: typeof page.icon === "string" ? page.icon : NOTE_ICON,
    color: typeof page.color === "string" ? page.color : NOTE_COLOR,
    shared: page.shared === true,
    text: plainNote(page.contents).trim(),
    contents: page.contents ?? null,
  };
}

function blankPage(name: string, contents: unknown): NotePage {
  return { name, icon: NOTE_ICON, color: NOTE_COLOR, contents };
}

function appendContents(contents: unknown, text: string): unknown {
  if (contents == null || contents === "") return text;
  if (typeof contents === "string") return contents.endsWith("\n") ? `${contents}${text}` : `${contents}\n${text}`;
  if (Array.isArray(contents)) return [...contents, { type: "p", children: [{ text }] }];
  if (typeof contents === "object") {
    const doc = structuredClone(contents) as Record<string, unknown>;
    const paragraph = { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
    if (doc.type === "doc") {
      doc.content = Array.isArray(doc.content) ? [...doc.content, paragraph] : [paragraph];
      return doc;
    }
  }
  const prior = plainNote(contents).trim();
  return prior ? `${prior}\n${text}` : text;
}

function focusStored(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function clampFocus(value: number) {
  return Math.min(100, Math.max(0, value));
}

async function loadCampaign(userId: string, campaignId: number) {
  const found = await invokeFunction(userId, "find-campaign", { id: campaignId });
  if (!found.ok) return found;
  const rows = Array.isArray(found.data) ? found.data : found.data ? [found.data] : [];
  const row = rows.map((item) => asRow(item)).find((item) => item && Number(item.id) === campaignId) ?? null;
  if (!row) return { ok: false as const, code: "NOT_FOUND", message: "Campaign not found." };
  return { ok: true as const, data: row };
}

function campaignArt(row: Record<string, unknown>, userId: string) {
  const meta = (row.meta_data && typeof row.meta_data === "object" && !Array.isArray(row.meta_data) ? row.meta_data : {}) as Record<string, unknown>;
  const image = typeof meta.image_url === "string" && meta.image_url.trim() ? meta.image_url : null;
  return {
    id: Number(row.id),
    name: typeof row.name === "string" ? row.name : null,
    image_url: image,
    image_focus_y: focusStored(meta.image_focus_y),
    isOwner: sameUser(row.user_id, userId),
  };
}

export function registerCharacterSheet(server: McpServer, userId: () => string) {
  server.registerTool(
    "set_character_art",
    {
      title: "Character portrait and background",
      description: "Sets the portrait and sheet background the character art pickers store. portraitUrl writes details.image_url. backgroundUrl writes details.background_image_url. Pass an http(s) URL, or null or \"\" to clear that field the way the sheet drops it. Other details keys are kept. There is no file upload. Only the character owner can write. Saves with expected_updated_at.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        portraitUrl: z.string().nullable().optional(),
        backgroundUrl: z.string().nullable().optional(),
      },
    },
    async (args) => {
      if (args.portraitUrl === undefined && args.backgroundUrl === undefined) {
        return textResult("Pass portraitUrl and/or backgroundUrl.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const portrait = args.portraitUrl === undefined ? null : imageUrl(args.portraitUrl);
      const background = args.backgroundUrl === undefined ? null : imageUrl(args.backgroundUrl);
      if ((args.portraitUrl !== undefined && portrait && !portrait.ok) || (args.backgroundUrl !== undefined && background && !background.ok)) {
        return textResult("Art URLs must be http(s) links.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const details = detailsOf(loaded.data);
      if (args.portraitUrl !== undefined && portrait?.ok) assignUrl(details, "image_url", portrait.url);
      if (args.backgroundUrl !== undefined && background?.ok) assignUrl(details, "background_image_url", background.url);
      const saved = await saveRow(userId(), loaded.data, { details });
      if (!saved.ok) return fail(saved);
      const next = detailsOf(saved.data);
      return textResult("Character art saved", {
        characterId: args.characterId,
        image_url: typeof next.image_url === "string" ? next.image_url : null,
        background_image_url: typeof next.background_image_url === "string" ? next.background_image_url : null,
        updated_at: saved.data.updated_at ?? null,
      });
    },
  );

  server.registerTool(
    "get_character_notes",
    {
      title: "Character notes",
      description: "Reads character.notes.pages for a character find-character returns to the caller. Each page is name, icon, color, shared, contents, and text. contents is the stored value (a markdown string on the Phase 1 sheet, or TipTap JSON from the older sheet). text is the plain reading of that page. This is the owner read. The encounter tool get_character returns a flattened notes string for the GM.",
      annotations: readOnly,
      inputSchema: { characterId: z.number().int() },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const notes = notesBag(loaded.data);
      const pages = notes.pages.map(pageView);
      return textResult(pages.length ? `${pages.length} note pages` : "No notes", { characterId: args.characterId, pages });
    },
  );

  server.registerTool(
    "set_character_notes",
    {
      title: "Write character notes",
      description: "Appends or replaces one page in character.notes.pages, the object the notes panel saves. mode append adds text. A string page stays a string (Phase 1). A TipTap doc (type \"doc\") gains a paragraph. A Plate array gains a paragraph node. mode replace sets that page's contents to the string, which is what the Phase 1 editor writes. pageName selects a page by name, or creates it. pageIndex is the 0-based index in notes.pages, including a GM Notes page. With neither, the first page that is not named GM Notes is used, or a Notes page is created in front of any GM Notes page. Only the owner can write. Saves with expected_updated_at.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        mode: z.enum(["append", "replace"]),
        text: z.string(),
        pageName: z.string().optional(),
        pageIndex: z.number().int().min(0).optional(),
      },
    },
    async (args) => {
      if (args.mode === "append" && !args.text) {
        return textResult("Append text is empty.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const notes = notesBag(loaded.data);
      const pages = notes.pages;
      let index = -1;
      let created = false;
      if (args.pageName !== undefined) {
        const name = args.pageName.trim();
        if (!name) return textResult("pageName is empty.", { code: "VALIDATION_ERROR", retryable: false }, true);
        index = pages.findIndex((page) => typeof page.name === "string" && page.name.trim().toLowerCase() === name.toLowerCase());
        if (index < 0) {
          if (isGmNotes(name)) return textResult("There is no GM Notes page to edit.", { code: "NOT_FOUND", retryable: false }, true);
          pages.push(blankPage(name, args.text));
          index = pages.length - 1;
          created = true;
        }
      } else if (args.pageIndex !== undefined) {
        if (args.pageIndex >= pages.length) return textResult("No note page at that index.", { code: "NOT_FOUND", retryable: false }, true);
        index = args.pageIndex;
      } else {
        index = pages.findIndex((page) => !isGmNotes(page.name));
        if (index < 0) {
          pages.unshift(blankPage("Notes", args.text));
          index = 0;
          created = true;
        }
      }
      if (!created) {
        const page = pages[index];
        page.contents = args.mode === "append" ? appendContents(page.contents, args.text) : args.text;
        if (typeof page.name !== "string" || !page.name.trim()) page.name = "Notes";
        if (typeof page.icon !== "string" || !page.icon) page.icon = NOTE_ICON;
        if (typeof page.color !== "string" || !page.color) page.color = NOTE_COLOR;
      }
      const saved = await saveRow(userId(), loaded.data, { notes });
      if (!saved.ok) return fail(saved);
      const savedPages = notesBag(saved.data).pages;
      return textResult("Notes saved", {
        characterId: args.characterId,
        pageIndex: index,
        pages: savedPages.map(pageView),
        updated_at: saved.data.updated_at ?? null,
      });
    },
  );

  server.registerTool(
    "get_campaign",
    {
      title: "Campaign art",
      description: "Reads the campaign image find-campaign returns to the caller. image_url and image_focus_y are the fields the campaign art picker stores on meta_data. There is no separate campaign background: this image is the campaign art, and the Phase 1 sheet uses it as the sheet background when it is set. A missing image_focus_y is displayed as 30 by the sheet; this tool returns the stored value, or null when it is absent. The join key is not returned.",
      annotations: readOnly,
      inputSchema: { campaignId: z.number().int() },
    },
    async (args) => {
      const loaded = await loadCampaign(userId(), args.campaignId);
      if (!loaded.ok) return fail(loaded);
      const art = campaignArt(loaded.data, userId());
      return textResult(art.name ?? "Campaign", art);
    },
  );

  server.registerTool(
    "set_campaign_art",
    {
      title: "Campaign art",
      description: "Sets the campaign image the campaign UI stores. imageUrl writes meta_data.image_url (http(s), or null or \"\" to clear). focusY writes meta_data.image_focus_y, clamped to 0–100 the way the sheet's focus slider does. There is no separate background field. Other meta_data keys are kept. Only the campaign owner (the GM, campaign.user_id) can write. Saves with create-campaign and the existing campaign id, the same call the campaign art picker uses.",
      annotations: writes,
      inputSchema: {
        campaignId: z.number().int(),
        imageUrl: z.string().nullable().optional(),
        focusY: z.number().optional(),
      },
    },
    async (args) => {
      if (args.imageUrl === undefined && args.focusY === undefined) {
        return textResult("Pass imageUrl and/or focusY.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const image = args.imageUrl === undefined ? null : imageUrl(args.imageUrl);
      if (args.imageUrl !== undefined && image && !image.ok) {
        return textResult("Campaign art URLs must be http(s) links.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const loaded = await loadCampaign(userId(), args.campaignId);
      if (!loaded.ok) return fail(loaded);
      if (!sameUser(loaded.data.user_id, userId())) {
        return textResult("Only the campaign owner can write campaign art.", { code: "CAMPAIGN_FORBIDDEN", retryable: false }, true);
      }
      const meta = (loaded.data.meta_data && typeof loaded.data.meta_data === "object" && !Array.isArray(loaded.data.meta_data)
        ? structuredClone(loaded.data.meta_data)
        : {}) as Record<string, unknown>;
      if (args.imageUrl !== undefined && image?.ok) meta.image_url = image.url ?? "";
      if (args.focusY !== undefined) meta.image_focus_y = clampFocus(args.focusY);
      // Stock WG has no update-campaign. The campaign UI upserts by posting the row to create-campaign.
      const saved = await invokeFunction(userId(), "create-campaign", { ...loaded.data, id: args.campaignId, meta_data: meta });
      if (!saved.ok) return fail(saved);
      const row = asRow(Array.isArray(saved.data) ? saved.data[0] : saved.data) ?? { ...loaded.data, meta_data: meta };
      return textResult("Campaign art saved", campaignArt(row, userId()));
    },
  );
}
