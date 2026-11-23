import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getContentDataFromHref } from '@common/rich_text_input/ContentLinkExtension';
import { fetchContentById } from '@content/content-store';
import { getConditionByName } from '@conditions/condition-handler';
import { compileWgText } from '@pages/phase1/phase1-markdown';
import { normalizeMarkdownTables, resolveAonHref, toStandard2eProse } from '@utils/foundry-text';
import { ShopPopout } from './shop-popout';
import { fetchPf2eEquipmentText, fillMissingShopAon, loadShopAonIndex, priceFromStatBlock } from './shops-pf2e';
import { listOwned, readPublic } from '../../syndication/store';
import { LauncherHeader } from './launcher-header';
import { asContentType, loadShopFoundryLookup, shopStockFoundryManifest, type ShopFoundryLookup } from './shops-export';
import { cartFoundryTitle, cartLineKey, cartTotalGp, itemCopper, lineGold, readShopCart, writeShopCart, type ShopCartLine } from './shops-cart';
import { formatCopperOffer, formulaCopper, priceAsGp } from './shops-generate';
import { SHOP_CONTENT_KIND, shopTraceStart, type ShopDraft, type ShopStockRow } from './shops-syndicate';
import type { SyndicatedNode } from '../../syndication/nodes';

export function prepareShopProse(text: string) {
  return htmlInlineToMarkdown(normalizeMarkdownTables(toStandard2eProse(compileWgText(text))));
}

/** Common HTML formatting becomes markdown; leftover tags are dropped so raw markup is not shown. */
function htmlInlineToMarkdown(text: string): string {
  if (!text || !text.includes('<')) return text;
  let out = text;
  out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, inner: string) => {
    return `\n${'#'.repeat(Number(level))} ${inner.trim()}\n\n`;
  });
  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner: string) => `\n- ${inner.trim()}`);
  out = out.replace(/<\/?(?:ul|ol|div|span|section)\b[^>]*>/gi, '\n');
  out = out.replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, '');
  return out.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\n{3,}/g, '\n\n');
}

export function ShopProse({ text, className, homebrew = false }: { text: string; className?: string; homebrew?: boolean }) {
  const [follow, setFollow] = useState<{ href: string; title: string } | null>(null);
  return (
    <div className={className}>
      <ShopMarkdown text={text} homebrew={homebrew} onOpen={setFollow} />
      {follow && <ShopFollow href={follow.href} title={follow.title} homebrew={homebrew} onOpen={setFollow} />}
    </div>
  );
}

function ShopMarkdown({
  text,
  homebrew,
  onOpen,
}: {
  text: string;
  homebrew: boolean;
  onOpen: (next: { href: string; title: string }) => void;
}) {
  const line = homebrew ? 'border-[#8a5a22]/35' : 'border-white/15';
  const heading = homebrew ? 'text-[#6b1d14]' : 'text-[#fafafa]';
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className='mb-2 last:mb-0'>{children}</p>,
        h1: ({ children }) => <p className={`mb-1 mt-3 text-xs font-semibold uppercase tracking-wide ${heading}`}>{children}</p>,
        h2: ({ children }) => <p className={`mb-1 mt-3 text-xs font-semibold uppercase tracking-wide ${heading}`}>{children}</p>,
        h3: ({ children }) => <p className={`mb-1 mt-3 text-xs font-semibold uppercase tracking-wide ${heading}`}>{children}</p>,
        h4: ({ children }) => <p className={`mb-1 mt-3 text-xs font-semibold uppercase tracking-wide ${heading}`}>{children}</p>,
        ul: ({ children }) => <ul className='mb-2 list-disc pl-4'>{children}</ul>,
        ol: ({ children }) => <ol className='mb-2 list-decimal pl-4'>{children}</ol>,
        hr: () => <hr className={`my-2 border-0 border-t ${line}`} />,
        table: ({ children }) => (
          <div className='mb-2 overflow-x-auto'>
            <table className='w-full border-collapse text-left text-[11px] leading-4'>{children}</table>
          </div>
        ),
        th: ({ children }) => <th className={`border-b px-1 py-1 font-semibold ${line}`}>{children}</th>,
        td: ({ children }) => <td className={`border-b px-1 py-1 align-top ${line}`}>{children}</td>,
        code: ({ children }) => {
          const value = String(children ?? '');
          const glyph = value.startsWith('action_symbol_')
            ? ({ '1': '◆', '2': '◆◆', '3': '◆◆◆', '4': '◇', '5': '↩' } as Record<string, string>)[value.replace('action_symbol_', '')]
            : undefined;
          if (glyph) return <span>{glyph}</span>;
          return <code>{children}</code>;
        },
        a: ({ href, children }) => {
          const resolved = resolveAonHref(href);
          const content = getContentDataFromHref(resolved ?? href ?? '');
          if (content) {
            const label = linkLabel(children);
            return (
              <button
                type='button'
                className={homebrew ? 'underline decoration-[#6b1d14]/50 underline-offset-2' : 'underline decoration-white/40 underline-offset-2'}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpen({ href: `link_${content.type}_${String(content.id).replace(/ /g, '~')}`, title: label });
                }}
              >
                {children}
              </button>
            );
          }
          if (resolved && /^https?:\/\//i.test(resolved)) {
            return <a href={resolved} target='_blank' rel='noreferrer' className='underline underline-offset-2'>{children}</a>;
          }
          return <span>{children}</span>;
        },
      }}
    >
      {prepareShopProse(text)}
    </ReactMarkdown>
  );
}

function linkLabel(children: ReactNode): string {
  if (typeof children === 'string') return children.replace(/^_|_$/g, '');
  if (Array.isArray(children)) return children.map((child) => linkLabel(child)).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return linkLabel((children.props as { children?: ReactNode }).children);
  }
  return 'Details';
}

function ShopFollow({
  href,
  title,
  homebrew,
  onOpen,
}: {
  href: string;
  title: string;
  homebrew: boolean;
  onOpen: (next: { href: string; title: string }) => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setBody(null);
    setMissing(false);
    void linkedDescription(href).then((text) => {
      if (cancelled) return;
      if (!text) setMissing(true);
      else setBody(text);
    });
    return () => {
      cancelled = true;
    };
  }, [href]);
  const muted = homebrew ? 'text-[#5c4630]' : 'text-[#b5b5b5]';
  return (
    <div className={`mt-3 border-t pt-3 ${homebrew ? 'border-[#8a5a22]/40' : 'border-white/15'}`}>
      <p className={`text-[11px] uppercase tracking-wide ${muted}`}>{title}</p>
      {body == null && !missing && <p className={`mt-2 text-xs ${muted}`}>Loading…</p>}
      {missing && <p className={`mt-2 text-xs ${muted}`}>No description for this link.</p>}
      {body && <div className='mt-2'><ShopMarkdown text={body} homebrew={homebrew} onOpen={onOpen} /></div>}
    </div>
  );
}

async function linkedDescription(href: string) {
  const data = getContentDataFromHref(href);
  if (!data) return '';
  if (data.type === 'condition') return getConditionByName(data.id)?.description ?? '';
  const id = Number(data.id);
  const contentType = asContentType(data.type);
  if (!contentType || !Number.isFinite(id)) return '';
  const record = await fetchContentById<Record<string, unknown>>(contentType, id);
  if (!record) return '';
  return ['description', 'special']
    .map((field) => record[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');
}

export const HOMEBREW_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=IM+Fell+English:ital@0;1&display=swap');
.brew-v3 {
  padding: 36px 16px 72px;
  color: #3b2414;
}
.brew-v3 .brew-sheet {
  max-width: 880px;
  margin: 0 auto;
  padding: 42px 52px 64px;
  color: #3b2414;
  background:
    repeating-linear-gradient(0deg, rgba(90, 60, 20, 0.018) 0 1px, transparent 1px 4px),
    radial-gradient(ellipse at 50% 8%, #fff8e8, transparent 46%),
    linear-gradient(180deg, #f8efd8 0%, #f3e6c8 100%);
  box-shadow:
    0 0 0 1px #5a3a1c,
    0 0 0 10px #f3e6c8,
    0 0 0 11px #8a5a22,
    0 28px 70px rgba(0,0,0,0.5);
  font-family: "Crimson Pro", Georgia, serif;
  font-size: 16.5px;
  line-height: 1.4;
}
.brew-masthead { text-align: center; margin: 0 0 22px; }
.brew-folder {
  margin: 0 0 14px;
  font-family: Cinzel, Palatino, serif;
  font-size: 1.15rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.brew-folder a { color: #6b1d14; }
.brew-rule-double {
  height: 5px;
  border: 0;
  border-top: 2px solid #6b3a1f;
  border-bottom: 1px solid #6b3a1f;
  background: none;
}
.brew-rule-thin {
  height: 0;
  margin: 0;
  border: 0;
  border-top: 1px solid #6b3a1f;
}
.brew-v3 h1 {
  margin: 10px 0 12px;
  padding: 0;
  border: 0;
  font-family: "IM Fell English", Palatino, serif;
  font-size: 2.6rem;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6b1d14;
}
.brew-note {
  margin: 10px 0 20px;
  text-align: center;
  font-style: italic;
  color: #6b4a2e;
}
.brew-v3 table { width: 100%; border-collapse: collapse; }
.brew-v3 th {
  font-family: Cinzel, Palatino, serif;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #6b1d14;
  text-align: left;
  padding: 8px 10px 10px;
  border-bottom: 2px solid #6b3a1f;
}
.brew-v3 td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(107, 58, 31, 0.22);
  vertical-align: middle;
  color: #3b2414;
}
.brew-v3 tbody tr:nth-child(even) { background: rgba(139, 90, 40, 0.13); }
.brew-v3 th:nth-child(1), .brew-v3 td:nth-child(1) { width: 4.2rem; white-space: nowrap; }
.brew-v3 .brew-dir th:nth-child(1), .brew-v3 .brew-dir td:nth-child(1) { width: auto; white-space: normal; }
.brew-v3 .brew-dir a { color: #6b1d14; }
.brew-v3 th:nth-child(2), .brew-v3 td:nth-child(2) { width: auto; }
.brew-v3 th:nth-child(n+3), .brew-v3 td:nth-child(n+3) { width: 6.2rem; white-space: nowrap; }
.brew-v3 .brew-cart th:nth-child(1), .brew-v3 .brew-cart td:nth-child(1) { width: auto; white-space: normal; }
.brew-v3 .brew-cart th:nth-child(n+2), .brew-v3 .brew-cart td:nth-child(n+2) { width: 5.5rem; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
.brew-v3 .brew-cart th:last-child, .brew-v3 .brew-cart td:last-child { width: 5rem; }
.brew-v3 button {
  color: #6b1d14;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  text-decoration: underline;
  text-decoration-color: rgba(107, 29, 20, 0.45);
  text-underline-offset: 3px;
  cursor: pointer;
}
.brew-v3 .brew-sheet .text-foreground,
.brew-v3 .brew-sheet .text-muted-foreground,
.brew-v3 .brew-sheet button,
.brew-v3 .brew-sheet label,
.brew-v3 .brew-sheet input,
.brew-v3 .brew-sheet td { color: #3b2414; }
.brew-v3 .brew-sheet .border-white\\/10,
.brew-v3 .brew-sheet .border-b { border-color: rgba(107, 58, 31, 0.28); }
`;

function shownPrice(price: string, inGp: boolean) {
  const plain = price.replace(/\*$/, '');
  return inGp ? priceAsGp(plain) : plain;
}

function StockName({ row, homebrew = false, inGp = false }: { row: ShopStockRow; homebrew?: boolean; inGp?: boolean }) {
  const description = useShopItemText(row);
  return (
    <span className='inline-flex items-baseline gap-2'>
    <ShopPopout
      label={row.name}
      href={row.aon}
      cardClassName={homebrew
        ? 'w-[360px] max-h-[min(50vh,420px)] overflow-y-auto bg-[#f7edd4] p-4 text-left text-[#1c140c] shadow-2xl ring-1 ring-[#8a5a22]'
        : 'w-[360px] max-h-[min(50vh,420px)] overflow-y-auto rounded-xl bg-[#1c1c1c] p-4 text-left text-[#fafafa] shadow-2xl ring-1 ring-white/25'}
      titleClassName={homebrew ? 'font-serif text-lg text-[#6b1d14]' : 'font-heading text-base text-[#fafafa]'}
    >
      <p className={homebrew ? 'text-[11px] uppercase tracking-wide text-[#5c4630]' : 'text-[11px] uppercase tracking-wide text-[#b5b5b5]'}>
        Level {row.level} · {row.rarity} · {row.group.replaceAll('_', ' ')}
      </p>
      {row.traits.length > 0 && (
        <div className='mt-2 flex flex-wrap gap-1'>
          {row.traits.map((name) => (
            <span key={name} className={homebrew ? 'rounded bg-[#6b1d14]/10 px-1.5 py-0.5 text-[10px] uppercase text-[#6b1d14]' : 'rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-[#d4d4d4]'}>
              {name}
            </span>
          ))}
        </div>
      )}
      <p className={homebrew ? 'mt-3 text-xs text-[#5c4630]' : 'mt-3 text-xs text-[#b5b5b5]'}>
        {shownPrice(row.price, inGp)}
        {row.bulk ? ` · Bulk ${row.bulk}` : ''}
      </p>
      {description && (
        <ShopProse
          text={description}
          homebrew={homebrew}
          className={homebrew ? 'mt-3 text-sm leading-6 text-[#1c140c]' : 'mt-3 text-sm leading-6 text-[#f4f4f5]'}
        />
      )}
    </ShopPopout>
    {row.aon && (
      <a
        href={row.aon}
        target='_blank'
        rel='noreferrer'
        title='Archives of Nethys'
        className={homebrew ? 'text-[11px] uppercase tracking-wide text-[#6b1d14] underline' : 'text-[11px] uppercase tracking-wide underline'}
      >
        AoN
      </a>
    )}
    </span>
  );
}

function summaryIsCutOff(text: string) {
  return /(?:\u2026|\.{3})\s*$/.test(text.trim());
}

function useShopItemText(row: ShopStockRow) {
  const [text, setText] = useState(row.description);
  useEffect(() => {
    setText(row.description);
    if (row.source !== 'pf2e' || !summaryIsCutOff(row.description)) return;
    let cancelled = false;
    void fetchPf2eEquipmentText(row.id).then((full) => {
      if (!cancelled && full) setText(full);
    });
    return () => {
      cancelled = true;
    };
  }, [row.description, row.id, row.source]);
  return text;
}

function withKnownOffer(rows: ShopStockRow[]) {
  return rows.map((row) => {
    if (itemCopper(row.price) > 0) return row;
    if (row.name.startsWith('Formula: ') || row.group === 'FORMULA') {
      const price = formatCopperOffer(formulaCopper(row.level));
      return price === '—' ? row : { ...row, price };
    }
    return row;
  });
}

function groupLabel(group: string) {
  return group.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function groupedStock(stock: ShopStockRow[]) {
  const buckets = new Map<string, ShopStockRow[]>();
  for (const row of stock) {
    const key = row.group || 'Other';
    const rows = buckets.get(key);
    if (rows) rows.push(row);
    else buckets.set(key, [row]);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => groupLabel(left).localeCompare(groupLabel(right)))
    .map(([group, rows]) => ({
      group,
      rows: [...rows].sort((left, right) => left.name.localeCompare(right.name) || left.level - right.level),
    }));
}

const GROUPINGS_SESSION_KEY = 'wg-shop-use-groupings';
const IN_GP_SESSION_KEY = 'wg-shop-in-gp';

function readFlag(key: string, fallback: boolean) {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored === null) return fallback;
    return stored !== '0';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    sessionStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Private mode can block storage; the in-memory checkbox still works.
  }
}

export function readGroupingsPreference(): boolean {
  return readFlag(GROUPINGS_SESSION_KEY, true);
}

export function writeGroupingsPreference(value: boolean) {
  writeFlag(GROUPINGS_SESSION_KEY, value);
}

function ShopViewToggles({
  useGroupings,
  inGp,
  onGroupings,
  onInGp,
}: {
  useGroupings: boolean;
  inGp: boolean;
  onGroupings: (value: boolean) => void;
  onInGp: (value: boolean) => void;
}) {
  return (
    <div className='flex flex-wrap items-center gap-4 text-sm'>
      <label className='flex items-center gap-2'>
        <input type='checkbox' checked={useGroupings} onChange={(event) => onGroupings(event.target.checked)} />
        Use groupings
      </label>
      <label className='flex items-center gap-2'>
        <input type='checkbox' checked={inGp} onChange={(event) => onInGp(event.target.checked)} />
        In gp
      </label>
    </div>
  );
}

function ShopDescription({ text, homebrew }: { text: string; homebrew: boolean }) {
  const long = text.trim().length > 280 || text.split('\n').length > 4;
  const body = <ShopProse text={text} homebrew={homebrew} className={homebrew ? 'brew-note' : 'max-w-3xl text-sm leading-6 text-muted-foreground'} />;
  if (!long) return body;
  if (homebrew) {
    return (
      <details className='border-b border-[#6b3a1f]/30'>
        <summary className='cursor-pointer py-2 text-center font-serif text-sm uppercase tracking-wide text-[#6b1d14]'>
          Description
        </summary>
        {body}
      </details>
    );
  }
  return (
    <details className='group max-w-3xl rounded-xl bg-white/5 ring-1 ring-white/20'>
      <summary className='cursor-pointer list-none px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden'>
        <span className='mr-2 inline-block w-3 transition-transform group-open:rotate-90' aria-hidden>▸</span>
        Description
      </summary>
      <div className='px-4 pb-4'>{body}</div>
    </details>
  );
}

export function ShopDocument({
  cartKey,
  name,
  stock,
  homebrew,
  description,
  folder,
}: {
  cartKey: string;
  name: string;
  stock: ShopStockRow[];
  homebrew: boolean;
  description?: string;
  folder?: { id: string; name: string } | null;
}) {
  const [linked, setLinked] = useState(() => withKnownOffer(fillMissingShopAon(stock, new Map())));
  const [cart, setCart] = useState(readShopCart);
  useEffect(() => {
    setLinked(withKnownOffer(fillMissingShopAon(stock, new Map())));
    if (stock.every((row) => row.aon && !/Search\.aspx/i.test(row.aon))) return;
    let cancelled = false;
    void loadShopAonIndex()
      .then((index) => {
        if (!cancelled) setLinked(withKnownOffer(fillMissingShopAon(stock, index)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stock]);
  useEffect(() => {
    const missing = linked.filter((row) => itemCopper(row.price) <= 0 && row.source === 'pf2e');
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (row) => {
      const price = priceFromStatBlock(row.name, await fetchPf2eEquipmentText(row.id));
      return price ? { id: row.id, name: row.name, price } : null;
    })).then((found) => {
      if (cancelled) return;
      const updates = found.filter((row): row is { id: number; name: string; price: string } => Boolean(row));
      if (updates.length === 0) return;
      setLinked((current) => current.map((row) => {
        if (itemCopper(row.price) > 0) return row;
        const next = updates.find((item) => item.id === row.id && item.name === row.name);
        return next ? { ...row, price: next.price } : row;
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [linked]);
  const [useGroupings, setUseGroupings] = useState(readGroupingsPreference);
  const [inGp, setInGp] = useState(() => readFlag(IN_GP_SESSION_KEY, false));
  const [foundryNote, setFoundryNote] = useState('');
  const [foundryDraft, setFoundryDraft] = useState<{
    title: string;
    stock: { id?: number; name: string; quantity?: number }[];
    when: Date;
    lookup: ShopFoundryLookup | null;
  } | null>(null);
  const [foundryCopied, setFoundryCopied] = useState(false);
  const foundryScriptRef = useRef<HTMLTextAreaElement>(null);
  const sections = useGroupings ? groupedStock(linked) : null;
  const saveCart = (next: ShopCartLine[]) => {
    writeShopCart(next);
    setCart(next);
  };
  const addRow = (row: ShopStockRow) => {
    const copper = itemCopper(row.price);
    if (copper <= 0) return;
    const key = cartLineKey(cartKey, row);
    const cap = Math.max(1, row.quantity ?? 1);
    const existing = cart.find((line) => line.key === key);
    if (existing && existing.qty >= cap) return;
    const folderName = folder?.name.trim() || undefined;
    if (existing) {
      saveCart(cart.map((line) => (line.key === key ? { ...line, qty: line.qty + 1, ...(folderName ? { folderName } : {}) } : line)));
      return;
    }
    saveCart([...cart, { key, shopId: cartKey, shopName: name, ...(folderName ? { folderName } : {}), name: row.name, id: row.id, qty: 1, copper }]);
  };
  const removeKey = (key: string) => {
    const existing = cart.find((line) => line.key === key);
    if (!existing) return;
    if (existing.qty <= 1) {
      saveCart(cart.filter((line) => line.key !== key));
      return;
    }
    saveCart(cart.map((line) => (line.key === key ? { ...line, qty: line.qty - 1 } : line)));
  };
  const table = (rows: ShopStockRow[]) => (
    <StockTable stock={rows} homebrew={homebrew} inGp={inGp} shopId={cartKey} cart={cart} onAdd={addRow} onRemove={removeKey} />
  );
  const strip = <ShopCartStrip homebrew={homebrew} cart={cart} onRemove={removeKey} onClear={() => saveCart([])} />;
  const openFoundry = async () => {
    setFoundryCopied(false);
    setFoundryNote('');
    const lookup = await loadShopFoundryLookup();
    const title = cart.length > 0 ? cartFoundryTitle(cart, folder?.name) : name;
    setFoundryDraft({
      title,
      stock: cart.map((line) => ({ id: line.id, name: line.name, quantity: line.qty })),
      when: new Date(),
      lookup,
    });
  };
  const foundryScript = foundryDraft
    ? JSON.stringify(shopStockFoundryManifest(foundryDraft.title, foundryDraft.stock, foundryDraft.when, foundryDraft.lookup, foundryNote), null, 2)
    : null;
  const toggles = (
    <div className='flex flex-wrap items-center justify-end gap-4'>
      <ShopViewToggles
        useGroupings={useGroupings}
        inGp={inGp}
        onGroupings={(value) => {
          writeGroupingsPreference(value);
          setUseGroupings(value);
        }}
        onInGp={(value) => {
          writeFlag(IN_GP_SESSION_KEY, value);
          setInGp(value);
        }}
      />
      <button className='underline underline-offset-2' type='button' onClick={openFoundry}>
        Export to Foundry
      </button>
    </div>
  );
  const foundryDialog = foundryScript !== null && (
    <div className='fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6'>
      <div className='flex max-h-full w-full max-w-2xl flex-col gap-3 rounded-lg bg-[#1c1917] p-4 text-stone-100 ring-1 ring-white/15'>
        <div className='flex items-center justify-between gap-3'>
          <p className='text-sm'>Foundry import script</p>
          <button className='underline underline-offset-2' type='button' onClick={() => setFoundryDraft(null)}>Close</button>
        </div>
        <p className='text-sm text-stone-300'>Copy this and paste it into Foundry’s Import AMBA manifest dialog.</p>
        <label className='grid gap-1 text-sm text-stone-300'>
          Optional note
          <input
            className='rounded-lg bg-black/40 px-3 py-2 text-stone-100 ring-1 ring-white/15'
            value={foundryNote}
            placeholder='Appended to the folder name'
            onChange={(event) => {
              setFoundryCopied(false);
              setFoundryNote(event.target.value);
            }}
          />
        </label>
        <textarea
          ref={foundryScriptRef}
          className='min-h-64 w-full flex-1 resize-y rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-stone-100 ring-1 ring-white/15'
          readOnly
          value={foundryScript}
        />
        <button
          className='self-start rounded-lg bg-stone-100 px-4 py-2 text-sm text-stone-900'
          type='button'
          onClick={() => {
            void navigator.clipboard.writeText(foundryScript).then(() => setFoundryCopied(true)).catch(() => {
              foundryScriptRef.current?.focus();
              foundryScriptRef.current?.select();
            });
          }}
        >
          {foundryCopied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );

  if (homebrew) {
    return (
      <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
        <div className='bg-pattern' />
        <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
          <LauncherHeader />
          <style>{HOMEBREW_CSS}</style>
          <div className='brew-v3'>
            <article className='brew-sheet'>
              <header className='brew-masthead'>
                {folder ? (
                  <p className='brew-folder'>
                    <a href={`/shops/folder/${encodeURIComponent(folder.id)}`}>{folder.name}</a>
                  </p>
                ) : null}
                <hr className='brew-rule-double' />
                <h1>{name}</h1>
                <hr className='brew-rule-thin' />
              </header>
              {description ? <ShopDescription text={description} homebrew /> : null}
              <div className='mb-4 flex justify-end'>
                {toggles}
              </div>
              {strip}
              {sections ? sections.map((section) => (
                <details className='border-t border-[#6b3a1f]/30' key={section.group}>
                  <summary className='cursor-pointer py-2 font-serif text-sm uppercase tracking-wide text-[#6b1d14]'>
                    {groupLabel(section.group)} ({section.rows.length})
                  </summary>
                  {table(section.rows)}
                </details>
              )) : (
                table(linked)
              )}
            </article>
          </div>
        </main>
        {foundryDialog}
      </div>
    );
  }

  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <LauncherHeader />
        <section className='px-8 pt-10 pb-16'>
          <div className='mx-auto grid max-w-6xl gap-6'>
            <div className='flex flex-wrap items-end justify-between gap-4'>
              <div>
                {folder ? (
                  <a className='text-sm underline underline-offset-2' href={`/shops/folder/${encodeURIComponent(folder.id)}`}>
                    {folder.name}
                  </a>
                ) : null}
                <h1 className='font-heading text-4xl text-foreground'>{name}</h1>
              </div>
              {toggles}
            </div>
            {description ? <ShopDescription text={description} homebrew={false} /> : null}
            {strip}
            {sections ? (
              <div className='overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/20'>
                {sections.map((section) => (
                  <details className='group border-t border-white/10 first:border-t-0' key={section.group}>
                    <summary className='cursor-pointer list-none px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden'>
                      <span className='mr-2 inline-block w-3 transition-transform group-open:rotate-90' aria-hidden>▸</span>
                      {groupLabel(section.group)}
                      <span className='ml-2 normal-case tracking-normal'>{section.rows.length}</span>
                    </summary>
                    {table(section.rows)}
                  </details>
                ))}
              </div>
            ) : (
              <div className='overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/20'>
                {table(linked)}
              </div>
            )}
          </div>
        </section>
      </main>
      {foundryDialog}
    </div>
  );
}

function ShopCartStrip({
  homebrew,
  cart,
  onRemove,
  onClear,
}: {
  homebrew: boolean;
  cart: ShopCartLine[];
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  if (cart.length === 0) {
    return <p className={homebrew ? 'brew-note' : 'text-sm text-muted-foreground'}>Cart is empty. Total 0 gp.</p>;
  }
  if (homebrew) {
    return (
      <div className='mb-4'>
        <div className='mb-2 flex flex-wrap items-baseline justify-between gap-2'>
          <p className='font-serif text-sm uppercase tracking-wide text-[#6b1d14]'>Cart · {cartTotalGp(cart)}</p>
          <button type='button' onClick={onClear}>Clear cart</button>
        </div>
        <table className='brew-cart'>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cart.map((line) => (
              <tr key={line.key}>
                <td>{line.shopName} — {line.name}</td>
                <td>{line.qty}</td>
                <td>{lineGold(line)}</td>
                <td>
                  <button type='button' onClick={() => onRemove(line.key)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className='rounded-xl bg-white/5 p-4 ring-1 ring-white/20'>
      <div className='mb-3 flex flex-wrap items-baseline justify-between gap-2'>
        <p className='text-sm font-medium text-foreground'>Cart · {cartTotalGp(cart)}</p>
        <button className='underline underline-offset-2' type='button' onClick={onClear}>Clear cart</button>
      </div>
      <table className='w-full text-left text-sm'>
        <thead className='text-muted-foreground'>
          <tr>
            <th className='pb-2 font-medium'>Item</th>
            <th className='w-16 pb-2 text-right font-medium tabular-nums'>Qty</th>
            <th className='w-24 pb-2 text-right font-medium tabular-nums'>Price</th>
            <th className='w-20 pb-2' />
          </tr>
        </thead>
        <tbody className='text-muted-foreground'>
          {cart.map((line) => (
            <tr className='border-t border-white/10' key={line.key}>
              <td className='py-2 pr-3 text-foreground'>{line.shopName} — {line.name}</td>
              <td className='py-2 text-right tabular-nums'>{line.qty}</td>
              <td className='py-2 text-right tabular-nums'>{lineGold(line)}</td>
              <td className='py-2 text-right'>
                <button className='underline underline-offset-2' type='button' onClick={() => onRemove(line.key)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockTable({
  stock,
  homebrew = false,
  inGp = false,
  shopId,
  cart,
  onAdd,
  onRemove,
}: {
  stock: ShopStockRow[];
  homebrew?: boolean;
  inGp?: boolean;
  shopId: string;
  cart: ShopCartLine[];
  onAdd: (row: ShopStockRow) => void;
  onRemove: (key: string) => void;
}) {
  const qty = (row: ShopStockRow) => cart.find((line) => line.key === cartLineKey(shopId, row))?.qty ?? 0;
  if (homebrew) {
    return (
      <table>
        <thead>
          <tr>
            <th>Qty</th>
            <th>Name</th>
            <th>Level</th>
            <th>Rarity</th>
            <th>Group</th>
            <th>Price</th>
            <th>Cart</th>
          </tr>
        </thead>
        <tbody>
          {stock.map((row) => (
            <tr key={`${row.id}:${row.name}`}>
              <td>{row.quantity ?? 1} ×</td>
              <td><StockName row={row} homebrew inGp={inGp} /></td>
              <td>{row.level}</td>
              <td>{row.rarity}</td>
              <td>{row.group}</td>
              <td>{shownPrice(row.price, inGp)}</td>
              <td>
                <CartButtons row={row} inCart={qty(row)} onAdd={onAdd} onRemove={() => onRemove(cartLineKey(shopId, row))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table className='w-full text-left text-sm'>
      <thead className='text-muted-foreground'>
        <tr>
          <th className='px-4 py-3 font-medium'>Qty</th>
          <th className='px-4 py-3 font-medium'>Name</th>
          <th className='px-4 py-3 font-medium'>Level</th>
          <th className='px-4 py-3 font-medium'>Rarity</th>
          <th className='px-4 py-3 font-medium'>Group</th>
          <th className='px-4 py-3 font-medium'>Price</th>
          <th className='px-4 py-3 font-medium'>Cart</th>
        </tr>
      </thead>
      <tbody>
        {stock.map((row) => (
          <tr className='border-t border-white/10' key={`${row.id}:${row.name}`}>
            <td className='px-4 py-3'>{row.quantity ?? 1} ×</td>
            <td className='px-4 py-3'><StockName row={row} inGp={inGp} /></td>
            <td className='px-4 py-3'>{row.level}</td>
            <td className='px-4 py-3'>{row.rarity}</td>
            <td className='px-4 py-3'>{row.group}</td>
            <td className='px-4 py-3'>{shownPrice(row.price, inGp)}</td>
            <td className='px-4 py-3'>
              <CartButtons row={row} inCart={qty(row)} onAdd={onAdd} onRemove={() => onRemove(cartLineKey(shopId, row))} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CartButtons({
  row,
  inCart,
  onAdd,
  onRemove,
}: {
  row: ShopStockRow;
  inCart: number;
  onAdd: (row: ShopStockRow) => void;
  onRemove: () => void;
}) {
  const priced = itemCopper(row.price) > 0;
  if (!priced) return <span>—</span>;
  return (
    <span className='inline-flex items-center gap-2 whitespace-nowrap'>
      <button className='underline underline-offset-2' type='button' onClick={() => onAdd(row)}>Add</button>
      <button className='underline underline-offset-2 disabled:opacity-40' type='button' disabled={inCart < 1} onClick={onRemove}>Remove</button>
      {inCart > 0 ? <span>{inCart}</span> : null}
    </span>
  );
}

function levelSpan(stock: ShopStockRow[]) {
  if (stock.length === 0) return '—';
  const levels = stock.map((row) => row.level);
  const low = Math.min(...levels);
  const high = Math.max(...levels);
  return low === high ? String(low) : `${low}–${high}`;
}

function folderUsesHomebrew(shops: Array<SyndicatedNode<ShopDraft>>) {
  const brew = shops.filter((shop) => (shop.draft?.style ?? 'default') === 'homebrew-v3').length;
  return brew > 0 && brew >= shops.length - brew;
}

export function ShopFolderDirectory({ id }: { id: string }) {
  const [page, setPage] = useState<{ name: string; shops: Array<SyndicatedNode<ShopDraft>> } | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const done = shopTraceStart('folder directory');
    void listOwned(SHOP_CONTENT_KIND)
      .then((rows) => {
        const folder = rows.find((row) => row.id === id && row.kind === 'folder');
        const shops = (rows as Array<SyndicatedNode<ShopDraft>>)
          .filter((row) => row.kind === 'entry' && row.parent_id === id)
          .sort((left, right) => left.name.localeCompare(right.name));
        done({ id, found: Boolean(folder), shops: shops.length });
        if (!cancelled) setPage(folder ? { name: folder.name, shops } : null);
      })
      .catch((cause: unknown) => {
        console.error('[wgui shops] folder directory failed', cause);
        done({ id, failed: true });
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not open this folder.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (error) return <p className='p-8 text-sm text-red-300'>{error}</p>;
  if (page === undefined) return <p className='p-8 text-sm text-muted-foreground'>Loading folder…</p>;
  if (page === null) return <p className='p-8 text-sm text-muted-foreground'>This folder is not available.</p>;
  const homebrew = folderUsesHomebrew(page.shops);
  const rows = page.shops.map((shop) => ({
    id: shop.id,
    name: shop.name,
    items: shop.draft?.stock.length ?? 0,
    levels: levelSpan(shop.draft?.stock ?? []),
  }));
  const table = (
    <table className={homebrew ? undefined : 'w-full text-left text-sm'}>
      <thead className={homebrew ? undefined : 'text-muted-foreground'}>
        <tr>
          <th className={homebrew ? undefined : 'px-4 py-3 font-medium'}>Shop</th>
          <th className={homebrew ? undefined : 'px-4 py-3 font-medium'}>Items</th>
          <th className={homebrew ? undefined : 'px-4 py-3 font-medium'}>Levels</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className={homebrew ? undefined : 'px-4 py-3 text-muted-foreground'} colSpan={3}>This folder is empty.</td>
          </tr>
        ) : rows.map((row) => (
          <tr className={homebrew ? undefined : 'border-t border-white/10'} key={row.id}>
            <td className={homebrew ? undefined : 'px-4 py-3'}>
              <a className='underline underline-offset-2' href={`/shops/view/${encodeURIComponent(row.id)}`}>
                {row.name}
              </a>
            </td>
            <td className={homebrew ? undefined : 'px-4 py-3'}>{row.items}</td>
            <td className={homebrew ? undefined : 'px-4 py-3'}>{row.levels}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const note = `${rows.length} shop${rows.length === 1 ? '' : 's'}. This page follows the folder.`;

  if (homebrew) {
    return (
      <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
        <div className='bg-pattern' />
        <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
          <LauncherHeader />
          <style>{HOMEBREW_CSS}</style>
          <div className='brew-v3'>
            <article className='brew-sheet'>
              <header className='brew-masthead'>
                <hr className='brew-rule-double' />
                <h1>{page.name}</h1>
                <hr className='brew-rule-thin' />
              </header>
              <p className='brew-note'>{note}</p>
              <div className='brew-dir'>{table}</div>
            </article>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <LauncherHeader />
        <section className='px-8 pt-10 pb-16'>
          <div className='mx-auto grid max-w-6xl gap-6'>
            <div>
              <h1 className='font-heading text-4xl text-foreground'>{page.name}</h1>
              <p className='mt-3 text-sm text-muted-foreground'>{note}</p>
            </div>
            <div className='overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/20'>{table}</div>
          </div>
        </section>
      </main>
    </div>
  );
}

export function ShopsPublic({ token }: { token: string }) {
  const [page, setPage] = useState<Awaited<ReturnType<typeof readPublic<ShopDraft>>> | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const done = shopTraceStart('public shop');
    void readPublic<ShopDraft>(SHOP_CONTENT_KIND, token)
      .then((result) => {
        done({ found: Boolean(result) });
        if (!cancelled) setPage(result);
      })
      .catch((cause: unknown) => {
        console.error('[wgui shops] public shop failed', cause);
        done({ failed: true });
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this shop.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const stock = page?.snapshot.stock ?? [];
  const homebrew = page?.snapshot.style === 'homebrew-v3';

  if (page) return <ShopDocument cartKey={token} name={page.name} stock={stock} homebrew={homebrew} description={page.snapshot.description} />;

  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <LauncherHeader />
        <section className='px-8 pt-10 pb-16'>
          <div className='mx-auto grid max-w-6xl gap-6'>
            {error ? (
              <p className='text-sm text-red-300'>{error}</p>
            ) : page === undefined ? (
              <p className='text-sm text-muted-foreground'>Loading shop…</p>
            ) : (
              <p className='text-sm text-muted-foreground'>This shop is not available.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
