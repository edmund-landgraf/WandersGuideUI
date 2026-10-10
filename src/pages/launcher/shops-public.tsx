import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readPublic } from '../../syndication/store';
import { LauncherHeader } from './launcher-header';
import { SHOP_CONTENT_KIND, type ShopDraft, type ShopStockRow } from './shops-syndicate';

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
  const anchor = useRef<HTMLButtonElement>(null);
  const showTimer = useRef(0);
  const hideTimer = useRef(0);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
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
        {row.name}
      </button>
      {box && createPortal(
        <div
          className={homebrew
            ? 'w-[360px] max-h-[min(50vh,420px)] overflow-y-auto bg-[#f7edd4] p-4 text-left text-[#1c140c] shadow-2xl ring-1 ring-[#8a5a22]'
            : 'w-[360px] max-h-[min(50vh,420px)] overflow-y-auto rounded-xl bg-[#1c1c1c] p-4 text-left text-[#fafafa] shadow-2xl ring-1 ring-white/25'}
          style={{ position: 'fixed', zIndex: 40, left: box.left, top: box.top, bottom: box.bottom }}
          onMouseEnter={clearTimers}
          onMouseLeave={() => {
            clearTimers();
            hideTimer.current = window.setTimeout(() => setBox(null), 120);
          }}
        >
          <p className={homebrew ? 'font-serif text-lg text-[#6b1d14]' : 'font-heading text-base text-[#fafafa]'}>{row.name}</p>
          <p className={homebrew ? 'mt-1 text-[11px] uppercase tracking-wide text-[#5c4630]' : 'mt-1 text-[11px] uppercase tracking-wide text-[#b5b5b5]'}>
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
            <p className={homebrew ? 'mt-3 whitespace-pre-wrap text-sm leading-6 text-[#1c140c]' : 'mt-3 whitespace-pre-wrap text-sm leading-6 text-[#f4f4f5]'}>
              {row.description}
            </p>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

export function ShopDocument({ name, stock, homebrew, description }: { name: string; stock: ShopStockRow[]; homebrew: boolean; description?: string }) {
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
            <h1 className='font-heading text-4xl text-foreground'>{name}</h1>
            {description ? <p className='max-w-3xl text-sm leading-6 text-muted-foreground'>{description}</p> : null}
            <div className='overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/20'>
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
            </div>
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
