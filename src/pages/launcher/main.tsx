import { PATREON_URL } from '@constants/urls';
import { ArrowDownCircle, ArrowRight, ArrowUpCircle } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './launcher.css';

/** Edge functions. A worker that answers is up; 404 or no response is down. */
const WGUI_FUNCTIONS = [
  { name: 'wgui-ext-ensure-public-user', label: 'ensure-user', desc: 'backfill profile' },
  { name: 'wgui-ext-join-campaign', label: 'join', desc: 'attach by key' },
  { name: 'wgui-ext-find-encounter', label: 'encounter', desc: 'campaign fights' },
  { name: 'wgui-ext-find-campaign-characters', label: 'roster', desc: 'campaign pcs' },
  { name: 'wgui-ext-patch-encounter-dice', label: 'dice', desc: 'shared rolls' },
  { name: 'wgui-export-character', label: 'export', desc: 'character file' },
] as const;

type Probe = 'pending' | 'up' | 'down';

async function probeFunction(name: string): Promise<Probe> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  if (!base || !key) return 'down';
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: '{}',
    });
    if (response.status === 404) return 'down';
    const text = await response.text();
    if (/function not found|requested function was not found/i.test(text)) return 'down';
    return 'up';
  } catch {
    return 'down';
  }
}

function FunctionStatus() {
  const [status, setStatus] = useState<Record<string, Probe>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      WGUI_FUNCTIONS.map(async ({ name }) => {
        const probe = await probeFunction(name);
        if (!cancelled) setStatus((current) => ({ ...current, [name]: probe }));
      })
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className='w-full shrink-0 rounded-lg bg-black/40 p-2 ring-1 ring-white/15'
      style={{ fontFamily: '"Courier New", Courier, monospace' }}
    >
      <p className='px-0.5 pb-1.5 text-[10px] tracking-wide text-muted-foreground'>WGUI extended · supabase</p>
      <div className='grid grid-cols-[7.5rem_1fr_1.25rem] gap-x-2 gap-y-1'>
        {WGUI_FUNCTIONS.map(({ name, label, desc }) => {
          const probe = status[name] ?? 'pending';
          const up = probe === 'up';
          return (
            <div className='contents text-[11px] leading-4 text-foreground' key={name} title={name}>
              <span className='truncate'>{label}</span>
              <span className='truncate text-muted-foreground'>{desc}</span>
              <span className='flex justify-end' aria-label={probe === 'pending' ? 'checking' : up ? 'up' : 'down'}>
                {probe === 'pending' ? (
                  <span className='inline-block size-3.5 rounded-full bg-white/20' />
                ) : up ? (
                  <ArrowUpCircle className='size-3.5 text-emerald-400' />
                ) : (
                  <ArrowDownCircle className='size-3.5 text-red-400' />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Names from get-user `patreon.tier` (src/schemas/content.ts). No perk copy. */
const PATREON_TIERS = ['ADVOCATE', 'WANDERER', 'LEGEND', 'GAME-MASTER'] as const;

function Launcher() {
  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <header className='border-b border-border px-8 py-4'>
          <div className='mx-auto flex max-w-6xl items-center justify-between'>
            <a className='font-heading text-sm text-foreground' href='/'>
              Wanderer's Guide
            </a>
            <div className='flex items-center gap-5'>
              <a className='text-sm text-muted-foreground transition hover:text-foreground' href='/help/'>
                Help
              </a>
              <a
                className='text-sm text-muted-foreground transition hover:text-foreground'
                href={PATREON_URL}
                rel='noreferrer'
                target='_blank'
              >
                Support Quzzar on Patreon
              </a>
            </div>
          </div>
        </header>
        <section className='px-8 pt-10 pb-16'>
          <div className='mx-auto grid max-w-6xl content-start gap-8'>
          <div className='grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-8'>
            <h1 className='font-heading text-4xl leading-tight sm:text-5xl bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60 lg:col-start-1'>
              A faster table workspace
            </h1>
            <p className='max-w-xl text-base leading-7 text-muted-foreground lg:col-start-1'>
              Same characters, campaigns, and encounters — rebuilt so you can run the session without fighting the
              layout.
            </p>
            <a
              className='group flex max-w-xl items-center justify-between gap-6 rounded-xl bg-white/5 p-7 ring-1 ring-white/20 transition hover:bg-white/10 hover:ring-white/30 lg:col-start-1'
              href='/phase1'
            >
              <div>
                <p className='text-sm text-muted-foreground'>Launch app</p>
                <h2 className='font-heading mt-2 text-2xl text-foreground'>Open the updated workspace</h2>
                <p className='mt-3 text-sm leading-6 text-muted-foreground'>
                  Characters, campaigns, and combat in one place.
                </p>
              </div>
              <span className='inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
                <ArrowRight className='h-4 w-4 transition group-hover:translate-x-0.5' />
              </span>
            </a>
            <div className='lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:justify-self-end'>
              <FunctionStatus />
            </div>
          </div>
          <a
            className='block max-w-xl rounded-xl bg-white/5 p-6 ring-1 ring-white/20 transition hover:bg-white/10 hover:ring-white/30'
            href='/help/'
          >
            <p className='text-sm text-muted-foreground'>Help</p>
            <h2 className='font-heading mt-2 text-2xl text-foreground'>Characters, campaigns, and combat</h2>
            <p className='mt-3 text-sm leading-6 text-muted-foreground'>
              How to join a campaign, what players see in a fight, and how to run a check.
            </p>
          </a>
          <a
            className='block rounded-xl bg-white/5 p-6 ring-1 ring-white/20 transition hover:bg-white/10 hover:ring-white/30'
            href={PATREON_URL}
            rel='noreferrer'
            target='_blank'
          >
            <div className='flex flex-wrap items-end justify-between gap-3'>
              <div>
                <p className='text-sm text-foreground'>Quzzar’s Wanderer’s Guide</p>
                <p className='mt-2 max-w-2xl text-sm leading-6 text-muted-foreground'>
                  This campaign UI is built on Quzzar’s work. Supporting him on Patreon keeps the original project going
                  — we are not a replacement for that.
                </p>
              </div>
              <span className='text-sm text-muted-foreground'>Open Patreon →</span>
            </div>
            <div className='mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
              {PATREON_TIERS.map((tier) => (
                <div className='rounded-lg bg-card px-4 py-3 ring-1 ring-white/10' key={tier}>
                  <p className='text-xs text-muted-foreground'>API tier</p>
                  <p className='mt-1 text-sm leading-5 text-foreground'>{tier}</p>
                </div>
              ))}
            </div>
          </a>
          <a
            href='https://groupfinder.gg/library/wanderers-guide-extended'
            target='_blank'
            rel='noopener'
            style={{ display: 'inline-block' }}
          >
            <img
              src='https://groupfinder.gg/images/badges/gf-badge-red.svg'
              alt="Groupfinder library listing for Wanderer's Guide Extended"
              width={200}
              height={55}
              style={{ width: 200, height: 55, border: 0, display: 'block' }}
            />
          </a>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Launcher />
  </StrictMode>
);
