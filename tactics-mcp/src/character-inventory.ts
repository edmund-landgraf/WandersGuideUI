import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { enabledIds, fail, loadRow, saveRow, textResult } from "./character-catalog.js";
import { invokeFunction, type CharacterRow } from "./character-client.js";

const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

type Item = Record<string, unknown> & { id?: unknown; name?: unknown; meta_data?: Record<string, unknown> };

export type InventoryItem = {
  id: string;
  item: Item;
  is_formula: boolean;
  is_equipped: boolean;
  is_invested: boolean;
  is_implanted: boolean;
  container_contents: InventoryItem[];
};

type Inventory = { coins: { cp: number; sp: number; gp: number; pp: number }; items: InventoryItem[] };

function inventoryOf(row: CharacterRow): Inventory {
  const inv = row.inventory as Partial<Inventory> | undefined;
  return {
    coins: inv?.coins ?? { cp: 0, sp: 0, gp: 0, pp: 0 },
    items: Array.isArray(inv?.items) ? structuredClone(inv.items) : [],
  };
}

function itemName(item: Item) {
  return typeof item.name === "string" ? item.name : "";
}

// Same test as isItemContainer in src/process/items/inv-utils.tsx.
export function isContainer(item: Item) {
  const bulk = item.meta_data?.bulk as { capacity?: unknown } | undefined;
  return bulk?.capacity !== undefined;
}

// Mirrors handleAddItem: clone, reset hp to hp_max, fresh uuid, flags off.
export function makeInventoryItem(item: Item, isFormula: boolean, quantity: number | undefined, contents: InventoryItem[] = []): InventoryItem {
  const data = structuredClone(item);
  if (data.meta_data) {
    data.meta_data.hp = data.meta_data.hp_max;
    if (quantity !== undefined) data.meta_data.quantity = quantity;
  }
  return {
    id: crypto.randomUUID(),
    item: data,
    is_formula: isFormula,
    is_equipped: false,
    is_invested: false,
    is_implanted: false,
    container_contents: isFormula ? [] : contents,
  };
}

// Mirrors getDefaultContainerContents (depth limit 10).
async function defaultContents(item: Item, find: (id: number) => Promise<Item | null>, depth = 1): Promise<InventoryItem[]> {
  if (depth > 10) return [];
  const records = (item.meta_data?.container_default_items as { id?: number; quantity?: number }[] | undefined) ?? [];
  const out: InventoryItem[] = [];
  for (const record of records) {
    if (typeof record.id !== "number") continue;
    const found = await find(record.id);
    if (!found) continue;
    out.push(makeInventoryItem(found, false, record.quantity, await defaultContents(found, find, depth + 1)));
  }
  return out;
}

const byName = (a: InventoryItem, b: InventoryItem) => itemName(a.item).localeCompare(itemName(b.item));

export function placeItem(inv: Inventory, entry: InventoryItem, containerId?: string) {
  if (!containerId) {
    inv.items = [...inv.items, entry].sort(byName);
    return true;
  }
  const container = inv.items.find((x) => x.id === containerId);
  if (!container || container.is_formula || !isContainer(container.item)) return false;
  container.container_contents = [...(container.container_contents ?? []), entry].sort(byName);
  return true;
}

// Mirrors handleDeleteItem: drop from the top level and from every container.
export function removeItem(inv: Inventory, inventoryItemId: string) {
  const before = JSON.stringify(inv.items);
  inv.items = inv.items.filter((x) => x.id !== inventoryItemId);
  for (const x of inv.items) {
    if (Array.isArray(x.container_contents)) x.container_contents = x.container_contents.filter((c) => c.id !== inventoryItemId);
  }
  return JSON.stringify(inv.items) !== before;
}

function listing(inv: Inventory) {
  return inv.items.map((x) => ({
    id: x.id,
    name: itemName(x.item),
    itemId: x.item.id ?? null,
    is_formula: x.is_formula,
    quantity: x.item.meta_data?.quantity ?? null,
    contents: (x.container_contents ?? []).map((c) => ({ id: c.id, name: itemName(c.item), itemId: c.item.id ?? null, quantity: c.item.meta_data?.quantity ?? null })),
  }));
}

export function registerCharacterInventory(server: McpServer, userId: () => string) {
  server.registerTool(
    "add_inventory_item",
    {
      title: "Add inventory item or formula",
      description: "Adds a catalog item (list_options kind item) to inventory.items the way the sheet's Add Items modal does: new uuid, hp reset, default container contents for kits and packs. isFormula true adds it to the formula book instead. quantity sets meta_data.quantity. containerId puts it inside an existing container's container_contents. Saves with expected_updated_at.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        itemId: z.number().int(),
        isFormula: z.boolean().optional(),
        quantity: z.number().int().min(1).optional(),
        containerId: z.string().optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const sources = enabledIds(loaded.data);
      const find = async (id: number) => {
        const found = await invokeFunction(userId(), "find-item", { id, content_sources: sources });
        if (!found.ok) return null;
        const item = Array.isArray(found.data) ? found.data[0] : found.data;
        return item && typeof item === "object" ? item as Item : null;
      };
      const item = await find(args.itemId);
      if (!item) return textResult("Item not found in the character's books.", { code: "NOT_FOUND", retryable: false }, true);
      const isFormula = Boolean(args.isFormula);
      if (isFormula && args.containerId) return textResult("Formulas go in the formula book, not a container.", { code: "VALIDATION_ERROR", retryable: false }, true);
      const contents = isFormula ? [] : await defaultContents(item, find);
      const entry = makeInventoryItem(item, isFormula, args.quantity, contents);
      const inv = inventoryOf(loaded.data);
      if (!placeItem(inv, entry, args.containerId)) return textResult("containerId is not a container in this inventory.", { code: "VALIDATION_ERROR", retryable: false }, true);
      const saved = await saveRow(userId(), loaded.data, { inventory: inv });
      if (!saved.ok) return fail(saved);
      return textResult(`Added ${itemName(item)}${isFormula ? " (formula)" : ""}`, { characterId: args.characterId, inventoryItemId: entry.id, items: listing(inventoryOf(saved.data)) });
    },
  );

  server.registerTool(
    "remove_inventory_item",
    {
      title: "Remove inventory item",
      description: "Removes one inventory entry by its inventory id (from add_inventory_item or the items list), from the top level and from any container, the way the sheet's delete does.",
      annotations: writes,
      inputSchema: { characterId: z.number().int(), inventoryItemId: z.string() },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const inv = inventoryOf(loaded.data);
      if (!removeItem(inv, args.inventoryItemId)) return textResult("No inventory entry with that id.", { code: "NOT_FOUND", retryable: false }, true);
      const saved = await saveRow(userId(), loaded.data, { inventory: inv });
      if (!saved.ok) return fail(saved);
      return textResult("Item removed", { characterId: args.characterId, items: listing(inventoryOf(saved.data)) });
    },
  );
}
