import { priceToString } from '@items/currency-handler';
import { getBulkLimit, getDefaultContainerContents, getItemBulk, getItemQuantity, isItemContainer, isItemWithQuantity, labelizeBulk } from '@items/inv-utils';
import type { Inventory, InventoryItem, Item } from '@schemas/content';
import { cloneDeep } from 'lodash-es';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

const EMPTY_COINS = { cp: 0, sp: 0, gp: 0, pp: 0 };

export function createInventoryEntry(item: Item, isFormula: boolean, container_contents: InventoryItem[] = []): InventoryItem {
  const itemData = cloneDeep(item);
  if (itemData.meta_data) itemData.meta_data.hp = itemData.meta_data.hp_max;
  return {
    id: crypto.randomUUID(),
    item: itemData,
    is_formula: isFormula,
    is_equipped: false,
    is_invested: false,
    is_implanted: false,
    container_contents,
  };
}

export async function addCatalogItemToInventory(
  inventory: Inventory | null | undefined,
  item: Item,
  isFormula: boolean,
  catalog?: Item[]
): Promise<Inventory> {
  const current = inventory ?? { coins: { ...EMPTY_COINS }, items: [] };
  let container_contents: InventoryItem[] = [];
  try {
    container_contents = await getDefaultContainerContents(item, catalog);
  } catch {
    container_contents = [];
  }
  const nextItem = createInventoryEntry(item, isFormula, container_contents);
  return {
    ...current,
    coins: current.coins ?? { ...EMPTY_COINS },
    items: [...(current.items ?? []), nextItem].sort((a, b) => a.item.name.localeCompare(b.item.name)),
  };
}

export type Phase1InvItem = {
  key: string;
  name: string;
  description: string;
  group: string;
  level: number;
  rarity: string;
  traitNames: string[];
  quantity: number;
  showQuantity: boolean;
  bulkLabel: string;
  priceLabel: string;
  damageSummary: string | null;
  hands: string | null;
  usage: string | null;
  range: string | null;
  acBonus: number | null;
  isEquipped: boolean;
  isFormula: boolean;
  isInvested: boolean;
    isContainer: boolean;
    unselectable: boolean;
    contents: Phase1InvItem[];
};

export type Phase1Inventory = {
  coins: Inventory['coins'] | null;
  extras: Record<string, unknown>;
  items: Phase1InvItem[];
  bulkLimit: number;
};

export async function loadEntityInventory(combatant: Phase1EntityCombatant): Promise<Phase1Inventory> {
  const { entity, content, storeId } = await preparePhase1Entity(combatant);
  const inventory = entity.inventory;
  const traitNames = new Map(content.traits.map((trait) => [trait.id, trait.name]));
  const bulkLimit = getBulkLimit(storeId);

  if (!inventory) {
    return { coins: null, extras: {}, items: [], bulkLimit };
  }

  const extras = Object.fromEntries(
    Object.entries(inventory as Record<string, unknown>).filter(([key]) => key !== 'coins' && key !== 'items')
  );

  return {
    coins: inventory.coins ?? null,
    extras,
    items: (inventory.items ?? []).map((entry, index) => mapInvItem(entry, traitNames, `${index}`, 0)),
    bulkLimit,
  };
}

export function inventoryItemToPhase1(entry: InventoryItem, key = entry.id || 'item'): Phase1InvItem {
  return mapInvItem(entry, new Map(), key, 0);
}

function mapInvItem(
  entry: InventoryItem,
  traitNames: Map<number, string>,
  key: string,
  depth: number
): Phase1InvItem {
  const item = entry.item;
  return {
    key: entry.id || key,
    name: item.name,
    description: item.description,
    group: item.group,
    level: item.level,
    rarity: item.rarity,
    traitNames: (item.traits ?? []).map((id) => traitNames.get(id)).filter((name): name is string => Boolean(name)),
    quantity: getItemQuantity(item),
    showQuantity: Boolean(isItemWithQuantity(item)),
    bulkLabel: labelizeBulk(getItemBulk(entry)),
    priceLabel: formatPrice(item),
    damageSummary: formatDamage(item),
    hands: item.hands?.trim() || null,
    usage: item.usage?.trim() || null,
    range: item.meta_data?.range != null && `${item.meta_data.range}`.trim() !== '' ? `${item.meta_data.range} ft.` : null,
    acBonus: item.meta_data?.ac_bonus ?? null,
    isEquipped: entry.is_equipped,
    isFormula: entry.is_formula,
    isInvested: entry.is_invested,
    isContainer: isItemContainer(item),
    unselectable: Boolean(item.meta_data?.unselectable),
    contents: entry.container_contents.map((child, index) => mapInvItem(child, traitNames, `${key}-${index}`, depth + 1)),
  };
}

function formatPrice(item: Item) {
  if (!item.price) return '—';
  const normalized = {
    cp: Number(item.price.cp) || undefined,
    sp: Number(item.price.sp) || undefined,
    gp: Number(item.price.gp) || undefined,
    pp: Number(item.price.pp) || undefined,
  };
  return priceToString(normalized);
}

function formatDamage(item: Item) {
  const damage = item.meta_data?.damage;
  if (!damage) return null;
  const dice = damage.dice != null && damage.die ? `${damage.dice}${damage.die}` : damage.die ?? null;
  const type = damage.damageType?.replace(/_/g, ' ') ?? null;
  const extra = damage.extra?.trim() || null;
  const parts = [dice, type, extra].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

export function flattenInvItems(items: Phase1InvItem[]): Phase1InvItem[] {
  return items.flatMap((item) => [item, ...flattenInvItems(item.contents)]);
}

export function matchesInvItem(item: Phase1InvItem, needle: string) {
  if (!needle) return true;
  return [item.name, item.description, item.group, item.priceLabel, item.damageSummary ?? '', ...item.traitNames]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function inventoryEntryKey(entry: InventoryItem, index: number, parentKey?: string) {
  return entry.id || (parentKey != null ? `${parentKey}-${index}` : String(index));
}

export function mapInventory(inventory: Inventory | null | undefined, key: string, patch: (item: InventoryItem) => InventoryItem): Inventory {
  const current = inventory ?? { coins: { ...EMPTY_COINS }, items: [] };
  return { ...current, items: mapInvEntries(current.items ?? [], key, patch) };
}

function mapInvEntries(items: InventoryItem[], key: string, patch: (item: InventoryItem) => InventoryItem, parentKey?: string): InventoryItem[] {
  return items.map((entry, index) => {
    const itemKey = inventoryEntryKey(entry, index, parentKey);
    const next = itemKey === key ? patch(entry) : entry;
    if (!next.container_contents?.length) return next;
    return { ...next, container_contents: mapInvEntries(next.container_contents, key, patch, itemKey) };
  });
}

export function findInventoryItem(items: InventoryItem[] | undefined, key: string, parentKey?: string): InventoryItem | null {
  for (const [index, entry] of (items ?? []).entries()) {
    const itemKey = inventoryEntryKey(entry, index, parentKey);
    if (itemKey === key) return entry;
    const nested = findInventoryItem(entry.container_contents, key, itemKey);
    if (nested) return nested;
  }
  return null;
}

export function deleteInventoryItem(inventory: Inventory | null | undefined, key: string): Inventory {
  const current = inventory ?? { coins: { ...EMPTY_COINS }, items: [] };
  return { ...current, items: removeInventoryItem(current.items ?? [], key) };
}

function removeInventoryItem(items: InventoryItem[], key: string, parentKey?: string): InventoryItem[] {
  return items.flatMap((entry, index) => {
    const itemKey = inventoryEntryKey(entry, index, parentKey);
    if (itemKey === key) return [];
    return [{ ...entry, container_contents: removeInventoryItem(entry.container_contents ?? [], key, itemKey) }];
  });
}

export function moveInventoryItem(inventory: Inventory | null | undefined, key: string, containerKey: string | null): Inventory {
  const current = inventory ?? { coins: { ...EMPTY_COINS }, items: [] };
  const moving = cloneDeep(findInventoryItem(current.items, key));
  if (!moving || (containerKey && containerKey === key)) return current;
  const without = removeInventoryItem(current.items ?? [], key);
  if (!containerKey) {
    return { ...current, items: [...without, moving] };
  }
  moving.is_equipped = false;
  return { ...current, items: insertIntoContainer(without, containerKey, moving) };
}

function insertIntoContainer(items: InventoryItem[], containerKey: string, moving: InventoryItem, parentKey?: string): InventoryItem[] {
  return items.map((entry, index) => {
    const itemKey = inventoryEntryKey(entry, index, parentKey);
    if (itemKey === containerKey) {
      return { ...entry, container_contents: [...(entry.container_contents ?? []), moving] };
    }
    return { ...entry, container_contents: insertIntoContainer(entry.container_contents ?? [], containerKey, moving, itemKey) };
  });
}

export function inventoryContainerTargets(items: Phase1InvItem[], excludeKey: string) {
  return items.filter((item) => item.isContainer && item.key !== excludeKey).map((item) => ({ key: item.key, name: item.name }));
}

export function inventoryItemIsNested(items: Phase1InvItem[], key: string): boolean {
  return items.some((item) => item.contents.some((child) => child.key === key) || inventoryItemIsNested(item.contents, key));
}
