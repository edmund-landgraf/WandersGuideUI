import { PATREON_URL } from '@constants/urls';

export function LauncherHeader() {
  return (
    <header className='border-b border-border px-8 py-4'>
      <div className='mx-auto flex max-w-6xl items-center justify-between'>
        <a className='font-heading text-sm text-foreground' href='/'>
          Wanderer's Guide
        </a>
        <div className='flex items-center gap-5'>
          <details className='group relative'>
            <summary className='cursor-pointer list-none text-sm text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden'>
              Tools
            </summary>
            <div className='absolute right-0 z-20 mt-2 min-w-36 rounded-lg bg-card p-1 ring-1 ring-white/15'>
              <a
                className='block rounded-md px-3 py-2 text-sm text-foreground hover:bg-white/10'
                href='/shops'
              >
                Shops
              </a>
            </div>
          </details>
          <a className='text-sm text-muted-foreground transition hover:text-foreground' href='/help/index.html'>
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
  );
}
