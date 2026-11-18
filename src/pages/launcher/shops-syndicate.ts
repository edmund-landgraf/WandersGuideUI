import type { Item, Trait } from '@schemas/content';
import { compileWgText } from '@pages/phase1/phase1-markdown';
import { toStandard2eProse } from '@utils/foundry-text';
import { publicPath } from '../../syndication/nodes';
import { asShopLine, formatShopOffer, isShopFormula, shopLineQuantity, type SettlementId, type ShopPresetId, type ShopRarity } from './shops-generate';
import { isPf2eShopItem, shopAonHref } from './shops-pf2e';

export const SHOP_CONTENT_KIND = 'shop';
export const SHOP_PUBLIC_PREFIX = '/shops/s';

/** Console trace for shop startup. Filter DevTools on `[wgui shops]`. */
export function shopTrace(step: string, detail?: Record<string, unknown>) {
  if (detail) console.info(`[wgui shops] ${step}`, detail);
  else console.info(`[wgui shops] ${step}`);
}

export function shopTraceStart(step: string) {
  const started = performance.now();
  shopTrace(step);
  return (detail?: Record<string, unknown>) => {
    shopTrace(`${step} done`, { ms: Math.round(performance.now() - started), ...detail });
  };
}

export type ShopCatalogSource = 'wanderers-guide' | 'pf2e';

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
  source?: ShopCatalogSource | null;
  aon?: string;
};

export type ShopPageStyle = 'default' | 'homebrew-v3';

export type ShopDraft = {
  preset: ShopPresetId;
  settlement: SettlementId;
  markup: number;
  style?: ShopPageStyle;
  description?: string;
  stock: ShopStockRow[];
  sources?: ShopCatalogSource[];
  books?: number[];
  rarities?: ShopRarity[];
  size?: number;
  campaignId?: number | null;
};

function cardText(value: string) {
  return toStandard2eProse(compileWgText(value)).trim();
}

export function stockSource(item: Item): ShopCatalogSource {
  return isPf2eShopItem(item) ? 'pf2e' : 'wanderers-guide';
}

export function stockCatalogId(item: Item) {
  return isPf2eShopItem(item) ? Math.abs(item.id) : item.id;
}

export function shopDraft(
  preset: ShopPresetId,
  settlement: SettlementId,
  items: Item[],
  traits: Trait[],
  markup = 0,
  style: ShopPageStyle = 'default',
  description = '',
  extras: Pick<ShopDraft, 'sources' | 'books' | 'rarities' | 'size' | 'campaignId'> & {
    aonIndex?: ReadonlyMap<string, string>;
  } = {},
): ShopDraft {
  return {
    preset,
    settlement,
    markup,
    style,
    description: description.trim() || undefined,
    sources: extras.sources,
    books: extras.books,
    rarities: extras.rarities,
    size: extras.size,
    campaignId: extras.campaignId,
    stock: items.map((item) => ({
      id: stockCatalogId(item),
      name: item.name,
      level: item.level,
      rarity: item.rarity,
      group: isShopFormula(item) ? 'FORMULA' : item.group,
      price: formatShopOffer(asShopLine(item), markup),
      quantity: shopLineQuantity(asShopLine(item)),
      bulk: item.bulk ? String(item.bulk) : '',
      traits: (item.traits ?? [])
        .map((id) => traits.find((trait) => trait.id === id)?.name)
        .filter((name): name is string => Boolean(name)),
      description: cardText(item.description),
      source: stockSource(item),
      aon: shopAonHref(item, extras.aonIndex),
    })),
  };
}

export function shopPublicUrl(token: string) {
  return `${location.origin}${publicPath(SHOP_PUBLIC_PREFIX, token)}`;
}
