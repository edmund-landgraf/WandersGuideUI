import { PATREON_URL } from '@constants/urls';
import { ArrowRight } from 'lucide-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './launcher.css';

/** Names from get-user `patreon.tier` (src/schemas/content.ts). No perk copy. */
const PATREON_TIERS = ['ADVOCATE', 'WANDERER', 'LEGEND', 'GAME-MASTER'] as const;

function Launcher() {
  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <header className='border-b border-border px-6 py-4'>
          <div className='mx-auto flex max-w-6xl items-center justify-between'>
            <a className='font-heading text-sm text-foreground' href='/'>
              Wanderer's Guide
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
        </header>
        <section className='mx-auto grid min-h-[calc(100vh-65px)] max-w-6xl content-center gap-10 px-6 py-12'>
          <div className='max-w-2xl'>
            <p className='mb-3 text-sm text-muted-foreground'>Wanderer’s Guide</p>
            <h1 className='font-heading text-4xl leading-tight sm:text-5xl bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60'>
              A faster table workspace
            </h1>
            <p className='mt-4 max-w-xl text-base leading-7 text-muted-foreground'>
              Same characters, campaigns, and encounters — rebuilt so you can run the session without fighting the
              layout.
            </p>
          </div>
          <a
            className='group flex max-w-xl items-center justify-between gap-6 rounded-xl bg-white/5 p-7 ring-1 ring-white/20 transition hover:bg-white/10 hover:ring-white/30'
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
          <a
            className='block max-w-4xl rounded-xl bg-white/5 p-6 ring-1 ring-white/20 transition hover:bg-white/10 hover:ring-white/30'
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
