import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getContentDataFromHref } from '@common/rich_text_input/ContentLinkExtension';
import { fetchContentById } from '@content/content-store';
import { getConditionByName } from '@conditions/condition-handler';
import { compileWgText } from '@pages/phase1/phase1-markdown';
import { normalizeMarkdownTables, resolveAonHref, toStandard2eProse } from '@utils/foundry-text';
import { ShopPopout } from './shop-popout';
import { readPublic } from '../../syndication/store';
import { LauncherHeader } from './launcher-header';
import { asContentType } from './shops-export';
import { SHOP_CONTENT_KIND, type ShopDraft, type ShopStockRow } from './shops-syndicate';

export function prepareShopProse(text: string) {
  return normalizeMarkdownTables(toStandard2eProse(compileWgText(text)));
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
  font-size: 3rem;
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
.brew-v3 th:nth-child(2), .brew-v3 td:nth-child(2) { width: auto; }
.brew-v3 th:nth-child(n+3), .brew-v3 td:nth-child(n+3) { width: 6.2rem; white-space: nowrap; }
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
.brew-sheet .text-foreground,
.brew-sheet .text-muted-foreground,
.brew-sheet button,
.brew-sheet label,
.brew-sheet input,
.brew-sheet td { color: #3b2414; }
.brew-sheet .border-white\\/10,
.brew-sheet .border-b { border-color: rgba(107, 58, 31, 0.28); }
`;

function StockName({ row, homebrew = false }: { row: ShopStockRow; homebrew?: boolean }) {
  return (
    <ShopPopout
      label={row.name}
      href={row.name.trim() ? `https://2e.aonprd.com/Search.aspx?q=${encodeURIComponent(row.name.trim())}` : undefined}
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
        {row.price}
        {row.bulk ? ` · Bulk ${row.bulk}` : ''}
      </p>
      {row.description && (
        <ShopProse
          text={row.description}
          homebrew={homebrew}
          className={homebrew ? 'mt-3 text-sm leading-6 text-[#1c140c]' : 'mt-3 text-sm leading-6 text-[#f4f4f5]'}
        />
      )}
    </ShopPopout>
  );
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

export function readGroupingsPreference(): boolean {
  try {
    return sessionStorage.getItem(GROUPINGS_SESSION_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeGroupingsPreference(value: boolean) {
  try {
    sessionStorage.setItem(GROUPINGS_SESSION_KEY, value ? '1' : '0');
  } catch {
    // Private mode can block storage; the in-memory checkbox still works.
  }
}

function GroupingsToggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className='flex items-center gap-2 text-sm'>
      <input type='checkbox' checked={checked} onChange={(event) => onChange(event.target.checked)} />
      Use groupings
    </label>
  );
}

export function ShopDocument({ name, stock, homebrew, description }: { name: string; stock: ShopStockRow[]; homebrew: boolean; description?: string }) {
  const [useGroupings, setUseGroupings] = useState(readGroupingsPreference);
  const sections = useGroupings ? groupedStock(stock) : null;

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
                <h1>{name}</h1>
                <hr className='brew-rule-thin' />
              </header>
              {description ? <p className='brew-note'>{description}</p> : null}
              <div className='mb-4 flex justify-end'>
                <GroupingsToggle checked={useGroupings} onChange={(value) => {
                  writeGroupingsPreference(value);
                  setUseGroupings(value);
                }} />
              </div>
              {sections ? sections.map((section) => (
                <details className='border-t border-[#6b3a1f]/30' key={section.group}>
                  <summary className='cursor-pointer py-2 font-serif text-sm uppercase tracking-wide text-[#6b1d14]'>
                    {groupLabel(section.group)} ({section.rows.length})
                  </summary>
                  <StockTable stock={section.rows} homebrew />
                </details>
              )) : (
                <StockTable stock={stock} homebrew />
              )}
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
            <div className='flex flex-wrap items-end justify-between gap-4'>
              <h1 className='font-heading text-4xl text-foreground'>{name}</h1>
              <GroupingsToggle checked={useGroupings} onChange={(value) => {
                writeGroupingsPreference(value);
                setUseGroupings(value);
              }} />
            </div>
            {description ? <p className='max-w-3xl text-sm leading-6 text-muted-foreground'>{description}</p> : null}
            {sections ? (
              <div className='overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/20'>
                {sections.map((section) => (
                  <details className='group border-t border-white/10 first:border-t-0' key={section.group}>
                    <summary className='cursor-pointer list-none px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden'>
                      <span className='mr-2 inline-block w-3 transition-transform group-open:rotate-90' aria-hidden>▸</span>
                      {groupLabel(section.group)}
                      <span className='ml-2 normal-case tracking-normal'>{section.rows.length}</span>
                    </summary>
                    <StockTable stock={section.rows} />
                  </details>
                ))}
              </div>
            ) : (
              <div className='overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/20'>
                <StockTable stock={stock} />
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function StockTable({ stock, homebrew = false }: { stock: ShopStockRow[]; homebrew?: boolean }) {
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
          </tr>
        </thead>
        <tbody>
          {stock.map((row) => (
            <tr key={row.id}>
              <td>{row.quantity ?? 1} ×</td>
              <td><StockName row={row} homebrew /></td>
              <td>{row.level}</td>
              <td>{row.rarity}</td>
              <td>{row.group}</td>
              <td>{row.price}</td>
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
        </tr>
      </thead>
      <tbody>
        {stock.map((row) => (
          <tr className='border-t border-white/10' key={row.id}>
            <td className='px-4 py-3'>{row.quantity ?? 1} ×</td>
            <td className='px-4 py-3'><StockName row={row} /></td>
            <td className='px-4 py-3'>{row.level}</td>
            <td className='px-4 py-3'>{row.rarity}</td>
            <td className='px-4 py-3'>{row.group}</td>
            <td className='px-4 py-3'>{row.price}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ShopsPublic({ token }: { token: string }) {
  const [page, setPage] = useState<Awaited<ReturnType<typeof readPublic<ShopDraft>>> | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void readPublic<ShopDraft>(SHOP_CONTENT_KIND, token)
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this shop.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const stock = page?.snapshot.stock ?? [];
  const homebrew = page?.snapshot.style === 'homebrew-v3';

  if (page) return <ShopDocument name={page.name} stock={stock} homebrew={homebrew} description={page.snapshot.description} />;

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
