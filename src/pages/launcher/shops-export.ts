import { getContentDataFromHref } from '@common/rich_text_input/ContentLinkExtension';
import { getConditionByName } from '@conditions/condition-handler';
import { convertToContentType, isAbilityBlockType } from '@content/content-utils';
import { compileWgText } from '@pages/phase1/phase1-markdown';
import type { ContentType } from '@schemas/shared';
import type { Item, Trait } from '@schemas/content';
import { ContentTypeSchema } from '@schemas/shared';
import { toStandard2eProse, toWgMarkdownLinks } from '@utils/foundry-text';
import { asShopLine, formatShopOffer, isShopFormula, shopLineQuantity } from './shops-generate';

export const SHOP_EXPORT_CAP = 400;
const FOUNDRY_QTY_MAX = 50;

export type ShopFoundryLookupStatus = 'active' | 'ambiguous' | 'unresolved';
export type ShopFoundrySkipStatus = ShopFoundryLookupStatus | 'catalog-not-loaded' | 'missing-id' | 'formula-not-cataloged';
export type ShopFoundryLookupRow = {
  wgId: number;
  name?: string | null;
  pack?: string | null;
  slug?: string | null;
  status: ShopFoundryLookupStatus;
};
export type ShopFoundryLookup = {
  version: 1;
  rows: ShopFoundryLookupRow[];
  /** Formula documents are separate from ordinary item documents. */
  formulas?: ShopFoundryLookupRow[];
  /** Equipment compendium rows. Used when the stock id is not a Wanderer's Guide item id. */
  foundryItems?: ShopFoundryLookupRow[];
};

let shopFoundryLookupPromise: Promise<ShopFoundryLookup | null> | undefined;

/** Loads the generated lookup artifact; the browser never connects to Postgres. */
export function loadShopFoundryLookup(): Promise<ShopFoundryLookup | null> {
  shopFoundryLookupPromise ??= fetch('/data/shop-foundry-lookup.json', { credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) return null;
      const value = (await response.json()) as Partial<ShopFoundryLookup>;
      if (value.version !== 1 || !Array.isArray(value.rows)) return null;
      return value as ShopFoundryLookup;
    })
    .catch(() => null);
  return shopFoundryLookupPromise;
}

export function foundryItemSlug(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** One short token stays as written. Several words become their initials. */
export function abbreviatedShopName(title: string) {
  const words = (title.trim() || 'Shop').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length <= 1) return (words[0] ?? 'Shop').slice(0, 12);
  return words.map((word) => word[0]).join('').slice(0, 8).toUpperCase();
}

/** Folder notes are free text. Drop path and control characters before they reach Foundry. */
export function sanitizeShopFolderNote(note: string) {
  return note
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export function shopFolderLabel(title: string, when = new Date(), note = '') {
  const label = `${abbreviatedShopName(title)} ${when.getMonth() + 1}-${when.getDate()}`;
  const clean = sanitizeShopFolderNote(note);
  return clean ? `${label} - ${clean}` : label;
}

export function shopFoundryManifest(title: string, stock: Item[], when = new Date(), lookup?: ShopFoundryLookup | null, note = '', options?: ShopFoundryManifestOptions) {
  return shopStockFoundryManifest(
    title,
    stock.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: shopLineQuantity(asShopLine(item)),
      description: item.description,
      level: item.level,
      price: item.price,
      rarity: item.rarity,
      bulk: item.bulk,
    })),
    when,
    lookup,
    note,
    options,
  );
}

const GRADE_WORDS = 'minor|lesser|moderate|greater|major|true|supreme';

function shopNameKey(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Catalog "X (Greater)" and shop "Greater X" share one key pair. */
function shopNameKeys(name: string) {
  const key = shopNameKey(name);
  const keys = new Set([key]);
  const lead = new RegExp(`^(${GRADE_WORDS}) (.+)$`).exec(key);
  if (lead) keys.add(`${lead[2]} ${lead[1]}`);
  const trail = new RegExp(`^(.+) (${GRADE_WORDS})$`).exec(key);
  if (trail) keys.add(`${trail[2]} ${trail[1]}`);
  return [...keys];
}

const foundryNameIndex = new WeakMap<ShopFoundryLookupRow[], Map<string, ShopFoundryLookupRow | null>>();

function foundryItemsByName(items: ShopFoundryLookupRow[]) {
  const cached = foundryNameIndex.get(items);
  if (cached) return cached;
  const index = new Map<string, ShopFoundryLookupRow | null>();
  for (const item of items) {
    if (!item.name || !item.pack || !item.slug) continue;
    for (const key of shopNameKeys(item.name)) {
      if (!index.has(key)) index.set(key, item);
      else {
        const current = index.get(key);
        if (!current || current.slug !== item.slug || current.pack !== item.pack) index.set(key, null);
      }
    }
  }
  foundryNameIndex.set(items, index);
  return index;
}

function foundryNameMatch(name: string, items: ShopFoundryLookupRow[]) {
  const index = foundryItemsByName(items);
  const hits = shopNameKeys(name)
    .map((key) => index.get(key))
    .filter((row): row is ShopFoundryLookupRow => Boolean(row?.pack && row?.slug));
  const slugs = new Set(hits.map((row) => `${row.pack}:${row.slug}`));
  return slugs.size === 1 ? hits[0] : undefined;
}

/**
 * A Wanderer's Guide item id is authoritative, including unresolved rows.
 * Local equipment ids are a different sequence, so those lines use a unique
 * Foundry equipment name. Formulas stay on the formula lookup.
 */
export function shopCatalogMatch(item: { id?: number; name: string }, lookup?: ShopFoundryLookup | null) {
  const formula = /^formula:\s*/i.test(item.name);
  const rows = formula ? (lookup?.formulas ?? []) : (lookup?.rows ?? []);
  const byId = item.id === undefined ? undefined : rows.find((row) => row.wgId === item.id);
  if (byId || formula) return byId;
  const named = foundryNameMatch(item.name, lookup?.foundryItems ?? []);
  return named ? { ...named, status: 'active' as const } : undefined;
}

export type ShopFoundryCatalogItem = { pack: string; slug: string; name: string; qty: number };
export type ShopFoundryCustomItem = {
  custom: true;
  name: string;
  qty: number;
  wgId?: number;
  description?: string;
  level?: number;
  price?: Item['price'];
  rarity?: string;
  bulk?: string;
};

type ShopManifestStock = {
  id?: number;
  name: string;
  quantity?: number;
  description?: string;
  level?: number;
  price?: Item['price'];
  rarity?: string;
  bulk?: string | null;
};

const CUSTOM_MISS = new Set<ShopFoundrySkipStatus>(['unresolved', 'ambiguous', 'missing-id', 'catalog-not-loaded']);

export type ShopFoundryManifestOptions = { customOnUnmatched?: boolean };

function customShopItem(item: ShopManifestStock): ShopFoundryCustomItem {
  const row: ShopFoundryCustomItem = {
    custom: true,
    name: item.name,
    qty: Math.min(FOUNDRY_QTY_MAX, Math.max(1, item.quantity ?? 1)),
  };
  if (item.id !== undefined) row.wgId = item.id;
  const description = item.description?.trim();
  if (description) row.description = description;
  if (typeof item.level === 'number' && Number.isFinite(item.level)) row.level = item.level;
  if (item.price && Object.values(item.price).some((coin) => Number(coin))) row.price = item.price;
  if (item.rarity?.trim()) row.rarity = item.rarity.trim();
  if (typeof item.bulk === 'string' && item.bulk.trim()) row.bulk = item.bulk.trim();
  return row;
}

export function shopStockFoundryManifest(title: string, stock: ShopManifestStock[], when = new Date(), lookup?: ShopFoundryLookup | null, note = '', options?: ShopFoundryManifestOptions) {
  const label = title.trim() || 'Shop';
  const skipped: { id?: number; name: string; status: ShopFoundrySkipStatus }[] = [];
  const items = stock.flatMap((item): (ShopFoundryCatalogItem | ShopFoundryCustomItem)[] => {
    const isFormula = /^formula:\s*/i.test(item.name);
    const match = shopCatalogMatch(item, lookup);
    const active = Boolean(lookup && match?.status === 'active' && match.pack && match.slug);
    // The catalog is an allowlist. Never derive a Foundry slug from display
    // text: names can contain legacy notes, grades, or other WG-only labels.
    if (isFormula && !active) {
      skipped.push({ ...(item.id !== undefined ? { id: item.id } : {}), name: item.name, status: 'formula-not-cataloged' });
      return [];
    }
    // A unique Foundry equipment name is enough. Cart lines from a local
    // equipment list often have no Wanderer's Guide id.
    if (!active) {
      const status: ShopFoundrySkipStatus = !lookup ? 'catalog-not-loaded' : match?.status ?? (item.id === undefined ? 'missing-id' : 'unresolved');
      if (options?.customOnUnmatched && CUSTOM_MISS.has(status)) return [customShopItem(item)];
      skipped.push({ ...(item.id !== undefined ? { id: item.id } : {}), name: item.name, status });
      return [];
    }
    if (!match?.pack || !match.slug) return [];
    const foundry = (lookup?.foundryItems ?? []).find((row) => row.pack === match.pack && row.slug === match.slug && row.name?.trim());
    return [{
      pack: match.pack,
      slug: match.slug,
      name: foundry?.name?.trim() || match.name?.trim() || item.name,
      qty: Math.min(FOUNDRY_QTY_MAX, Math.max(1, item.quantity ?? 1)),
    }];
  });
  return {
    schemaVersion: 1 as const,
    source: 'amba' as const,
    ambaModuleId: 'wgui-shop',
    encounterId: foundryItemSlug(label) || 'shop',
    title: label,
    folder: shopFolderLabel(label, when, note),
    items,
    ...(lookup ? { lookupStatus: 'catalog-loaded' as const } : { lookupStatus: 'match-catalog-not-loaded' as const }),
    ...(skipped.length ? { skipped } : {}),
  };
}

export type ShopExportCard = {
  key: string;
  title: string;
  meta: string;
  prose: string;
};

const LINK = /\[([^\]]+)\]\((?:<)?(link_[^)\s>]+)(?:>)?\)/g;

export function proseWithLinks(text: string) {
  return toWgMarkdownLinks(toStandard2eProse(compileWgText(text)));
}

export function contentLinkRefs(text: string) {
  const refs: { type: string; id: string }[] = [];
  for (const match of proseWithLinks(text).matchAll(LINK)) {
    const data = getContentDataFromHref(match[2]);
    if (data) refs.push({ type: data.type, id: data.id });
  }
  return refs;
}

function cardKey(type: string, id: string) {
  return `${type}:${id}`;
}

export function asContentType(type: string): ContentType | null {
  const converted = isAbilityBlockType(type) || type === 'cast-spell' || type === 'add-spell' || type === 'inv-item'
    ? convertToContentType(type as ContentType)
    : type;
  const parsed = ContentTypeSchema.safeParse(converted);
  return parsed.success ? parsed.data : null;
}

function recordTexts(record: Record<string, unknown>) {
  return ['description', 'special']
    .map((field) => record[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function recordTitle(record: Record<string, unknown>, fallback: string) {
  return typeof record.name === 'string' && record.name.trim() ? record.name : fallback;
}

function recordMeta(record: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof record.level === 'number') parts.push(`Level ${record.level}`);
  if (typeof record.rank === 'number') parts.push(`Rank ${record.rank}`);
  if (typeof record.rarity === 'string') parts.push(record.rarity);
  if (typeof record.group === 'string') parts.push(record.group.replaceAll('_', ' '));
  if (typeof record.type === 'string') parts.push(record.type.replaceAll('_', ' '));
  return parts.join(' · ');
}

function itemMeta(item: Item, traits: Trait[], markup = 0) {
  const names = (item.traits ?? [])
    .map((id) => traits.find((trait) => trait.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const parts = [
    `Level ${item.level}`,
    item.rarity,
    item.group.replaceAll('_', ' '),
    formatShopOffer(asShopLine(item), markup),
    item.bulk ? `Bulk ${item.bulk}` : '',
    ...names,
  ].filter(Boolean);
  return parts.join(' · ');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatInline(text: string) {
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(/\*\*([^*]+)\*\*|\*([^*]+)\*/g)) {
    const index = match.index ?? 0;
    parts.push(escapeHtml(text.slice(last, index)));
    const bold = match[1];
    parts.push(bold !== undefined
      ? `<strong>${escapeHtml(bold)}</strong>`
      : `<em>${escapeHtml(match[2] ?? '')}</em>`);
    last = index + match[0].length;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join('');
}

function formatChunk(text: string) {
  return text.split('\n').map((line) => (
    /^\s*(\*\*\*|---)\s*$/.test(line) ? '<hr>' : formatInline(line)
  )).join('\n');
}

export function renderProse(prose: string, openIds: ReadonlyMap<string, string>) {
  const parts: string[] = [];
  let last = 0;
  for (const match of prose.matchAll(LINK)) {
    const index = match.index ?? 0;
    parts.push(formatChunk(prose.slice(last, index)));
    const data = getContentDataFromHref(match[2]);
    const domId = data ? openIds.get(cardKey(data.type, data.id)) : undefined;
    parts.push(domId
      ? `<button type="button" data-open="${escapeHtml(domId)}">${escapeHtml(match[1])}</button>`
      : escapeHtml(match[1]));
    last = index + match[0].length;
  }
  parts.push(formatChunk(prose.slice(last)));
  return parts.join('');
}

export async function collectShopCards(
  stock: Item[],
  catalog: Item[],
  traits: Trait[],
  load: (type: ContentType, id: number) => Promise<Record<string, unknown> | null>,
  markup = 0,
) {
  const itemsById = new Map(catalog.map((item) => [item.id, item]));
  const traitsById = new Map(traits.map((trait) => [trait.id, trait]));
  const cards: ShopExportCard[] = [];
  const seen = new Set<string>();
  const queue: { type: string; id: string }[] = stock.map((item) => ({ type: 'item', id: String(item.id) }));
  const queued = new Set(queue.map((ref) => cardKey(ref.type, ref.id)));
  let capped = false;

  const enqueue = (ref: { type: string; id: string }) => {
    const key = cardKey(ref.type, ref.id);
    if (seen.has(key) || queued.has(key)) return;
    if (cards.length + queued.size >= SHOP_EXPORT_CAP) {
      capped = true;
      return;
    }
    queued.add(key);
    queue.push(ref);
  };

  const enqueueFrom = (texts: string[]) => {
    for (const text of texts) {
      for (const ref of contentLinkRefs(text)) enqueue(ref);
    }
  };

  while (queue.length > 0 && cards.length < SHOP_EXPORT_CAP) {
    const next = queue.shift();
    if (!next) break;
    const key = cardKey(next.type, next.id);
    queued.delete(key);
    if (seen.has(key)) continue;
    seen.add(key);

    if (next.type === 'condition') {
      const condition = getConditionByName(next.id);
      if (!condition) continue;
      const texts = [condition.description].filter(Boolean);
      cards.push({
        key,
        title: condition.name,
        meta: 'Condition',
        prose: texts.map(proseWithLinks).join('\n\n'),
      });
      enqueueFrom(texts);
      continue;
    }

    const numericId = Number(next.id);
    const contentType = asContentType(next.type);
    let record: Record<string, unknown> | null = null;
    if (next.type === 'item' && itemsById.has(numericId)) {
      record = itemsById.get(numericId) as unknown as Record<string, unknown>;
    } else if (next.type === 'trait' && traitsById.has(numericId)) {
      record = traitsById.get(numericId) as unknown as Record<string, unknown>;
    } else if (contentType && Number.isFinite(numericId)) {
      record = await load(contentType, numericId);
    }
    if (!record) continue;

    const texts = recordTexts(record);
    const meta = next.type === 'item' && itemsById.has(numericId)
      ? itemMeta(itemsById.get(numericId) as Item, traits, markup)
      : recordMeta(record);
    cards.push({
      key,
      title: recordTitle(record, next.id),
      meta: meta || next.type,
      prose: texts.map(proseWithLinks).join('\n\n'),
    });
    enqueueFrom(texts);
  }

  if (queue.length > 0) capped = true;
  return { cards, capped };
}

export function shopExportHtml(title: string, stock: Item[], cards: ShopExportCard[], markup = 0) {
  const openIds = new Map(cards.map((card, index) => [card.key, `c${index}`]));
  const rows = stock.map((item) => {
    const open = openIds.get(cardKey('item', String(item.id)));
    const name = open
      ? `<button type="button" data-open="${escapeHtml(open)}">${escapeHtml(item.name)}</button>`
      : escapeHtml(item.name);
    const line = asShopLine(item);
    return `<tr>
      <td>${escapeHtml(`${shopLineQuantity(line)} ×`)}</td>
      <td>${name}</td>
      <td>${escapeHtml(String(item.level))}</td>
      <td>${escapeHtml(item.rarity)}</td>
      <td>${escapeHtml(isShopFormula(item) ? 'FORMULA' : item.group)}</td>
      <td>${escapeHtml(formatShopOffer(line, markup))}</td>
    </tr>`;
  }).join('\n');
  const library = cards.map((card) => `
    <article id="${openIds.get(card.key)}" class="card">
      <h2>${escapeHtml(card.title)}</h2>
      <p class="meta">${escapeHtml(card.meta)}</p>
      <div class="prose">${renderProse(card.prose, openIds)}</div>
    </article>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #111827; color: #f4f4f5; font: 14px/1.5 system-ui, sans-serif; }
    main { max-width: 960px; margin: 0 auto; padding: 40px 32px 80px; }
    h1 { font-family: Georgia, serif; font-size: 2.25rem; font-weight: 400; }
    table { width: 100%; border-collapse: collapse; text-align: left; background: rgba(255,255,255,0.05); }
    th, td { padding: 12px 16px; }
    th { color: #a1a1aa; font-weight: 500; }
    tbody tr { border-top: 1px solid rgba(255,255,255,0.1); }
    button { color: inherit; background: none; border: 0; padding: 0; font: inherit; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.25); text-underline-offset: 2px; cursor: pointer; }
    .meta { color: #b5b5b5; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
    .prose { white-space: pre-wrap; margin-top: 12px; }
    .prose hr { border: 0; border-top: 1px solid rgba(255,255,255,0.2); margin: 12px 0; }
    .prose strong { font-weight: 600; }
    #overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); }
    #overlay[hidden] { display: none; }
    #sheet { width: 360px; max-height: min(50vh, 420px); overflow: auto; margin: 12vh auto; background: #1c1c1c; color: #fafafa; padding: 16px; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.5); }
    #sheet h2 { margin: 0; font-family: Georgia, serif; font-size: 1rem; font-weight: 400; }
    #sheet .card { margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <table>
      <thead>
        <tr>
          <th>Qty</th>
          <th>Name</th>
          <th>Level</th>
          <th>Rarity</th>
          <th>Group</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </main>
  <div id="library" hidden>${library}</div>
  <div id="overlay" hidden>
    <div id="sheet">
      <button type="button" data-close>Close</button>
      <div id="slot"></div>
    </div>
  </div>
  <script>
    const overlay = document.getElementById('overlay');
    const slot = document.getElementById('slot');
    const library = document.getElementById('library');
    document.body.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const open = target.closest('[data-open]');
      if (open && slot && library) {
        const source = library.querySelector('#' + CSS.escape(open.getAttribute('data-open') || ''));
        if (!source) return;
        slot.replaceChildren(source.cloneNode(true));
        overlay.hidden = false;
      }
      if (target.closest('[data-close]')) overlay.hidden = true;
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.hidden = true;
    });
  </script>
</body>
</html>`;
}
