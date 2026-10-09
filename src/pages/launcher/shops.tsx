import { ENABLED_OAUTH_PROVIDERS, signInWithOAuthProvider } from '@auth/campaign-auth';
import { fetchContentAll, fetchContentById, fetchContentSources } from '@content/content-store';
import { StrictMode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { ContentSource, Item, Trait } from '@schemas/content';
import { supabase } from '../../supabase-client';
import { LauncherHeader } from './launcher-header';
import { compileWgText } from '@pages/phase1/phase1-markdown';
import { toStandard2eProse } from '@utils/foundry-text';
import {
  asShopLine,
  formatShopOffer,
  isShopFormula,
  activeShopRarities,
  DEFAULT_SHOP_BOOKS,
  listShopPool,
  SETTLEMENT_LEVELS,
  shopCeiling,
  shopLineQuantity,
  SHOP_PRESETS,
  SHOP_RARITIES,
  STOCK_COUNT,
  stockShop,
  WIDE_CATALOG_PRESETS,
  type SettlementId,
  type ShopPresetId,
  type ShopRarity,
  type ShopStockItem,
} from './shops-generate';
import { collectShopCards, shopExportHtml } from './shops-export';
import { ShopsLibrary } from './shops-library';
import { HOMEBREW_CSS, ShopDocument, ShopsPublic } from './shops-public';
import { SHOP_CONTENT_KIND, shopDraft, type ShopDraft, type ShopPageStyle } from './shops-syndicate';
import { insertNode, listOwned } from '../../syndication/store';
import './launcher.css';

const BOOK_GROUPS = [
  { key: 'pathfinder-core', label: 'Pathfinder Core' },
  { key: 'starfinder-core', label: 'Starfinder Core' },
  { key: 'adventure-path', label: 'Adventure Paths' },
  { key: 'standalone-adventure', label: 'Standalone Adventures' },
  { key: 'lost-omens', label: 'Lost Omens' },
  { key: 'legacy', label: 'Core Backports' },
  { key: 'playtest', label: 'Playtest' },
  { key: 'misc', label: 'Miscellaneous' },
] as const;

async function readySession() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return false;
  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt < Date.now() + 60_000) {
    const refreshed = await supabase.auth.refreshSession();
    return Boolean(refreshed.data.session);
  }
  return true;
}

function itemCardText(value: string) {
  return toStandard2eProse(compileWgText(value))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>]/g, '')
    .trim();
}

function ShopItemName({ item, traits, markup }: { item: Item; traits: Trait[]; markup: number }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const showTimer = useRef(0);
  const hideTimer = useRef(0);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const traitNames = (item.traits ?? [])
    .map((id) => traits.find((trait) => trait.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const description = itemCardText(item.description);

  const clearTimers = () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  };
  const open = () => {
    const node = anchor.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const width = 360;
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    const above = window.innerHeight - rect.bottom < 220;
    setBox(above
      ? { left: Math.max(12, left), bottom: window.innerHeight - rect.top + 6 }
      : { left: Math.max(12, left), top: rect.bottom + 6 });
  };
  useEffect(() => () => clearTimers(), []);

  return (
    <>
      <button
        ref={anchor}
        type='button'
        className='text-left underline decoration-white/25 underline-offset-2 hover:decoration-white/70'
        onMouseEnter={() => {
          clearTimers();
          showTimer.current = window.setTimeout(open, 250);
        }}
        onMouseLeave={() => {
          clearTimers();
          hideTimer.current = window.setTimeout(() => setBox(null), 120);
        }}
        onFocus={open}
        onBlur={() => setBox(null)}
      >
        {item.name}
      </button>
      {box && createPortal(
        <div
          className='w-[360px] max-h-[min(50vh,420px)] overflow-y-auto rounded-xl bg-[#1c1c1c] p-4 text-left text-[#fafafa] shadow-2xl ring-1 ring-white/25'
          style={{ position: 'fixed', zIndex: 40, left: box.left, top: box.top, bottom: box.bottom }}
          onMouseEnter={clearTimers}
          onMouseLeave={() => {
            clearTimers();
            hideTimer.current = window.setTimeout(() => setBox(null), 120);
          }}
        >
          <p className='font-heading text-base text-[#fafafa]'>{item.name}</p>
          <p className='mt-1 text-[11px] uppercase tracking-wide text-[#b5b5b5]'>
            Level {item.level} · {item.rarity} · {isShopFormula(item) ? 'FORMULA' : (item.group ?? '').replaceAll('_', ' ')}
          </p>
          {traitNames.length > 0 && (
            <div className='mt-2 flex flex-wrap gap-1'>
              {traitNames.map((name) => (
                <span key={name} className='rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-[#d4d4d4]'>
                  {name}
                </span>
              ))}
            </div>
          )}
          <p className='mt-3 text-xs text-[#b5b5b5]'>
            {formatShopOffer(asShopLine(item), markup)}
            {item.bulk ? ` · Bulk ${item.bulk}` : ''}
          </p>
          {description && <p className='mt-3 whitespace-pre-wrap text-sm leading-6 text-[#f4f4f5]'>{description}</p>}
        </div>,
        document.body
      )}
    </>
  );
}

function ShopAddItem({
  items,
  enabledBooks,
  stockIds,
  markup,
  onAdd,
}: {
  items: Item[];
  enabledBooks: number[];
  stockIds: Set<number>;
  markup: number;
  onAdd: (item: Item) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const books = useMemo(() => new Set(enabledBooks), [enabledBooks]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const found: Item[] = [];
    for (const item of items) {
      if (!item.name.toLowerCase().includes(needle)) continue;
      if (books.size > 0 && !books.has(item.content_source_id)) continue;
      found.push(item);
      if (found.length === 8) break;
    }
    return found;
  }, [books, items, query]);

  const choose = (item: Item) => {
    if (stockIds.has(item.id)) return;
    onAdd(item);
    setQuery('');
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className='relative grid gap-2 p-4'>
      <label className='grid gap-2 text-sm text-muted-foreground' htmlFor={`${listId}-input`}>
        Add an item
        <input
          ref={inputRef}
          id={`${listId}-input`}
          className='rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
          role='combobox'
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete='list'
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
          placeholder='Search by name'
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && open && matches[active]) {
              event.preventDefault();
              choose(matches[active]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </label>
      <p className='text-xs text-muted-foreground'>
        {books.size > 0 ? 'From checked books.' : 'From the loaded catalog.'}
      </p>
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role='listbox'
          className='absolute top-full z-20 mt-1 max-h-72 w-[min(100%,28rem)] overflow-y-auto rounded-lg bg-[#1c1c1c] py-1 shadow-2xl ring-1 ring-white/25'
        >
          {matches.map((item, index) => {
            const stocked = stockIds.has(item.id);
            return (
              <li
                id={`${listId}-${item.id}`}
                key={item.id}
                role='option'
                aria-selected={index === active}
                aria-disabled={stocked}
                className={`flex items-baseline justify-between gap-3 px-3 py-2 text-sm ${index === active ? 'bg-white/10' : ''} ${stocked ? 'text-muted-foreground' : 'cursor-pointer text-foreground'}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
              >
                <span>
                  {item.name}
                  <span className='ml-2 text-xs text-muted-foreground'>
                    {item.level} · {item.rarity} · {formatShopOffer(asShopLine(item), markup)}
                  </span>
                </span>
                {stocked && <span className='shrink-0 text-xs'>In stock</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ShopsPage() {
  const [preset, setPreset] = useState<ShopPresetId>('general');
  const [settlement, setSettlement] = useState<SettlementId>('village');
  const [rarities, setRarities] = useState<ShopRarity[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [books, setBooks] = useState<ContentSource[]>([]);
  const [enabledBooks, setEnabledBooks] = useState<number[]>([]);
  const [panel, setPanel] = useState<'stock' | 'books'>('stock');
  const [stock, setStock] = useState<ShopStockItem[] | null>(null);
  const lastStockIds = useRef<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const [stockCount, setStockCount] = useState(STOCK_COUNT);
  const [markup, setMarkup] = useState(0);
  const [pageStyle, setPageStyle] = useState<ShopPageStyle>('default');
  const [shopName, setShopName] = useState('');
  const [shopDescription, setShopDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [edited, setEdited] = useState(false);
  const [removed, setRemoved] = useState<{ item: Item; index: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const signedIn = await readySession();
        if (!signedIn) {
          if (!cancelled) setNeedsSignIn(true);
          return;
        }
        const sources = (await fetchContentSources('ALL-OFFICIAL-PUBLIC')).filter((book) => book.deprecated !== true);
        const sourceIds = sources.map((source) => source.id);
        const [itemList, traitList] = await Promise.all([
          fetchContentAll<Item>('item', sourceIds),
          fetchContentAll<Trait>('trait', sourceIds),
        ]);
        if (cancelled) return;
        if (itemList.length === 0) {
          setError('The item catalog came back empty.');
          return;
        }
        setItems(itemList);
        setTraits(traitList);
        setBooks(sources);
        const preferred = new Set(DEFAULT_SHOP_BOOKS.map((name) => name.toLowerCase()));
        const defaults = sources.filter((book) => preferred.has(book.name.toLowerCase())).map((book) => book.id);
        setEnabledBooks(defaults.length > 0 ? defaults : sourceIds);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load items.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (!id || loading || items.length === 0) return;
    let cancelled = false;
    (async () => {
      const rows = await listOwned(SHOP_CONTENT_KIND);
      const node = rows.find((row) => row.id === id && row.kind === 'entry');
      const draft = node?.draft as ShopDraft | null | undefined;
      if (!draft || cancelled) return;
      const loaded = (await Promise.all(draft.stock.map(async (row) => {
        const found = items.find((item) => item.id === row.id);
        if (found) return found;
        return fetchContentById<Item>('item', row.id);
      }))).filter((item): item is Item => Boolean(item));
      if (cancelled) return;
      setPreset(draft.preset);
      setSettlement(SETTLEMENT_LEVELS.some((row) => row.id === draft.settlement) ? draft.settlement : 'village');
      setRarities([]);
      setMarkup(draft.markup ?? 0);
      setPageStyle(draft.style === 'homebrew-v3' ? 'homebrew-v3' : 'default');
      setStockCount(loaded.length || STOCK_COUNT);
      setShopName(node?.name ?? '');
      setShopDescription(draft.description ?? '');
      setStock(loaded.map((item) => asShopLine(item)));
      setEdited(false);
      setRemoved(null);
      lastStockIds.current = new Set(loaded.map((item) => item.id));
    })().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not open this shop.');
    });
    return () => {
      cancelled = true;
    };
  }, [loading, items]);

  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <LauncherHeader />
        <section className='px-8 pt-10 pb-16'>
          <div className='mx-auto grid max-w-6xl gap-6'>
            <div>
              <div className='flex flex-wrap items-end justify-between gap-4'>
              <h1 className='font-heading text-4xl text-foreground'>Shops</h1>
              <a className='text-sm text-muted-foreground underline' href='/shops/library'>Saved shops</a>
              </div>
              <p className='mt-3 max-w-xl text-sm leading-6 text-muted-foreground'>
                Pick a counter and a settlement. Stock runs from level 0 up to that settlement, split into low,
                mid, and high bands in a city or larger. Rarity follows a weighted mix (mostly common, some uncommon,
                a little rare) unless you check specific rarities. Each line has a quantity, and any shop can roll a
                formula. Generate again to reshuffle and lean away from the last counter.
              </p>
            </div>
            <form
              className='flex flex-wrap items-end gap-4 rounded-xl bg-white/5 p-6 ring-1 ring-white/20'
              onSubmit={(event) => {
                event.preventDefault();
                if (edited && !window.confirm('Replace the current counter? Added and removed items will be lost.')) return;
                const next = stockShop(
                  items,
                  traits,
                  preset,
                  shopCeiling(preset, settlement),
                  Math.random,
                  new Set(enabledBooks),
                  lastStockIds.current,
                  stockCount,
                  new Set(activeShopRarities(rarities, settlement)),
                );
                lastStockIds.current = new Set(next.map((row) => row.id));
                setStock(next);
                setEdited(false);
                setRemoved(null);
                setPanel('stock');
              }}
            >
              <label className='grid gap-2 text-sm text-muted-foreground'>
                Preset
                <select
                  className='rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
                  value={preset}
                  onChange={(event) => setPreset(event.target.value as ShopPresetId)}
                >
                  {SHOP_PRESETS.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className='grid gap-2 text-sm text-muted-foreground'>
                Settlement level
                <select
                  className='rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15 disabled:opacity-50'
                  value={settlement}
                  disabled={WIDE_CATALOG_PRESETS.has(preset)}
                  onChange={(event) => setSettlement(event.target.value as SettlementId)}
                >
                  {SETTLEMENT_LEVELS.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className='grid gap-2 text-sm text-muted-foreground'>
                <legend>Rarity</legend>
                <div className='flex flex-wrap gap-x-4 gap-y-1'>
                  {SHOP_RARITIES.map((rarity) => (
                    <label key={rarity} className='flex items-center gap-2 text-foreground'>
                      <input
                        type='checkbox'
                        checked={rarities.includes(rarity)}
                        onChange={(event) => {
                          setRarities((current) => (
                            event.target.checked
                              ? [...current, rarity]
                              : current.filter((row) => row !== rarity)
                          ));
                        }}
                      />
                      {rarity.charAt(0) + rarity.slice(1).toLowerCase()}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className='grid gap-2 text-sm text-muted-foreground'>
                Inventory size
                <input
                  className='w-24 rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
                  type='number'
                  min={1}
                  max={100}
                  value={stockCount}
                  onChange={(event) => setStockCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
                />
              </label>
              <label className='grid gap-2 text-sm text-muted-foreground'>
                Price markup
                <span className='flex items-center gap-2'>
                  <input
                    className='w-24 rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
                    type='number'
                    min={-100}
                    max={500}
                    step={5}
                    value={markup}
                    onChange={(event) => setMarkup(Math.max(-100, Math.min(500, Number(event.target.value) || 0)))}
                  />
                  <span>%</span>
                </span>
              </label>
              <label className='grid gap-2 text-sm text-muted-foreground'>
                Style
                <select
                  className='rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
                  value={pageStyle}
                  onChange={(event) => setPageStyle(event.target.value as ShopPageStyle)}
                >
                  <option value='default'>Default</option>
                  <option value='homebrew-v3'>Homebrew V3</option>
                </select>
              </label>
              <button
                className='rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50'
                type='submit'
                disabled={loading || needsSignIn || Boolean(error)}
              >
                Generate
              </button>
              <button
                className='rounded-lg bg-card px-4 py-2 text-sm text-foreground ring-1 ring-white/15 disabled:opacity-50'
                type='button'
                disabled={!stock || stock.length === 0 || exporting}
                onClick={() => {
                  if (!stock || stock.length === 0) return;
                  setExporting(true);
                  setExportNote('');
                  void (async () => {
                    try {
                      const { cards, capped } = await collectShopCards(stock, items, traits, (type, id) => (
                        fetchContentById<Record<string, unknown>>(type, id)
                      ), markup);
                      const presetLabel = SHOP_PRESETS.find((row) => row.id === preset)?.label ?? 'Shop';
                      const settlementLabel = SETTLEMENT_LEVELS.find((row) => row.id === settlement)?.label ?? settlement;
                      const title = `${presetLabel} — ${settlementLabel}`;
                      const html = shopExportHtml(title, stock, cards, markup);
                      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `shop-${preset}-${settlement}.html`;
                      link.click();
                      URL.revokeObjectURL(url);
                      setExportNote(capped ? 'Export stopped at 400 linked entries.' : '');
                    } catch (cause) {
                      setExportNote(cause instanceof Error ? cause.message : 'Could not export this shop.');
                    } finally {
                      setExporting(false);
                    }
                  })();
                }}
              >
                {exporting ? 'Exporting…' : 'Export'}
              </button>
              {exportNote && <p className='w-full text-sm text-muted-foreground'>{exportNote}</p>}
              {stock && stock.length > 0 && (
                <div className='flex basis-full flex-wrap items-end gap-3'>
                  <label className='grid gap-2 text-sm text-muted-foreground'>
                    Shop name
                    <input
                      className='rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
                      value={shopName}
                      onChange={(event) => setShopName(event.target.value)}
                    />
                  </label>
                  <label className='grid min-w-[16rem] flex-1 gap-2 text-sm text-muted-foreground'>
                    Description
                    <textarea
                      className='min-h-[2.5rem] rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
                      rows={2}
                      value={shopDescription}
                      onChange={(event) => setShopDescription(event.target.value)}
                    />
                  </label>
                  <button
                    className='rounded-lg bg-card px-4 py-2 text-sm text-foreground ring-1 ring-white/15 disabled:opacity-50'
                    type='button'
                    disabled={saving || !shopName.trim()}
                    onClick={() => {
                      const name = shopName.trim();
                      if (!name || !stock) return;
                      setSaving(true);
                      setSaveNote('');
                      void insertNode({
                        content_kind: SHOP_CONTENT_KIND,
                        kind: 'entry',
                        name,
                        parent_id: null,
                        draft: shopDraft(preset, settlement, stock, traits, markup, pageStyle, shopDescription),
                      })
                        .then(() => setSaveNote('Saved. Open Saved shops to publish it.'))
                        .catch((cause: unknown) => {
                          setSaveNote(cause instanceof Error ? cause.message : 'Could not save this shop.');
                        })
                        .finally(() => setSaving(false));
                    }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  {saveNote && <p className='text-sm text-muted-foreground'>{saveNote}</p>}
                </div>
              )}
              {!loading && !needsSignIn && !error && items.length > 0 && (
                <p className='basis-full text-xs text-muted-foreground'>
                  {(() => {
                    const pool = listShopPool(items, traits, preset, shopCeiling(preset, settlement), new Set(enabledBooks), new Set(activeShopRarities(rarities, settlement))).length;
                    return `Drawing ${Math.min(stockCount, pool)} of ${pool} matching items.`;
                  })()}
                </p>
              )}
            </form>
            {pageStyle === 'homebrew-v3' && <style>{HOMEBREW_CSS}</style>}
            <div className={pageStyle === 'homebrew-v3' ? 'brew-sheet overflow-hidden' : 'overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/20'} role='tablist' aria-label='Shop panels'>
              <div className='flex gap-1 border-b border-white/10 px-3 pt-3'>
                <button
                  className={`rounded-t-lg px-4 py-2 text-sm ${panel === 'stock' ? 'bg-white/10 text-foreground' : 'text-muted-foreground'}`}
                  type='button'
                  role='tab'
                  aria-selected={panel === 'stock'}
                  onClick={() => setPanel('stock')}
                >
                  Stock
                </button>
                <button
                  className={`rounded-t-lg px-4 py-2 text-sm ${panel === 'books' ? 'bg-white/10 text-foreground' : 'text-muted-foreground'}`}
                  type='button'
                  role='tab'
                  aria-selected={panel === 'books'}
                  onClick={() => setPanel('books')}
                >
                  Books
                </button>
              </div>
              {panel === 'books' ? (
                <div className='grid gap-5 p-6' role='tabpanel'>
                  <div className='flex gap-3'>
                    <button
                      className='text-sm text-muted-foreground underline'
                      type='button'
                      onClick={() => setEnabledBooks(books.map((book) => book.id))}
                    >
                      Check all
                    </button>
                    <button
                      className='text-sm text-muted-foreground underline'
                      type='button'
                      onClick={() => setEnabledBooks([])}
                    >
                      Uncheck all
                    </button>
                  </div>
                  {BOOK_GROUPS.map((group) => {
                    const groupBooks = books
                      .filter((book) => book.group === group.key)
                      .sort((a, b) => a.name.localeCompare(b.name));
                    if (groupBooks.length === 0) return null;
                    const ids = groupBooks.map((book) => book.id);
                    const allOn = ids.every((id) => enabledBooks.includes(id));
                    return (
                      <fieldset className='grid gap-2' key={group.key}>
                        <legend className='flex items-center gap-3 text-sm text-foreground'>
                          {group.label}
                          <button
                            className='text-xs text-muted-foreground underline'
                            type='button'
                            onClick={() => {
                              setEnabledBooks((current) => (
                                allOn
                                  ? current.filter((id) => !ids.includes(id))
                                  : [...new Set([...current, ...ids])]
                              ));
                            }}
                          >
                            {allOn ? 'Clear' : 'All'}
                          </button>
                        </legend>
                        {groupBooks.map((book) => (
                          <label className='flex items-center gap-2 text-sm text-muted-foreground' key={book.id}>
                            <input
                              type='checkbox'
                              checked={enabledBooks.includes(book.id)}
                              onChange={(event) => {
                                setEnabledBooks((current) => (
                                  event.target.checked
                                    ? [...current, book.id]
                                    : current.filter((id) => id !== book.id)
                                ));
                              }}
                            />
                            {book.name}
                          </label>
                        ))}
                      </fieldset>
                    );
                  })}
                </div>
              ) : loading ? (
                <p className='p-6 text-sm text-muted-foreground'>Loading official items…</p>
              ) : needsSignIn ? (
                <div className='grid gap-3 p-6'>
                  <p className='text-sm text-muted-foreground'>Sign in to load the official item catalog.</p>
                  <div className='flex flex-wrap gap-2'>
                    {ENABLED_OAUTH_PROVIDERS.map((provider) => (
                      <button
                        className='rounded-lg bg-card px-3 py-2 text-sm capitalize text-foreground ring-1 ring-white/15 hover:bg-white/10'
                        key={provider}
                        type='button'
                        onClick={() => {
                          void signInWithOAuthProvider(provider);
                        }}
                      >
                        {provider}
                      </button>
                    ))}
                  </div>
                </div>
              ) : error ? (
                <p className='p-6 text-sm text-red-300'>{error}</p>
              ) : stock === null ? (
                <p className='p-6 text-sm text-muted-foreground'>Generate a shop to fill the counter.</p>
              ) : (
                <div role='tabpanel'>
                  <ShopAddItem
                    items={items}
                    enabledBooks={enabledBooks}
                    stockIds={new Set(stock.map((row) => row.id))}
                    markup={markup}
                    onAdd={(item) => {
                      setStock((current) => (current?.some((row) => row.shopKey === String(item.id)) ? current : [...(current ?? []), asShopLine(item)]));
                      setEdited(true);
                    }}
                  />
                  {stock.length === 0 ? (
                    <p className='px-6 pb-6 text-sm text-muted-foreground'>
                      {edited ? 'The counter is empty.' : 'Nothing in this preset matches the catalog.'}
                    </p>
                  ) : (
                    <table className='w-full text-left text-sm'>
                      <thead className='text-muted-foreground'>
                        <tr>
                          <th className='px-4 py-3 font-medium'>Qty</th>
                          <th className='px-4 py-3 font-medium'>Name</th>
                          <th className='px-4 py-3 font-medium'>Level</th>
                          <th className='px-4 py-3 font-medium'>Rarity</th>
                          <th className='px-4 py-3 font-medium'>Group</th>
                          <th className='px-4 py-3 font-medium'>Price</th>
                          <th className='px-4 py-3 font-medium'><span className='sr-only'>Remove</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {stock.map((row, index) => (
                          <tr className='border-t border-white/10' key={row.shopKey}>
                            <td className='px-4 py-3'>{shopLineQuantity(row)} ×</td>
                            <td className='px-4 py-3'>
                              <ShopItemName item={row} traits={traits} markup={markup} />
                            </td>
                            <td className='px-4 py-3'>{row.level}</td>
                            <td className='px-4 py-3'>{row.rarity}</td>
                            <td className='px-4 py-3'>{isShopFormula(row) ? 'FORMULA' : row.group}</td>
                            <td className='px-4 py-3'>{formatShopOffer(row, markup)}</td>
                            <td className='px-4 py-3 text-right'>
                              <button
                                className='text-sm text-muted-foreground underline'
                                type='button'
                                aria-label={`Remove ${row.name}`}
                                onClick={() => {
                                  setRemoved({ item: row, index });
                                  setStock((current) => current?.filter((item) => item.shopKey !== row.shopKey) ?? []);
                                  setEdited(true);
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {removed && (
                    <p className='px-4 py-3 text-sm text-muted-foreground'>
                      Removed {removed.item.name}.{' '}
                      <button
                        className='underline'
                        type='button'
                        onClick={() => {
                          const putBack = removed;
                          setStock((current) => {
                            const next = [...(current ?? [])];
                            const index = Math.min(putBack.index, next.length);
                            next.splice(index, 0, putBack.item);
                            return next;
                          });
                          setRemoved(null);
                        }}
                      >
                        Undo
                      </button>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ShopDraftView({ id }: { id: string }) {
  const [page, setPage] = useState<{ name: string; draft: ShopDraft } | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void listOwned(SHOP_CONTENT_KIND)
      .then((rows) => {
        if (cancelled) return;
        const node = rows.find((row) => row.id === id && row.kind === 'entry');
        const draft = node?.draft as ShopDraft | null | undefined;
        setPage(node && draft ? { name: node.name, draft } : null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not open this shop.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (error) return <p className='p-8 text-sm text-red-300'>{error}</p>;
  if (page === undefined) return <p className='p-8 text-sm text-muted-foreground'>Loading shop…</p>;
  if (page === null) return <p className='p-8 text-sm text-muted-foreground'>This shop is not available.</p>;
  return <ShopDocument name={page.name} stock={page.draft.stock} homebrew={page.draft.style === 'homebrew-v3'} description={page.draft.description} />;
}

function ShopsApp() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const published = path.match(/^\/shops\/s\/([^/]+)$/);
  const view = path.match(/^\/shops\/view\/([^/]+)$/);
  if (published) return <ShopsPublic token={decodeURIComponent(published[1])} />;
  if (view) return <ShopDraftView id={decodeURIComponent(view[1])} />;
  if (path === '/shops/library') return <ShopsLibrary />;
  return <ShopsPage />;
}

const root = document.getElementById('root') as HTMLElement;
root.removeAttribute('style');

createRoot(root).render(
  <StrictMode>
    <ShopsApp />
  </StrictMode>
);
