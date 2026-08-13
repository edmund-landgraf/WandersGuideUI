import { ArrowRight, Columns3, FlaskConical } from 'lucide-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './launcher.css';

function Launcher() {
  return (
    <main className='min-h-screen bg-[#101417] text-[#e8ecef]'>
      <header className='border-b border-white/10 px-6 py-4'>
        <div className='mx-auto flex max-w-6xl items-center justify-between'>
          <a className='text-sm font-semibold uppercase tracking-[0.16em]' href='/'>Wanderer's Guide</a>
          <span className='text-xs text-[#89939a]'>Campaign UI workspace</span>
        </div>
      </header>
      <section className='mx-auto grid min-h-[calc(100vh-65px)] max-w-6xl content-center gap-10 px-6 py-12'>
        <div className='max-w-2xl'>
          <p className='mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#d6a85f]'>Parallel development</p>
          <h1 className='text-4xl font-semibold leading-tight sm:text-5xl'>Choose an interface</h1>
          <p className='mt-4 max-w-xl text-base leading-7 text-[#a8b0b5]'>Phase 0 preserves the current campaign and encounter structure. Phase 1 is the replacement workspace built without Mantine UI.</p>
        </div>
        <div className='grid gap-px overflow-hidden border border-white/10 bg-white/10 md:grid-cols-2'>
          <a className='group bg-[#151b1f] p-7 transition hover:bg-[#1a2227]' href='/phase0'>
            <div className='flex items-start justify-between gap-6'>
              <div className='flex h-11 w-11 items-center justify-center border border-white/10 bg-[#101417] text-[#a8b0b5]'><Columns3 className='h-5 w-5' /></div>
              <ArrowRight className='h-5 w-5 text-[#667178] transition group-hover:translate-x-1 group-hover:text-white' />
            </div>
            <div className='mt-12 text-xs font-semibold uppercase tracking-[0.16em] text-[#89939a]'>Phase 0</div>
            <h2 className='mt-2 text-2xl font-semibold'>Parity clone</h2>
            <p className='mt-3 text-sm leading-6 text-[#89939a]'>Read-only validation of existing data and behavior.</p>
          </a>
          <a className='group bg-[#151b1f] p-7 transition hover:bg-[#1a2227]' href='/phase1'>
            <div className='flex items-start justify-between gap-6'>
              <div className='flex h-11 w-11 items-center justify-center border border-[#d6a85f]/30 bg-[#d6a85f]/10 text-[#edc98d]'><FlaskConical className='h-5 w-5' /></div>
              <ArrowRight className='h-5 w-5 text-[#667178] transition group-hover:translate-x-1 group-hover:text-white' />
            </div>
            <div className='mt-12 text-xs font-semibold uppercase tracking-[0.16em] text-[#d6a85f]'>Phase 1</div>
            <h2 className='mt-2 text-2xl font-semibold'>Replacement workspace</h2>
            <p className='mt-3 text-sm leading-6 text-[#89939a]'>New information architecture using Tailwind and shadcn patterns.</p>
          </a>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><Launcher /></StrictMode>);