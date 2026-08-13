import { priceToString } from '@items/currency-handler';
import { getItemQuantity, isItemContainer, labelizeBulk } from '@items/inv-utils';
import type { Inventory, InventoryItem, Item } from '@schemas/content';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

export type Phase1InvItem = {
  key: string;
  name: string;
  description: string;
  group: string;
  level: number;
  rarity: string;
  traitNames: string[];
  quantity: number;
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
  contents: Phase1InvItem[];
};

export type Phase1Inventory = {
  coins: Inventory['coins'] | null;
  extras: Record<string, unknown>;
  items: Phase1InvItem[];
};

export async function loadEntityInventory(combatant: Phase1EntityCombatant): Promise<Phase1Inventory> {
  const { entity, content } = await preparePhase1Entity(combatant);
  const inventory = entity.inventory;
  const traitNames = new Map(content.traits.map((trait) => [trait.id, trait.name]));

  if (!inventory) {
    return { coins: null, extras: {}, items: [] };
  }

  const extras = Object.fromEntries(
    Object.entries(inventory as Record<string, unknown>).filter(([key]) => key !== 'coins' && key !== 'items')
  );

  return {
    coins: inventory.coins ?? null,
    extras,
    items: (inventory.items ?? []).map((entry, index) => mapInvItem(entry, traitNames, `${index}`, 0)),
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
    bulkLabel: labelizeBulk(entry.is_formula ? '0' : item.bulk ?? undefined, true),
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
