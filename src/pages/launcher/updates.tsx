import { LauncherHeader } from './launcher-header';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import generated from '../../generated/weeklyUpdates.json';
import { groupUpdateLines } from '@utils/weeklyUpdates';
import './launcher.css';

function Updates() {
  const weeks = [...generated.weeks].reverse();
  const first = generated.weeks[0];
  const last = generated.weeks[generated.weeks.length - 1];
  const total = generated.weeks.reduce((sum, week) => sum + week.count, 0);

  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <LauncherHeader />
        <section className='px-8 pt-5 pb-16'>
          <div className='mx-auto flex max-w-3xl flex-col gap-4'>
            <div>
              <h1 className='font-heading text-4xl leading-tight text-foreground'>Updates</h1>
              <p className='mt-3 text-sm leading-6 text-muted-foreground'>
                {weeks.length === 0
                  ? 'No updates yet.'
                  : `${total} updates from ${first?.label ?? ''} through ${last?.label ?? ''}, one summary per week.`}
              </p>
            </div>
            {weeks.map((week) => (
              <article className='rounded-xl bg-white/5 p-6 ring-1 ring-white/20' key={week.weekStart}>
                <h2 className='font-heading text-xl text-foreground'>{week.label}</h2>
                <p className='mt-3 text-sm leading-6 text-muted-foreground'>{week.summary}</p>
                <div className='mt-4 flex flex-col gap-4'>
                  {groupUpdateLines(week.subjects).map((group) => (
                    <section key={group.title}>
                      <h3 className='text-sm font-medium text-foreground'>{group.title}</h3>
                      <ul className='mt-1 list-disc space-y-1 pl-8 text-sm leading-6 text-muted-foreground'>
                        {group.items.map((subject, index) => (
                          <li key={`${week.weekStart}-${group.title}-${index}`}>{subject}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                <p className='mt-3 text-xs text-muted-foreground'>
                  {week.count} {week.count === 1 ? 'update' : 'updates'}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Updates />
  </StrictMode>,
);
