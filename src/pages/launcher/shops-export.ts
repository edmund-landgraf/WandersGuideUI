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

function asContentType(type: string): ContentType | null {
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
