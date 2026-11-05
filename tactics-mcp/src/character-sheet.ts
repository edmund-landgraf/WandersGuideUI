import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asRow, invokeFunction } from "./character-client.js";
import { fail, loadRow, ownerGuard, saveRow, textResult } from "./character-catalog.js";
import { decodeImageData, fetchImageUrl, uploadImageBytes, type ImageCategory } from "./image-upload.js";
import { isSiteRelativeArtPath, publicArtSrc } from "./public-art-url.js";

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

function imageUrl(value: string | null): { ok: true; url: string | undefined; siteRelative: boolean } | { ok: false } {
  if (value == null) return { ok: true, url: undefined, siteRelative: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, url: undefined, siteRelative: false };
  const siteRelative = isSiteRelativeArtPath(trimmed);
  const candidate = siteRelative ? publicArtSrc(trimmed) : trimmed;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false };
  } catch {
    return { ok: false };
  }
  return { ok: true, url: candidate, siteRelative };
}

async function materializeArtUrl(
  userId: string,
  parsed: { ok: true; url: string | undefined; siteRelative: boolean } | { ok: false } | null,
  category: ImageCategory,
) {
  if (!parsed || !parsed.ok || !parsed.siteRelative || !parsed.url) return parsed;
  const uploaded = await uploadInput(userId, undefined, parsed.url, category);
  if (uploaded.ok) return { ok: true as const, url: uploaded.url, siteRelative: true };
  return { ok: true as const, url: parsed.url, siteRelative: true };
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
  const id = typeof page.id === "string" || typeof page.id === "number" ? page.id : null;
  return {
    index,
    id,
    name: typeof page.name === "string" ? page.name : "",
    icon: typeof page.icon === "string" ? page.icon : NOTE_ICON,
    color: typeof page.color === "string" ? page.color : NOTE_COLOR,
    shared: page.shared === true,
    text: plainNote(page.contents).trim(),
    contents: page.contents ?? null,
  };
}

function noteNotFound() {
  return textResult("Note page not found.", { code: "NOTE_NOT_FOUND", retryable: false }, true);
}

function locatePage(pages: NotePage[], pageId: string | undefined, pageIndex: number | undefined): { index: number } | { error: "missing" | "empty" | "missing-page" | "mismatch" } {
  if (pageId === undefined && pageIndex === undefined) return { error: "missing" as const };
  if (pageId !== undefined) {
    const id = pageId.trim();
    if (!id) return { error: "empty" as const };
    const index = pages.findIndex((page) => (typeof page.id === "string" || typeof page.id === "number") && String(page.id) === id);
    if (index < 0) return { error: "missing-page" as const };
    if (pageIndex !== undefined && pageIndex !== index) return { error: "mismatch" as const };
    return { index };
  }
  if (pageIndex! >= pages.length) return { error: "missing-page" as const };
  return { index: pageIndex! };
}

function pageTargetError(found: { error: "missing" | "empty" | "missing-page" | "mismatch" }) {
  if (found.error === "missing") return textResult("Pass pageId or pageIndex.", { code: "VALIDATION_ERROR", retryable: false }, true);
  if (found.error === "empty") return textResult("pageId is empty.", { code: "VALIDATION_ERROR", retryable: false }, true);
  if (found.error === "mismatch") return textResult("pageId and pageIndex are different pages.", { code: "VALIDATION_ERROR", retryable: false }, true);
  return noteNotFound();
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

async function bytesFromInput(data: string | undefined, sourceUrl: string | undefined) {
  if (data !== undefined && sourceUrl !== undefined) return { ok: false as const, message: "Pass image data or a source URL, not both." };
  if (data !== undefined) return decodeImageData(data);
  if (sourceUrl !== undefined) return fetchImageUrl(sourceUrl);
  return { ok: false as const, message: "Pass image data or a source URL." };
}

async function uploadInput(userId: string, data: string | undefined, sourceUrl: string | undefined, category: ImageCategory) {
  const bytes = await bytesFromInput(data, sourceUrl);
  if (!bytes.ok) return { ok: false as const, code: "VALIDATION_ERROR", message: bytes.message };
  return uploadImageBytes(userId, bytes.bytes, category);
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
    "upload_image",
    {
      title: "Upload a public image",
      description: "Uploads a PNG, JPEG, or WebP through upload-public-file, the same call as src/process/upload/image-upload.ts. data is base64 with no data: prefix (a data: URL prefix is stripped). sourceUrl is fetched first. category is portraits or backgrounds, the only buckets that function accepts. The file is stored at <user id>/<id>.<type> in that bucket and the public URL is returned. Images must be 2 MB or smaller. SVG and other types are rejected from the file bytes. The function also requires Patreon tier 1 and returns \"User does not have access\" otherwise.",
      annotations: writes,
      inputSchema: {
        data: z.string().optional(),
        sourceUrl: z.string().optional(),
        category: z.enum(["portraits", "backgrounds"]),
      },
    },
    async (args) => {
      const uploaded = await uploadInput(userId(), args.data, args.sourceUrl, args.category);
      if (!uploaded.ok) return fail(uploaded);
      return textResult("Image uploaded", { url: uploaded.url, category: uploaded.category, type: uploaded.type });
    },
  );

  server.registerTool(
    "set_character_art",
    {
      title: "Character portrait and background",
      description: "Sets the portrait and sheet background the character art pickers store. portraitUrl writes details.image_url. backgroundUrl writes details.background_image_url. Pass an http(s) URL, a site-relative path such as /portraits/file.jpg, or null or \"\" to clear that field the way the sheet drops it. A site-relative path is fetched from PUBLIC_ASSET_ORIGIN (default https://wgui.wandersguide.site) and re-uploaded with upload-public-file; if that fails the absolute public URL is stored. portraitData or backgroundData is base64 (no data: prefix) and is uploaded with upload-public-file, portraits or backgrounds, then the returned URL is stored. source URLs belong on upload_image. Other details keys are kept. Only the character owner can write. Saves with expected_updated_at.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        portraitUrl: z.string().nullable().optional(),
        backgroundUrl: z.string().nullable().optional(),
        portraitData: z.string().optional(),
        backgroundData: z.string().optional(),
      },
    },
    async (args) => {
      if (args.portraitUrl === undefined && args.backgroundUrl === undefined && args.portraitData === undefined && args.backgroundData === undefined) {
        return textResult("Pass portraitUrl, backgroundUrl, portraitData, and/or backgroundData.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      if (args.portraitUrl !== undefined && args.portraitData !== undefined) {
        return textResult("Pass portraitUrl or portraitData, not both.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      if (args.backgroundUrl !== undefined && args.backgroundData !== undefined) {
        return textResult("Pass backgroundUrl or backgroundData, not both.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const portrait = args.portraitUrl === undefined ? null : imageUrl(args.portraitUrl);
      const background = args.backgroundUrl === undefined ? null : imageUrl(args.backgroundUrl);
      if ((args.portraitUrl !== undefined && portrait && !portrait.ok) || (args.backgroundUrl !== undefined && background && !background.ok)) {
        return textResult("Art URLs must be http(s) links or site-relative image paths.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const hostedPortrait = await materializeArtUrl(userId(), portrait, "portraits");
      const hostedBackground = await materializeArtUrl(userId(), background, "backgrounds");
      let portraitUrl = hostedPortrait?.ok ? hostedPortrait.url : undefined;
      let backgroundUrl = hostedBackground?.ok ? hostedBackground.url : undefined;
      if (args.portraitData !== undefined) {
        const uploaded = await uploadInput(userId(), args.portraitData, undefined, "portraits");
        if (!uploaded.ok) return fail(uploaded);
        portraitUrl = uploaded.url;
      }
      if (args.backgroundData !== undefined) {
        const uploaded = await uploadInput(userId(), args.backgroundData, undefined, "backgrounds");
        if (!uploaded.ok) return fail(uploaded);
        backgroundUrl = uploaded.url;
      }
      const details = detailsOf(loaded.data);
      if (args.portraitUrl !== undefined || args.portraitData !== undefined) assignUrl(details, "image_url", portraitUrl);
      if (args.backgroundUrl !== undefined || args.backgroundData !== undefined) assignUrl(details, "background_image_url", backgroundUrl);
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
      description: "Reads character.notes.pages for a character find-character returns to the caller. Each page is index, id (null unless the stored page already has one; the sheet does not assign ids), name, icon, color, shared, contents, and text. contents is the stored value (a markdown string on the Phase 1 sheet, or TipTap JSON from the older sheet). text is the plain reading of that page. This is the owner read. The encounter tool get_character returns a flattened notes string for the GM.",
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
    "add_character_note",
    {
      title: "Add a character note page",
      description: "Inserts one page into character.notes.pages, the same shape the Phase 1 sheet creates: { name, icon: \"notebook\", color: \"#359fdf\", contents }. title is stored as name. contents is stored as the string the editor writes. position is the 0-based index to insert at; omit it to append. Other pages and any other notes fields are left as stored. The sheet does not give a page an id. A title of GM Notes is refused, matching the sheet. Only the owner can write. Saves with update-character and expected_updated_at.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        title: z.string(),
        contents: z.string(),
        position: z.number().int().min(0).optional(),
      },
    },
    async (args) => {
      const title = args.title.trim();
      if (!title) return textResult("title is empty.", { code: "VALIDATION_ERROR", retryable: false }, true);
      if (isGmNotes(title)) return textResult("The sheet does not create a page named GM Notes.", { code: "VALIDATION_ERROR", retryable: false }, true);
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const notes = notesBag(loaded.data);
      const index = args.position ?? notes.pages.length;
      if (index > notes.pages.length) return textResult("position is past the end of notes.pages.", { code: "VALIDATION_ERROR", retryable: false }, true);
      notes.pages.splice(index, 0, blankPage(title, args.contents));
      const saved = await saveRow(userId(), loaded.data, { notes });
      if (!saved.ok) return fail(saved);
      return textResult("Note page added", {
        characterId: args.characterId,
        pageIndex: index,
        pages: notesBag(saved.data).pages.map(pageView),
        updated_at: saved.data.updated_at ?? null,
      });
    },
  );

  server.registerTool(
    "edit_character_note",
    {
      title: "Edit a character note page",
      description: "Replaces the contents of one page in character.notes.pages. Pass pageIndex (0-based index in the stored array) or pageId (matches a stored page.id, which the sheet does not create). Only contents changes. name, icon, color, shared, and any other fields on that page and on every other page stay as stored. Only the owner can write. Saves with update-character and expected_updated_at. A missing page is NOTE_NOT_FOUND.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        contents: z.string(),
        pageIndex: z.number().int().min(0).optional(),
        pageId: z.string().optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const notes = notesBag(loaded.data);
      const found = locatePage(notes.pages, args.pageId, args.pageIndex);
      if ("error" in found) return pageTargetError(found);
      notes.pages[found.index].contents = args.contents;
      const saved = await saveRow(userId(), loaded.data, { notes });
      if (!saved.ok) return fail(saved);
      return textResult("Note page edited", {
        characterId: args.characterId,
        pageIndex: found.index,
        pages: notesBag(saved.data).pages.map(pageView),
        updated_at: saved.data.updated_at ?? null,
      });
    },
  );

  server.registerTool(
    "rename_character_note",
    {
      title: "Rename a character note page",
      description: "Changes the name of one page in character.notes.pages. Pass pageIndex or pageId. title is stored as name, the field the sheet renames. contents and every other field on that page, and every other page, stay as stored. A title of GM Notes is refused, matching the sheet. Only the owner can write. Saves with update-character and expected_updated_at. A missing page is NOTE_NOT_FOUND.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        title: z.string(),
        pageIndex: z.number().int().min(0).optional(),
        pageId: z.string().optional(),
      },
    },
    async (args) => {
      const title = args.title.trim();
      if (!title) return textResult("title is empty.", { code: "VALIDATION_ERROR", retryable: false }, true);
      if (isGmNotes(title)) return textResult("The sheet does not rename a page to GM Notes.", { code: "VALIDATION_ERROR", retryable: false }, true);
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const notes = notesBag(loaded.data);
      const found = locatePage(notes.pages, args.pageId, args.pageIndex);
      if ("error" in found) return pageTargetError(found);
      notes.pages[found.index].name = title;
      const saved = await saveRow(userId(), loaded.data, { notes });
      if (!saved.ok) return fail(saved);
      return textResult("Note page renamed", {
        characterId: args.characterId,
        pageIndex: found.index,
        pages: notesBag(saved.data).pages.map(pageView),
        updated_at: saved.data.updated_at ?? null,
      });
    },
  );

  server.registerTool(
    "delete_character_note",
    {
      title: "Delete a character note page",
      description: "Removes one page from character.notes.pages. Pass pageIndex or pageId. Every other page, and any other fields on the notes object, stay as stored. Only the owner can write. Saves with update-character and expected_updated_at. A missing page is NOTE_NOT_FOUND.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        pageIndex: z.number().int().min(0).optional(),
        pageId: z.string().optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const notes = notesBag(loaded.data);
      const found = locatePage(notes.pages, args.pageId, args.pageIndex);
      if ("error" in found) return pageTargetError(found);
      notes.pages.splice(found.index, 1);
      const saved = await saveRow(userId(), loaded.data, { notes });
      if (!saved.ok) return fail(saved);
      return textResult("Note page deleted", {
        characterId: args.characterId,
        pageIndex: found.index,
        pages: notesBag(saved.data).pages.map(pageView),
        updated_at: saved.data.updated_at ?? null,
      });
    },
  );

  server.registerTool(
    "set_campaign_art",
    {
      title: "Campaign art",
      description: "Sets the campaign image the campaign UI stores. imageUrl writes meta_data.image_url (http(s), a site-relative path such as /portraits/file.jpg, or null or \"\" to clear). A site-relative path is fetched from PUBLIC_ASSET_ORIGIN (default https://wgui.wandersguide.site) and re-uploaded with upload-public-file; if that fails the absolute public URL is stored. imageData is base64 and is uploaded with upload-public-file in the backgrounds bucket, the same category the campaign art picker uses, then that URL is stored. focusY writes meta_data.image_focus_y, clamped to 0–100 the way the sheet's focus slider does. There is no separate background field. Other meta_data keys are kept. Only the campaign owner (the GM, campaign.user_id) can write. Saves with create-campaign and the existing campaign id, the same call the campaign art picker uses.",
      annotations: writes,
      inputSchema: {
        campaignId: z.number().int(),
        imageUrl: z.string().nullable().optional(),
        imageData: z.string().optional(),
        focusY: z.number().optional(),
      },
    },
    async (args) => {
      if (args.imageUrl === undefined && args.imageData === undefined && args.focusY === undefined) {
        return textResult("Pass imageUrl, imageData, and/or focusY.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      if (args.imageUrl !== undefined && args.imageData !== undefined) {
        return textResult("Pass imageUrl or imageData, not both.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const image = args.imageUrl === undefined ? null : imageUrl(args.imageUrl);
      if (args.imageUrl !== undefined && image && !image.ok) {
        return textResult("Campaign art URLs must be http(s) links or site-relative image paths.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const loaded = await loadCampaign(userId(), args.campaignId);
      if (!loaded.ok) return fail(loaded);
      if (!sameUser(loaded.data.user_id, userId())) {
        return textResult("Only the campaign owner can write campaign art.", { code: "CAMPAIGN_FORBIDDEN", retryable: false }, true);
      }
      const hosted = await materializeArtUrl(userId(), image, "backgrounds");
      let imageUrlValue = hosted?.ok ? hosted.url : undefined;
      if (args.imageData !== undefined) {
        const uploaded = await uploadInput(userId(), args.imageData, undefined, "backgrounds");
        if (!uploaded.ok) return fail(uploaded);
        imageUrlValue = uploaded.url;
      }
      const meta = (loaded.data.meta_data && typeof loaded.data.meta_data === "object" && !Array.isArray(loaded.data.meta_data)
        ? structuredClone(loaded.data.meta_data)
        : {}) as Record<string, unknown>;
      if (args.imageUrl !== undefined || args.imageData !== undefined) meta.image_url = imageUrlValue ?? "";
      if (args.focusY !== undefined) meta.image_focus_y = clampFocus(args.focusY);
      // Stock WG has no update-campaign. The campaign UI upserts by posting the row to create-campaign.
      const saved = await invokeFunction(userId(), "create-campaign", { ...loaded.data, id: args.campaignId, meta_data: meta });
      if (!saved.ok) return fail(saved);
      const row = asRow(Array.isArray(saved.data) ? saved.data[0] : saved.data) ?? { ...loaded.data, meta_data: meta };
      return textResult("Campaign art saved", campaignArt(row, userId()));
    },
  );
}
