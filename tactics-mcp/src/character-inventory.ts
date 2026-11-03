import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { enabledIds, fail, loadRow, ownerGuard, saveRow, textResult } from "./character-catalog.js";
import { invokeFunction, type CharacterRow } from "./character-client.js";

const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

// Trait ids from src/utils/traits.ts. The sheet's Invest button requires INVESTED.
const INVESTED_TRAIT_ID = 1527;
const STAFF_TRAIT_ID = 1546;
// getInvestedLimit is 10 + INVEST_LIMIT_BONUS. The bonus lives in the variable store, not on the row.
const BASE_INVEST_LIMIT = 10;

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

function traitIds(item: Item) {
  const traits = item.traits;
  if (!Array.isArray(traits)) return [];
  return traits.filter((id): id is number => typeof id === "number");
}

function metaOf(item: Item) {
  return (item.meta_data ?? {}) as Record<string, unknown>;
}

// Mirrors isItemWeapon / isItemArmor / isItemShield / isItemStave in src/process/items/inv-utils.tsx.
export function isEquippable(item: Item) {
  const meta = metaOf(item);
  const damage = meta.damage as { damageType?: unknown } | null | undefined;
  const weapon = item.group === "WEAPON" && typeof damage?.damageType === "string" && damage.damageType.length > 0;
  const armor = typeof meta.dex_cap === "number";
  const shield = typeof meta.ac_bonus === "number" && !armor;
  const staff = traitIds(item).includes(STAFF_TRAIT_ID);
  return weapon || armor || shield || staff;
}

export function isInvestable(item: Item) {
  return traitIds(item).includes(INVESTED_TRAIT_ID);
}

function eachEntry(items: InventoryItem[], visit: (entry: InventoryItem, inContainer: boolean) => void) {
  for (const entry of items) {
    visit(entry, false);
    for (const child of entry.container_contents ?? []) visit(child, true);
  }
}

function investedCount(inv: Inventory) {
  let count = 0;
  eachEntry(inv.items, (entry) => {
    if (entry.is_invested) count += 1;
  });
  return count;
}

function findEntry(inv: Inventory, id: string) {
  for (const entry of inv.items) {
    if (entry.id === id) return { entry, inContainer: false };
    for (const child of entry.container_contents ?? []) {
      if (child.id === id) return { entry: child, inContainer: true };
    }
  }
  return null;
}

function handsOf(item: Item) {
  return typeof item.hands === "string" ? item.hands : null;
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

  server.registerTool(
    "set_inventory_item",
    {
      title: "Equip or invest an inventory item",
      description: "Updates is_equipped and/or is_invested on an existing inventory entry, including one inside a container. The sheet stores wielding as is_equipped. item.hands (for example \"1\" or \"2\") is catalog data on the item and is returned, not written. Equip is refused for formulas, for items inside a container (the sheet disables that button), and for items that are not a weapon, armor, shield, or staff. Invest is refused unless the item has the invested trait, and when 10 items are already invested. The sheet's limit is 10 plus INVEST_LIMIT_BONUS; that bonus is not stored on the character row, so this check uses 10. Only the owner can write. Saves with expected_updated_at.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        inventoryItemId: z.string(),
        equipped: z.boolean().optional(),
        invested: z.boolean().optional(),
      },
    },
    async (args) => {
      if (args.equipped === undefined && args.invested === undefined) {
        return textResult("Pass equipped and/or invested.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const inv = inventoryOf(loaded.data);
      const found = findEntry(inv, args.inventoryItemId);
      if (!found) return textResult("No inventory entry with that id.", { code: "NOT_FOUND", retryable: false }, true);
      const { entry, inContainer } = found;
      if (entry.is_formula && (args.equipped === true || args.invested === true)) {
        return textResult("Formulas are not equipped or invested.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      if (args.equipped === true) {
        if (inContainer) return textResult("The sheet disables Equip for an item inside a container.", { code: "VALIDATION_ERROR", retryable: false }, true);
        if (!isEquippable(entry.item)) return textResult("The sheet only equips weapons, armor, shields, and staves.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      if (args.invested === true && !entry.is_invested) {
        if (!isInvestable(entry.item)) return textResult("This item has no invested trait, so the sheet does not offer Invest.", { code: "VALIDATION_ERROR", retryable: false }, true);
        const invested = investedCount(inv);
        if (invested >= BASE_INVEST_LIMIT) {
          return textResult(
            `Invest limit reached (${BASE_INVEST_LIMIT}). The sheet allows ${BASE_INVEST_LIMIT} plus INVEST_LIMIT_BONUS, which this character row does not store.`,
            { code: "VALIDATION_ERROR", retryable: false, invested, investLimit: BASE_INVEST_LIMIT },
            true,
          );
        }
      }
      if (args.equipped !== undefined) entry.is_equipped = args.equipped;
      if (args.invested !== undefined) entry.is_invested = args.invested;
      const saved = await saveRow(userId(), loaded.data, { inventory: inv });
      if (!saved.ok) return fail(saved);
      return textResult(itemName(entry.item) || "Item updated", {
        characterId: args.characterId,
        inventoryItemId: entry.id,
        name: itemName(entry.item),
        is_equipped: entry.is_equipped,
        is_invested: entry.is_invested,
        is_formula: entry.is_formula,
        inContainer,
        hands: handsOf(entry.item),
        invested: investedCount(inventoryOf(saved.data)),
        investLimit: BASE_INVEST_LIMIT,
      });
    },
  );
}
