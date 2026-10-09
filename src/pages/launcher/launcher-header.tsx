import { PATREON_URL } from '@constants/urls';

export function LauncherHeader() {
  return (
    <header className='border-b border-border px-8 py-4'>
      <div className='mx-auto flex max-w-6xl items-center justify-between'>
        <a className='font-heading text-sm text-foreground' href='/'>
          Wanderer's Guide
        </a>
        <div className='flex items-center gap-5'>
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
