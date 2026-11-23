import { copperAsGp, offerCopper } from './shops-generate';
import type { ShopStockRow } from './shops-syndicate';

export type ShopCartLine = {
  key: string;
  shopId: string;
  shopName: string;
  /** Wanderer's Guide shop folder, when the shop lives in one. */
  folderName?: string;
  name: string;
  id?: number;
  qty: number;
  copper: number;
};

const COOKIE = 'wg-shop-cart';
const MAX_AGE = 30 * 24 * 60 * 60;

export function cartLineKey(shopId: string, row: Pick<ShopStockRow, 'id' | 'name'>) {
  return `${shopId}:${row.id}:${row.name}`;
}

export function itemCopper(price: string) {
  const parsed = offerCopper(price);
  if (parsed.copper <= 0) return 0;
  return Math.round(parsed.copper / parsed.pack);
}

function asLine(value: unknown): ShopCartLine | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<ShopCartLine>;
  if (!row.key || !row.shopId || !row.shopName || !row.name) return null;
  const qty = Number(row.qty);
  const copper = Number(row.copper);
  if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(copper) || copper < 1) return null;
  const id = Number(row.id);
  const folderName = typeof row.folderName === 'string' ? row.folderName.trim() : '';
  return {
    key: String(row.key),
    shopId: String(row.shopId),
    shopName: String(row.shopName),
    ...(folderName ? { folderName } : {}),
    name: String(row.name),
    ...(Number.isFinite(id) ? { id } : {}),
    qty,
    copper,
  };
}

/**
 * One shop keeps that shop's name. Several shops use their shared Wanderer's Guide
 * folder (Kerse), so the Foundry folder can be dated the same way as a single shop.
 */
export function cartFoundryTitle(lines: Pick<ShopCartLine, 'shopId' | 'shopName' | 'folderName'>[], pageFolder?: string | null) {
  const shops = new Map<string, { shopName: string; folderName?: string }>();
  for (const line of lines) {
    if (!shops.has(line.shopId)) shops.set(line.shopId, { shopName: line.shopName, folderName: line.folderName });
  }
  if (shops.size <= 1) return [...shops.values()][0]?.shopName ?? 'Shop';
  const folders = [...shops.values()].map((shop) => shop.folderName?.trim() || pageFolder?.trim() || '');
  const unique = [...new Set(folders.filter(Boolean))];
  if (unique.length === 1) return unique[0];
  const settlements = [...shops.values()].map((shop) => {
    const parts = shop.shopName.split(/\s+[—–-]\s+/);
    return parts.length > 1 ? parts[parts.length - 1].trim() : '';
  });
  const shared = [...new Set(settlements.filter(Boolean))];
  if (shared.length === 1 && settlements.every(Boolean)) return shared[0];
  return 'Cart';
}

export function readShopCart(): ShopCartLine[] {
  try {
    const match = document.cookie.split('; ').find((part) => part.startsWith(`${COOKIE}=`));
    if (!match) return [];
    const parsed = JSON.parse(decodeURIComponent(match.slice(COOKIE.length + 1))) as { lines?: unknown };
    if (!Array.isArray(parsed.lines)) return [];
    return parsed.lines.map(asLine).filter((line): line is ShopCartLine => Boolean(line));
  } catch {
    return [];
  }
}

export function writeShopCart(lines: ShopCartLine[]) {
  try {
    if (lines.length === 0) {
      document.cookie = `${COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
      return;
    }
    document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify({ lines }))}; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}`;
  } catch {
    // Private mode can block cookies; the in-memory cart still works.
  }
}

export function cartTotalCopper(lines: ShopCartLine[]) {
  return lines.reduce((sum, line) => sum + line.qty * line.copper, 0);
}

export function cartTotalGp(lines: ShopCartLine[]) {
  return `${copperAsGp(cartTotalCopper(lines))} gp`;
}

export function lineGold(line: ShopCartLine) {
  return `${copperAsGp(line.qty * line.copper)} gp`;
}
