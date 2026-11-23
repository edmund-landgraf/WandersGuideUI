import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { textResult } from "./character-catalog.js";
import { searchFoundryShopItems } from "./foundry-shop-lookup.js";
import {
  addShopItem,
  createFoundryShop,
  createShop,
  createShopFolder,
  deleteShop,
  getPublishedShop,
  getShop,
  listShops,
  moveShop,
  publishShop,
  removeShopItem,
  resizeShop,
  searchShopCatalog,
  setShopStock,
  unpublishShop,
  updateShop,
  updateShopItem,
  type ShopResult,
} from "./shops.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const source = z.enum(["wanderers-guide", "pf2e", "foundry"]);
const preset = z.enum([
  "general", "magic", "alchemical", "ammo", "gadget", "armorer", "blacksmith", "gunsmith",
  "jeweler", "lost", "tailor", "potion", "materials", "tattoo", "runes",
]);
const settlement = z.enum(["village", "town", "city", "metro10", "metro13", "metro16", "metro20"]);
const rarity = z.enum(["COMMON", "UNCOMMON", "RARE", "UNIQUE"]);

function fromResult(result: ShopResult<unknown>, okText: string) {
  if (!result.ok) return textResult(result.message, { code: result.code, retryable: result.retryable === true }, true);
  return textResult(okText, result.data as Record<string, unknown>);
}

export function registerShops(server: McpServer, userId: () => string) {
  server.registerTool("search_foundry_shop_items", {
    title: "Search Foundry shop items",
    description: "Searches the active Foundry-backed item source. Use each result's wgId as the item id when adding stock, and include source=foundry; unresolved and missing mappings are never returned.",
    annotations: readOnly,
    inputSchema: { q: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), formulas: z.boolean().optional() },
  }, async (args) => textResult("Foundry shop items", searchFoundryShopItems(args.q ?? "", args.limit ?? 50, args.formulas ?? false)));

  server.registerTool("list_shops", {
    title: "List shops",
    description: "Owned shop folders and entries. List rows omit stock descriptions.",
    annotations: readOnly,
    inputSchema: {},
  }, async () => fromResult(await listShops(userId()), "Shops"));

  server.registerTool("get_shop", {
    title: "Get shop",
    description: "One owned shop draft, including stock and line keys.",
    annotations: readOnly,
    inputSchema: { shopId: z.string() },
  }, async (args) => fromResult(await getShop(userId(), args.shopId), "Shop"));

  server.registerTool("get_published_shop", {
    title: "Get published shop",
    description: "Published snapshot from syndicated_public by public token.",
    annotations: readOnly,
    inputSchema: { token: z.string() },
  }, async (args) => fromResult(await getPublishedShop(userId(), args.token), "Published shop"));

  server.registerTool("search_shop_catalog", {
    title: "Search shop catalog",
    description: "Searches the selected shop item source: wanderers-guide, pf2e, foundry, or both (WG+PF2E). Foundry is a source filter, not a separate shop type. Each hit includes source.",
    annotations: readOnly,
    inputSchema: {
      q: z.string().optional(),
      source: z.enum(["wanderers-guide", "pf2e", "foundry", "both"]).optional(),
    },
  }, async (args) => fromResult(await searchShopCatalog(userId(), args.q ?? "", args.source ?? "both"), "Catalog"));

  server.registerTool("create_shop", {
    title: "Create shop",
    description: "Creates one saved shop. sources selects the allowed item sources (wanderers-guide, pf2e, and/or foundry); generate true (default) stocks only from those sources. Foundry is not a separate shop type.",
    annotations: writes,
    inputSchema: {
      name: z.string(),
      parentId: z.string().nullable().optional(),
      generate: z.boolean().optional(),
      preset: preset.optional(),
      settlement: settlement.optional(),
      size: z.number().int().min(1).max(100).optional(),
      sources: z.array(source).optional(),
      rarities: z.array(rarity).optional(),
      books: z.array(z.number().int()).optional(),
      markup: z.number().optional(),
      style: z.enum(["default", "homebrew-v3"]).optional(),
      description: z.string().optional(),
      campaignId: z.number().int().nullable().optional(),
    },
  }, async (args) => fromResult(await createShop(userId(), args), "Shop created"));

  server.registerTool("create_foundry_shop", {
    title: "Create Foundry shop",
    description: "Creates one saved shop whose stock is exactly the given active Foundry equipment rows. Pass each wgId from search_foundry_shop_items. A row whose Foundry level differs from the Wanderer's Guide catalog level is rejected.",
    annotations: writes,
    inputSchema: {
      name: z.string(),
      items: z.array(z.object({
        wgId: z.number().int(),
        quantity: z.number().int().min(1).optional(),
        price: z.string().optional(),
      })).min(1),
      parentId: z.string().nullable().optional(),
      preset: preset.optional(),
      settlement: settlement.optional(),
      markup: z.number().optional(),
      style: z.enum(["default", "homebrew-v3"]).optional(),
      description: z.string().optional(),
      campaignId: z.number().int().nullable().optional(),
    },
  }, async (args) => fromResult(await createFoundryShop(userId(), args), "Shop created"));

  server.registerTool("create_shop_folder", {
    title: "Create shop folder",
    description: "Root folder for organizing saved shops.",
    annotations: writes,
    inputSchema: { name: z.string() },
  }, async (args) => fromResult(await createShopFolder(userId(), args.name), "Folder created"));

  server.registerTool("update_shop", {
    title: "Update shop",
    description: "Rename and patch one shop, including campaignId, books, sources, and markup. sources may include wanderers-guide, pf2e, and/or foundry.",
    annotations: writes,
    inputSchema: {
      shopId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      markup: z.number().optional(),
      style: z.enum(["default", "homebrew-v3"]).optional(),
      preset: preset.optional(),
      settlement: settlement.optional(),
      parentId: z.string().nullable().optional(),
      campaignId: z.number().int().nullable().optional(),
      sources: z.array(source).optional(),
      books: z.array(z.number().int()).optional(),
      rarities: z.array(rarity).optional(),
      size: z.number().int().min(1).max(100).optional(),
    },
  }, async (args) => {
    const { shopId, ...patch } = args;
    return fromResult(await updateShop(userId(), shopId, patch), "Shop updated");
  });

  server.registerTool("resize_shop", {
    title: "Resize shop",
    description: "Regenerates stock to size (1–100), down-weighting the previous lines.",
    annotations: writes,
    inputSchema: { shopId: z.string(), size: z.number().int().min(1).max(100) },
  }, async (args) => fromResult(await resizeShop(userId(), args.shopId, args.size), "Shop resized"));

  server.registerTool("add_shop_item", {
    title: "Add shop item",
    description: "Appends catalog items without replacing the rest of the stock. Pass items for several refs in one call, or source plus itemId for one. set_shop_stock replaces the whole inventory.",
    annotations: writes,
    inputSchema: {
      shopId: z.string(),
      source: source.optional(),
      itemId: z.number().int().optional(),
      quantity: z.number().int().min(1).optional(),
      price: z.string().optional(),
      formula: z.boolean().optional(),
      items: z.array(z.object({
        source,
        id: z.number().int().optional(),
        itemId: z.number().int().optional(),
        quantity: z.number().int().min(1).optional(),
        price: z.string().optional(),
        description: z.string().optional(),
        formula: z.boolean().optional(),
      })).optional(),
    },
  }, async (args) => {
    const { shopId, ...input } = args;
    return fromResult(await addShopItem(userId(), shopId, input), input.items?.length ? "Items added" : "Item added");
  });

  server.registerTool("update_shop_item", {
    title: "Update shop item",
    description: "Sets quantity and/or price on a stock line. key is wanderers-guide:{id}, pf2e:{id}, or with :formula.",
    annotations: writes,
    inputSchema: {
      shopId: z.string(),
      key: z.string(),
      quantity: z.number().int().min(1).optional(),
      price: z.string().optional(),
    },
  }, async (args) => fromResult(await updateShopItem(userId(), args.shopId, args.key, args), "Item updated"));

  server.registerTool("remove_shop_item", {
    title: "Remove shop item",
    description: "Removes a stock line by key.",
    annotations: writes,
    inputSchema: { shopId: z.string(), key: z.string() },
  }, async (args) => fromResult(await removeShopItem(userId(), args.shopId, args.key), "Item removed"));

  server.registerTool("set_shop_stock", {
    title: "Set shop stock",
    description: "Replaces stock from catalog refs, or regenerates when generate is true. Refs are source plus id so descriptions stay off the MCP body.",
    annotations: writes,
    inputSchema: {
      shopId: z.string(),
      generate: z.boolean().optional(),
      size: z.number().int().min(1).max(100).optional(),
      sources: z.array(source).optional(),
      rarities: z.array(rarity).optional(),
      books: z.array(z.number().int()).optional(),
      items: z.array(z.object({
        source,
        id: z.number().int(),
        quantity: z.number().int().min(1).optional(),
        price: z.string().optional(),
        description: z.string().optional(),
        formula: z.boolean().optional(),
      })).optional(),
    },
  }, async (args) => {
    const { shopId, ...input } = args;
    return fromResult(await setShopStock(userId(), shopId, input), "Stock set");
  });

  server.registerTool("move_shop", {
    title: "Move shop",
    description: "Moves an entry into a root folder, or to the library root when parentId is null.",
    annotations: writes,
    inputSchema: { shopId: z.string(), parentId: z.string().nullable() },
  }, async (args) => fromResult(await moveShop(userId(), args.shopId, args.parentId), "Shop moved"));

  server.registerTool("delete_shop", {
    title: "Delete shop",
    description: "Deletes an owned shop or folder.",
    annotations: writes,
    inputSchema: { shopId: z.string() },
  }, async (args) => fromResult(await deleteShop(userId(), args.shopId), "Shop deleted"));

  server.registerTool("publish_shop", {
    title: "Publish shop",
    description: "Publishes the draft snapshot. Calling again refreshes the public snapshot and keeps the token.",
    annotations: writes,
    inputSchema: { shopId: z.string() },
  }, async (args) => fromResult(await publishShop(userId(), args.shopId), "Shop published"));

  server.registerTool("unpublish_shop", {
    title: "Unpublish shop",
    description: "Clears the published flag. The public token stays on the row.",
    annotations: writes,
    inputSchema: { shopId: z.string() },
  }, async (args) => fromResult(await unpublishShop(userId(), args.shopId), "Shop unpublished"));
}
