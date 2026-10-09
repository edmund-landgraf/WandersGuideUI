import type { Item, Trait } from '@schemas/content';
import { compileWgText } from '@pages/phase1/phase1-markdown';
import { toStandard2eProse } from '@utils/foundry-text';
import { publicPath } from '../../syndication/nodes';
import { asShopLine, formatShopOffer, isShopFormula, shopLineQuantity, type SettlementId, type ShopPresetId } from './shops-generate';

export const SHOP_CONTENT_KIND = 'shop';
export const SHOP_PUBLIC_PREFIX = '/shops/s';

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
};

export type ShopPageStyle = 'default' | 'homebrew-v3';

export type ShopDraft = {
  preset: ShopPresetId;
  settlement: SettlementId;
  markup: number;
  style?: ShopPageStyle;
  description?: string;
  stock: ShopStockRow[];
};

function cardText(value: string) {
  return toStandard2eProse(compileWgText(value))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>]/g, '')
    .trim();
}

export function shopDraft(
  preset: ShopPresetId,
  settlement: SettlementId,
  items: Item[],
  traits: Trait[],
  markup = 0,
  style: ShopPageStyle = 'default',
  description = '',
): ShopDraft {
  return {
    preset,
    settlement,
    markup,
    style,
    description: description.trim() || undefined,
    stock: items.map((item) => ({
      id: item.id,
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
    })),
  };
}

export function shopPublicUrl(token: string) {
  return `${location.origin}${publicPath(SHOP_PUBLIC_PREFIX, token)}`;
}
