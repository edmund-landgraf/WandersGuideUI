import { ENABLED_OAUTH_PROVIDERS, signInWithOAuthProvider } from '@auth/campaign-auth';
import { fetchContentAll, fetchContentSources } from '@content/content-store';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Item, Trait } from '@schemas/content';
import { supabase } from '../../supabase-client';
import { LauncherHeader } from './launcher-header';
import { formatShopPrice, SHOP_PRESETS, stockShop, type ShopPresetId } from './shops-generate';
import './launcher.css';

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

function ShopsPage() {
  const [preset, setPreset] = useState<ShopPresetId>('general');
  const [level, setLevel] = useState(3);
  const [items, setItems] = useState<Item[]>([]);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [stock, setStock] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const signedIn = await readySession();
        if (!signedIn) {
          if (!cancelled) setNeedsSignIn(true);
          return;
        }
        const sources = await fetchContentSources('ALL-OFFICIAL-PUBLIC');
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

  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <LauncherHeader />
        <section className='px-8 pt-10 pb-16'>
          <div className='mx-auto grid max-w-6xl gap-6'>
            <div>
              <h1 className='font-heading text-4xl text-foreground'>Shops</h1>
              <p className='mt-3 max-w-xl text-sm leading-6 text-muted-foreground'>
                Pick a counter and a settlement level. The stock is drawn from official items near that level, with
                common goods first.
              </p>
            </div>
            <form
              className='flex flex-wrap items-end gap-4 rounded-xl bg-white/5 p-6 ring-1 ring-white/20'
              onSubmit={(event) => {
                event.preventDefault();
                setStock(stockShop(items, traits, preset, level));
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
                <input
                  className='w-24 rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
                  type='number'
                  min={0}
                  max={20}
                  value={level}
                  onChange={(event) => setLevel(Math.min(20, Math.max(0, Number(event.target.value) || 0)))}
                />
              </label>
              <button
                className='rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50'
                type='submit'
                disabled={loading || needsSignIn || Boolean(error)}
              >
                Generate
              </button>
            </form>
            <div className='overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/20'>
              {loading ? (
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
              ) : stock.length === 0 ? (
                <p className='p-6 text-sm text-muted-foreground'>Nothing in this preset matches the catalog.</p>
              ) : (
                <table className='w-full text-left text-sm'>
                  <thead className='text-muted-foreground'>
                    <tr>
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
                        <td className='px-4 py-3'>{row.name}</td>
                        <td className='px-4 py-3'>{row.level}</td>
                        <td className='px-4 py-3'>{row.rarity}</td>
                        <td className='px-4 py-3'>{row.group}</td>
                        <td className='px-4 py-3'>{formatShopPrice(row.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

const root = document.getElementById('root') as HTMLElement;
root.removeAttribute('style');

createRoot(root).render(
  <StrictMode>
    <ShopsPage />
  </StrictMode>
);
