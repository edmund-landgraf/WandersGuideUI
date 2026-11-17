import { randomBytes } from "node:crypto";

import { characterFetch, characterToken, functionsBaseUrl, invokeFunction } from "./character-client.js";
import {
  asShopLine,
  catalogIdOf,
  catalogSourceOf,
  formatShopOffer,
  isShopFormula,
  lineKey,
  PF2E_SHOP_SOURCE,
  shopCeiling,
  shopLineQuantity,
  SETTLEMENT_LEVELS,
  SHOP_PRESETS,
  stockShop,
  STOCK_COUNT,
  traitLabels,
  type CatalogItem,
  type CatalogTrait,
  type SettlementId,
  type ShopPresetId,
  type ShopRarity,
  type ShopStockItem,
} from "./shops-generate.js";

export const SHOP_CONTENT_KIND = "shop";
export type ShopSource = "wanderers-guide" | "pf2e";
export type ShopPageStyle = "default" | "homebrew-v3";
export type SyndicatedKind = "folder" | "entry";

export type ShopStockRow = {
  id: number;
  name: string;
  level: number;
  rarity: string;
  group: string;
  price: string;
  quantity?: number;
  bulk: string;
  traits: string[];
  description: string;
  source?: ShopSource | null;
};

export type ShopDraft = {
  preset: ShopPresetId;
  settlement: SettlementId;
  markup: number;
  style?: ShopPageStyle;
  description?: string;
  stock: ShopStockRow[];
  sources?: ShopSource[];
  books?: number[];
  rarities?: ShopRarity[];
  size?: number;
  campaignId?: number | null;
};

export type ShopNode = {
  id: string;
  user_id: string;
  content_kind: string;
  kind: SyndicatedKind;
  name: string;
  parent_id: string | null;
  draft: ShopDraft | null;
  published: boolean;
  public_token: string | null;
  snapshot: ShopDraft | null;
  published_at: string | null;
};

export type ShopOk<T> = { ok: true; data: T };
export type ShopErr = { ok: false; code: string; message: string };
export type ShopResult<T> = ShopOk<T> | ShopErr;

type Pf2eEquipmentRow = {
  EquipmentId: number;
  Name: string;
  Level: number;
  Rarity: string | null;
  Traits: string | null;
  ItemCategory: string | null;
  ItemSubcategory: string | null;
  SourceBook: string | null;
  Summary: string | null;
  PriceCp: number | null;
  BulkText: string | null;
  WeaponGroup: string | null;
  WeaponCategory: string | null;
  WeaponType: string | null;
  ArmorCategory: string | null;
  ArmorGroupText: string | null;
  Hands: string | null;
  AmmunitionText: string | null;
};

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

function restBase() {
  return functionsBaseUrl();
}

function err(code: string, message: string): ShopErr {
  return { ok: false, code, message };
}

function ok<T>(data: T): ShopOk<T> {
  return { ok: true, data };
}

function mintPublicToken() {
  return randomBytes(16).toString("base64url");
}

function isPreset(value: unknown): value is ShopPresetId {
  return typeof value === "string" && SHOP_PRESETS.some((row) => row.id === value);
}

function isSettlement(value: unknown): value is SettlementId {
  return typeof value === "string" && SETTLEMENT_LEVELS.some((row) => row.id === value);
}

function asSources(value: unknown): ShopSource[] {
  if (!Array.isArray(value) || value.length === 0) return ["wanderers-guide", "pf2e"];
  const next = value.filter((row): row is ShopSource => row === "wanderers-guide" || row === "pf2e");
  return next.length ? [...new Set(next)] : ["wanderers-guide", "pf2e"];
}

function asRarities(value: unknown): ShopRarity[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const next = value.filter((row): row is ShopRarity => row === "COMMON" || row === "UNCOMMON" || row === "RARE" || row === "UNIQUE");
  return next.length ? next : undefined;
}

function asSize(value: unknown, fallback = STOCK_COUNT) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, Math.round(n)));
}

function pf2eApi() {
  return (env("PF2E_SHOP_API") || (env("NODE_ENV") === "production" ? "https://pf2.unwhelm.online" : "http://127.0.0.1:3333")).replace(/\/$/, "");
}

function hashId(value: string, offset: number) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return offset - Math.max(1, Math.abs(hash));
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function priceFromCp(priceCp: number | null) {
  if (priceCp == null) return null;
  let remaining = Math.max(0, Math.round(priceCp));
  const pp = Math.floor(remaining / 1000);
  remaining %= 1000;
  const gp = Math.floor(remaining / 100);
  remaining %= 100;
  const sp = Math.floor(remaining / 10);
  const cp = remaining % 10;
  return { pp, gp, sp, cp };
}

function pf2eGroup(row: Pf2eEquipmentRow) {
  const category = normalize(row.ItemCategory);
  const type = normalize(row.WeaponType);
  if (category.includes("rune")) return "RUNE";
  if (category.includes("armor") || row.ArmorCategory) return "ARMOR";
  if (category.includes("shield")) return "SHIELD";
  if (category.includes("weapon") || row.WeaponCategory || type.includes("weapon")) return "WEAPON";
  if (category.includes("material")) return "MATERIAL";
  return "GENERAL";
}

function parseTraitNames(value: string | null | undefined) {
  return (value ?? "").split(",").map((name) => name.trim()).filter(Boolean);
}

function mapPf2eRow(row: Pf2eEquipmentRow): CatalogItem {
  const names = parseTraitNames(row.Traits);
  return {
    id: row.EquipmentId,
    name: row.Name,
    price: priceFromCp(row.PriceCp),
    bulk: row.BulkText,
    level: row.Level,
    rarity: normalize(row.Rarity).toUpperCase(),
    traits: names.map((name) => hashId(name, -100000)),
    description: row.Summary ?? "",
    group: pf2eGroup(row),
    usage: [row.ItemSubcategory, row.AmmunitionText].filter(Boolean).join(" "),
    meta_data: {
      category: normalize(row.ItemCategory),
      group: normalize(row.WeaponGroup || row.ArmorGroupText),
      pf2e_traits: row.Traits ?? "",
      shop_source: PF2E_SHOP_SOURCE,
      unselectable: false,
    },
    content_source_id: hashId(row.SourceBook ?? "PF2E", 0),
  };
}

function pf2eTraits(items: CatalogItem[]): CatalogTrait[] {
  const names = new Map<number, string>();
  for (const item of items) {
    for (const id of item.traits ?? []) {
      const name = parseTraitNames(item.meta_data?.pf2e_traits).find((trait) => hashId(trait, -100000) === id);
      if (name) names.set(id, name);
    }
  }
  return [...names].map(([id, name]) => ({ id, name }));
}

async function rest(userId: string, method: string, path: string, body?: unknown): Promise<ShopResult<unknown>> {
  const token = characterToken(userId);
  if (!token) return err("AUTH_REQUIRED", "Shop calls need WG_ACCESS_TOKEN or JWT_SECRET on the MCP server.");
  const anon = env("SUPABASE_ANON_KEY") || token;
  const headers: Record<string, string> = {
    apikey: anon,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Prefer: "return=representation",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await characterFetch(`${restBase()}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return err("INTERNAL_ERROR", error instanceof Error ? error.message : "Shop request failed.");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "message" in payload ? String((payload as { message: unknown }).message) : `Shop ${method} failed (${response.status}).`;
    return err(response.status === 404 ? "NOT_FOUND" : "FUNCTION_ERROR", message);
  }
  return ok(payload);
}

function asNodes(payload: unknown): ShopNode[] {
  if (!Array.isArray(payload)) return [];
  return payload as ShopNode[];
}

function asNode(payload: unknown): ShopNode | null {
  const rows = asNodes(payload);
  return rows[0] ?? (payload && typeof payload === "object" && !Array.isArray(payload) ? payload as ShopNode : null);
}

function assertParent(nodes: ShopNode[], next: { kind: SyndicatedKind; parent_id: string | null }) {
  if (next.kind === "folder") {
    if (next.parent_id) throw new Error("Folders stay at the root.");
    return;
  }
  if (!next.parent_id) return;
  const parent = nodes.find((row) => row.id === next.parent_id);
  if (!parent || parent.kind !== "folder" || parent.parent_id) throw new Error("An entry can only sit in a root folder.");
}

async function listNodes(userId: string): Promise<ShopResult<ShopNode[]>> {
  const found = await rest(userId, "GET", `syndicated_nodes?content_kind=eq.${SHOP_CONTENT_KIND}&user_id=eq.${userId}&order=name`);
  if (!found.ok) return found;
  return ok(asNodes(found.data));
}

async function getNode(userId: string, id: string): Promise<ShopResult<ShopNode>> {
  const found = await rest(userId, "GET", `syndicated_nodes?id=eq.${id}&content_kind=eq.${SHOP_CONTENT_KIND}&user_id=eq.${userId}`);
  if (!found.ok) return found;
  const node = asNode(found.data);
  if (!node) return err("NOT_FOUND", "Shop not found.");
  return ok(node);
}

function stripDescriptions(draft: ShopDraft | null) {
  if (!draft) return null;
  return {
    ...draft,
    stock: (draft.stock ?? []).map((row) => ({ ...row, description: "" })),
  };
}

function toStockRow(item: ShopStockItem, traits: CatalogTrait[], markup: number): ShopStockRow {
  return {
    id: catalogIdOf(item),
    name: item.name,
    level: item.level,
    rarity: item.rarity,
    group: isShopFormula(item) ? "FORMULA" : item.group,
    price: formatShopOffer(item, markup),
    quantity: shopLineQuantity(item),
    bulk: item.bulk ? String(item.bulk) : "",
    traits: traitLabels(item, traits),
    description: (item.description ?? "").trim(),
    source: catalogSourceOf(item),
  };
}

async function fetchWgCatalog(userId: string, books?: number[]): Promise<ShopResult<{ items: CatalogItem[]; traits: CatalogTrait[] }>> {
  let sourceIds = books;
  if (!sourceIds) {
    const sources = await invokeFunction(userId, "find-content-source", {});
    if (!sources.ok) return err(sources.code, sources.message);
    const rows = Array.isArray(sources.data) ? sources.data : [];
    sourceIds = rows.map((row) => Number((row as { id?: unknown }).id)).filter((id) => Number.isFinite(id));
  }
  const items = await invokeFunction(userId, "find-item", { content_sources: sourceIds });
  if (!items.ok) return err(items.code, items.message);
  const traits = await invokeFunction(userId, "find-trait", { content_sources: sourceIds });
  if (!traits.ok) return err(traits.code, traits.message);
  const itemRows = (Array.isArray(items.data) ? items.data : []).filter((row): row is CatalogItem => !!row && typeof row === "object" && typeof (row as CatalogItem).id === "number");
  const traitRows = (Array.isArray(traits.data) ? traits.data : []).filter((row): row is CatalogTrait => !!row && typeof row === "object" && typeof (row as CatalogTrait).id === "number");
  return ok({ items: itemRows, traits: traitRows });
}

export async function fetchPf2eCatalog(): Promise<ShopResult<{ items: CatalogItem[]; traits: CatalogTrait[] }>> {
  try {
    const first = await characterFetch(`${pf2eApi()}/api/equipment?limit=500&offset=0`);
    if (!first.ok) return err("FUNCTION_ERROR", `PF2E equipment API returned ${first.status}`);
    const firstPage = (await first.json()) as { rows: Pf2eEquipmentRow[]; total: number; limit: number };
    const pageCount = Math.ceil(firstPage.total / firstPage.limit);
    const pages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => {
        const offset = (index + 1) * firstPage.limit;
        return characterFetch(`${pf2eApi()}/api/equipment?limit=${firstPage.limit}&offset=${offset}`).then(async (response) => {
          if (!response.ok) throw new Error(`PF2E equipment API returned ${response.status}`);
          return (await response.json()) as { rows: Pf2eEquipmentRow[] };
        });
      }),
    );
    const items = [...firstPage.rows, ...pages.flatMap((page) => page.rows)].map(mapPf2eRow);
    return ok({ items, traits: pf2eTraits(items) });
  } catch (error) {
    return err("FUNCTION_ERROR", error instanceof Error ? error.message : "PF2E equipment API failed.");
  }
}

async function loadCatalog(userId: string, sources: ShopSource[], books?: number[]) {
  const items: CatalogItem[] = [];
  const traits: CatalogTrait[] = [];
  if (sources.includes("wanderers-guide")) {
    const wg = await fetchWgCatalog(userId, books);
    if (!wg.ok) return wg;
    items.push(...wg.data.items);
    traits.push(...wg.data.traits);
  }
  if (sources.includes("pf2e")) {
    const pf2e = await fetchPf2eCatalog();
    if (!pf2e.ok) return pf2e;
    items.push(...pf2e.data.items);
    traits.push(...pf2e.data.traits);
  }
  return ok({ items, traits });
}

function findCatalogItem(items: CatalogItem[], source: ShopSource, id: number) {
  return items.find((item) => catalogSourceOf(item) === source && catalogIdOf(item) === id);
}

export function summarizeNode(node: ShopNode) {
  const draft = node.draft;
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    parentId: node.parent_id,
    published: node.published,
    publicToken: node.public_token,
    campaignId: draft?.campaignId ?? null,
    size: draft?.size ?? draft?.stock?.length ?? 0,
    settlement: draft?.settlement ?? null,
    preset: draft?.preset ?? null,
    stockCount: draft?.stock?.length ?? 0,
    draft: node.kind === "entry" ? stripDescriptions(draft) : null,
  };
}

export async function listShops(userId: string) {
  const listed = await listNodes(userId);
  if (!listed.ok) return listed;
  return ok({ shops: listed.data.map(summarizeNode) });
}

export async function getShop(userId: string, id: string) {
  const node = await getNode(userId, id);
  if (!node.ok) return node;
  return ok({ shop: node.data, stockKeys: (node.data.draft?.stock ?? []).map((row) => lineKey(row.source, row.id, row.group === "FORMULA")) });
}

export async function getPublishedShop(userId: string, token: string) {
  const found = await rest(
    userId,
    "GET",
    `syndicated_public?content_kind=eq.${SHOP_CONTENT_KIND}&public_token=eq.${encodeURIComponent(token)}&select=name,snapshot,published_at,content_kind`,
  );
  if (!found.ok) return found;
  const row = asNode(found.data) as unknown as { name?: string; snapshot?: ShopDraft; published_at?: string | null } | null;
  const payload = Array.isArray(found.data) ? (found.data[0] as typeof row) : row;
  if (!payload?.snapshot) return err("NOT_FOUND", "Published shop not found.");
  return ok({ name: payload.name, snapshot: payload.snapshot, publishedAt: payload.published_at ?? null });
}

export async function searchShopCatalog(userId: string, query: string, source: "wanderers-guide" | "pf2e" | "both" = "both") {
  const sources: ShopSource[] = source === "both" ? ["wanderers-guide", "pf2e"] : [source];
  const catalog = await loadCatalog(userId, sources);
  if (!catalog.ok) return catalog;
  const needle = query.trim().toLowerCase();
  const hits = catalog.data.items
    .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    .slice(0, 40)
    .map((item) => ({
      id: catalogIdOf(item),
      name: item.name,
      level: item.level,
      rarity: item.rarity,
      group: item.group,
      source: catalogSourceOf(item),
    }));
  return ok({ items: hits });
}

function emptyDraft(input: Partial<ShopDraft> & { preset?: ShopPresetId; settlement?: SettlementId }): ShopDraft {
  return {
    preset: isPreset(input.preset) ? input.preset : "general",
    settlement: isSettlement(input.settlement) ? input.settlement : "village",
    markup: typeof input.markup === "number" ? input.markup : 0,
    style: input.style === "homebrew-v3" ? "homebrew-v3" : "default",
    description: input.description?.trim() || undefined,
    stock: input.stock ?? [],
    sources: asSources(input.sources),
    books: input.books,
    rarities: asRarities(input.rarities),
    size: asSize(input.size, input.stock?.length || STOCK_COUNT),
    campaignId: input.campaignId ?? null,
  };
}

async function generateStock(userId: string, draft: ShopDraft, avoidIds?: Set<number>): Promise<ShopResult<ShopDraft>> {
  const sources = asSources(draft.sources);
  const catalog = await loadCatalog(userId, sources, draft.books);
  if (!catalog.ok) return catalog;
  const preset = draft.preset;
  const settlement = draft.settlement;
  const level = shopCeiling(preset, settlement);
  const bookSet = draft.books ? new Set(draft.books) : undefined;
  const sourceIds = bookSet && sources.includes("wanderers-guide")
    ? new Set([
      ...catalog.data.items.filter((item) => catalogSourceOf(item) === "pf2e" || bookSet.has(item.content_source_id)).map((item) => item.content_source_id),
    ])
    : undefined;
  const lines = stockShop(
    catalog.data.items,
    catalog.data.traits,
    preset,
    level,
    Math.random,
    sourceIds,
    avoidIds,
    asSize(draft.size),
    draft.rarities ? new Set(draft.rarities) : undefined,
  );
  return ok({ ...draft, size: asSize(draft.size, lines.length), stock: lines.map((line) => toStockRow(line, catalog.data.traits, draft.markup)) });
}

export async function createShop(userId: string, input: {
  name: string;
  parentId?: string | null;
  generate?: boolean;
  preset?: ShopPresetId;
  settlement?: SettlementId;
  size?: number;
  sources?: ShopSource[];
  rarities?: ShopRarity[];
  books?: number[];
  markup?: number;
  style?: ShopPageStyle;
  description?: string;
  campaignId?: number | null;
  stock?: ShopStockRow[];
}) {
  const name = input.name.trim();
  if (!name) return err("VALIDATION_ERROR", "Shop name is required.");
  const listed = await listNodes(userId);
  if (!listed.ok) return listed;
  try {
    assertParent(listed.data, { kind: "entry", parent_id: input.parentId ?? null });
  } catch (error) {
    return err("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid folder.");
  }
  let draft = emptyDraft(input);
  if (input.generate !== false && (!input.stock || input.generate)) {
    const generated = await generateStock(userId, draft);
    if (!generated.ok) return generated;
    draft = generated.data;
  }
  const inserted = await rest(userId, "POST", "syndicated_nodes", {
    user_id: userId,
    content_kind: SHOP_CONTENT_KIND,
    kind: "entry",
    name,
    parent_id: input.parentId ?? null,
    draft,
    published: false,
  });
  if (!inserted.ok) return inserted;
  const node = asNode(inserted.data);
  if (!node) return err("INTERNAL_ERROR", "Shop was not created.");
  return ok({ shop: node });
}

export async function createShopFolder(userId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return err("VALIDATION_ERROR", "Folder name is required.");
  const inserted = await rest(userId, "POST", "syndicated_nodes", {
    user_id: userId,
    content_kind: SHOP_CONTENT_KIND,
    kind: "folder",
    name: trimmed,
    parent_id: null,
    draft: null,
    published: false,
  });
  if (!inserted.ok) return inserted;
  const node = asNode(inserted.data);
  if (!node) return err("INTERNAL_ERROR", "Folder was not created.");
  return ok({ shop: node });
}

async function saveNode(userId: string, node: ShopNode, patch: Record<string, unknown>) {
  const updated = await rest(userId, "PATCH", `syndicated_nodes?id=eq.${node.id}&user_id=eq.${userId}`, patch);
  if (!updated.ok) return updated;
  const next = asNode(updated.data) ?? { ...node, ...patch } as ShopNode;
  return ok({ shop: next });
}

export async function updateShop(userId: string, shopId: string, patch: {
  name?: string;
  description?: string;
  markup?: number;
  style?: ShopPageStyle;
  preset?: ShopPresetId;
  settlement?: SettlementId;
  parentId?: string | null;
  campaignId?: number | null;
  sources?: ShopSource[];
  books?: number[];
  rarities?: ShopRarity[];
  size?: number;
}) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  const node = loaded.data;
  if (node.kind !== "entry" || !node.draft) return err("VALIDATION_ERROR", "Folders have no shop draft.");
  if (patch.parentId !== undefined) {
    const listed = await listNodes(userId);
    if (!listed.ok) return listed;
    try {
      assertParent(listed.data, { kind: "entry", parent_id: patch.parentId });
    } catch (error) {
      return err("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid folder.");
    }
  }
  const draft: ShopDraft = {
    ...node.draft,
    description: patch.description !== undefined ? (patch.description.trim() || undefined) : node.draft.description,
    markup: patch.markup ?? node.draft.markup,
    style: patch.style ?? node.draft.style,
    preset: isPreset(patch.preset) ? patch.preset : node.draft.preset,
    settlement: isSettlement(patch.settlement) ? patch.settlement : node.draft.settlement,
    sources: patch.sources ? asSources(patch.sources) : node.draft.sources,
    books: patch.books ?? node.draft.books,
    rarities: patch.rarities ? asRarities(patch.rarities) : node.draft.rarities,
    size: patch.size !== undefined ? asSize(patch.size) : node.draft.size,
    campaignId: patch.campaignId !== undefined ? patch.campaignId : node.draft.campaignId,
  };
  const body: Record<string, unknown> = { draft };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return err("VALIDATION_ERROR", "Shop name is required.");
    body.name = name;
  }
  if (patch.parentId !== undefined) body.parent_id = patch.parentId;
  return saveNode(userId, node, body);
}

export async function moveShop(userId: string, shopId: string, parentId: string | null) {
  return updateShop(userId, shopId, { parentId });
}

export async function resizeShop(userId: string, shopId: string, size: number) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  const node = loaded.data;
  if (!node.draft) return err("VALIDATION_ERROR", "Nothing to resize.");
  const avoid = new Set((node.draft.stock ?? []).map((row) => row.id));
  const generated = await generateStock(userId, { ...node.draft, size: asSize(size) }, avoid);
  if (!generated.ok) return generated;
  return saveNode(userId, node, { draft: generated.data });
}

async function resolveRefs(userId: string, refs: { source: ShopSource; id: number; quantity?: number; price?: string; description?: string; formula?: boolean }[], markup: number) {
  const sources = [...new Set(refs.map((row) => row.source))];
  const catalog = await loadCatalog(userId, sources);
  if (!catalog.ok) return catalog;
  const stock: ShopStockRow[] = [];
  for (const ref of refs) {
    const item = findCatalogItem(catalog.data.items, ref.source, ref.id);
    if (!item && ref.description) {
      stock.push({
        id: ref.id,
        name: `Custom ${ref.id}`,
        level: 0,
        rarity: "COMMON",
        group: "GENERAL",
        price: ref.price ?? "—",
        quantity: ref.quantity ?? 1,
        bulk: "",
        traits: [],
        description: ref.description,
        source: ref.source,
      });
      continue;
    }
    if (!item) return err("NOT_FOUND", `Item ${ref.source}:${ref.id} not found.`);
    const line = asShopLine(ref.formula ? { ...item, name: item.name.startsWith("Formula: ") ? item.name : `Formula: ${item.name}` } : item);
    if (ref.quantity) line.shopQuantity = ref.quantity;
    const row = toStockRow(line, catalog.data.traits, markup);
    if (ref.price) row.price = ref.price;
    if (ref.description) row.description = ref.description;
    stock.push(row);
  }
  return ok(stock);
}

export async function setShopStock(userId: string, shopId: string, input: {
  generate?: boolean;
  size?: number;
  sources?: ShopSource[];
  rarities?: ShopRarity[];
  books?: number[];
  items?: { source: ShopSource; id: number; quantity?: number; price?: string; description?: string; formula?: boolean }[];
}) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  const node = loaded.data;
  if (!node.draft) return err("VALIDATION_ERROR", "Nothing to stock.");
  let draft: ShopDraft = {
    ...node.draft,
    size: input.size !== undefined ? asSize(input.size) : node.draft.size,
    sources: input.sources ? asSources(input.sources) : node.draft.sources,
    rarities: input.rarities ? asRarities(input.rarities) : node.draft.rarities,
    books: input.books ?? node.draft.books,
  };
  if (input.generate || !input.items) {
    const generated = await generateStock(userId, draft, new Set((node.draft.stock ?? []).map((row) => row.id)));
    if (!generated.ok) return generated;
    draft = generated.data;
  } else {
    const stock = await resolveRefs(userId, input.items, draft.markup);
    if (!stock.ok) return stock;
    draft = { ...draft, stock: stock.data, size: stock.data.length };
  }
  return saveNode(userId, node, { draft });
}

export async function addShopItem(userId: string, shopId: string, input: { source: ShopSource; itemId: number; quantity?: number; price?: string; formula?: boolean }) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  const node = loaded.data;
  if (!node.draft) return err("VALIDATION_ERROR", "Nothing to stock.");
  const stock = await resolveRefs(userId, [{ source: input.source, id: input.itemId, quantity: input.quantity, price: input.price, formula: input.formula }], node.draft.markup);
  if (!stock.ok) return stock;
  const row = stock.data[0];
  const key = lineKey(row.source, row.id, row.group === "FORMULA");
  const existing = (node.draft.stock ?? []).filter((line) => lineKey(line.source, line.id, line.group === "FORMULA") !== key);
  const draft = { ...node.draft, stock: [...existing, row], size: existing.length + 1 };
  return saveNode(userId, node, { draft });
}

function matchKey(row: ShopStockRow, key: string) {
  return lineKey(row.source, row.id, row.group === "FORMULA") === key || String(row.id) === key;
}

export async function updateShopItem(userId: string, shopId: string, key: string, patch: { quantity?: number; price?: string }) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  const node = loaded.data;
  if (!node.draft) return err("VALIDATION_ERROR", "Nothing to update.");
  let found = false;
  const stock = (node.draft.stock ?? []).map((row) => {
    if (!matchKey(row, key)) return row;
    found = true;
    return {
      ...row,
      quantity: patch.quantity ?? row.quantity,
      price: patch.price ?? row.price,
    };
  });
  if (!found) return err("NOT_FOUND", "Stock line not found.");
  return saveNode(userId, node, { draft: { ...node.draft, stock } });
}

export async function removeShopItem(userId: string, shopId: string, key: string) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  const node = loaded.data;
  if (!node.draft) return err("VALIDATION_ERROR", "Nothing to update.");
  const stock = (node.draft.stock ?? []).filter((row) => !matchKey(row, key));
  if (stock.length === (node.draft.stock ?? []).length) return err("NOT_FOUND", "Stock line not found.");
  return saveNode(userId, node, { draft: { ...node.draft, stock, size: stock.length } });
}

export async function deleteShop(userId: string, shopId: string) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  const removed = await rest(userId, "DELETE", `syndicated_nodes?id=eq.${shopId}&user_id=eq.${userId}`);
  if (!removed.ok) return removed;
  return ok({ id: shopId });
}

export async function publishShop(userId: string, shopId: string) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  const node = loaded.data;
  if (node.kind !== "entry" || node.draft == null) return err("VALIDATION_ERROR", "Nothing to publish.");
  return saveNode(userId, node, {
    published: true,
    public_token: node.public_token ?? mintPublicToken(),
    snapshot: node.draft,
    published_at: new Date().toISOString(),
  });
}

export async function unpublishShop(userId: string, shopId: string) {
  const loaded = await getNode(userId, shopId);
  if (!loaded.ok) return loaded;
  return saveNode(userId, loaded.data, { published: false });
}

export { lineKey };
