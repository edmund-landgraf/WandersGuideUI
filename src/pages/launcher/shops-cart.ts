import { copperAsGp, offerCopper } from './shops-generate';
import type { ShopStockRow } from './shops-syndicate';

export type ShopCartLine = {
  key: string;
  shopId: string;
  shopName: string;
  name: string;
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
  return { key: String(row.key), shopId: String(row.shopId), shopName: String(row.shopName), name: String(row.name), qty, copper };
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
