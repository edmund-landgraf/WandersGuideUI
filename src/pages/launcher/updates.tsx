import { LauncherHeader } from './launcher-header';
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { groupUpdateLines, UPDATE_TOPICS, type WeeklyUpdate } from '@utils/weeklyUpdates';
import generated from '../../generated/weeklyUpdates.json';
import './launcher.css';

const weeksSource = generated.weeks as WeeklyUpdate[];

function weekGroups(week: WeeklyUpdate, topic: string) {
  const groups = groupUpdateLines(week.subjects);
  if (topic === 'All') return groups;
  return groups.filter((group) => group.title === topic);
}

function Updates() {
  const weeks = useMemo(() => [...weeksSource].reverse(), []);
  const [topic, setTopic] = useState('All');
  const latest = weeks[0];
  const older = weeks.slice(1);
  const visibleOlder = older.filter((week) => weekGroups(week, topic).length > 0);
  const latestGroups = latest ? weekGroups(latest, topic) : [];
  const shownCount =
    (latest && latestGroups.length > 0 ? latestGroups.reduce((sum, group) => sum + group.items.length, 0) : 0) +
    visibleOlder.reduce(
      (sum, week) => sum + weekGroups(week, topic).reduce((inner, group) => inner + group.items.length, 0),
      0,
    );

  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <LauncherHeader />
        <section className='px-8 pt-8 pb-16'>
          <div className='mx-auto flex max-w-3xl flex-col gap-8'>
            <div>
              <p className='text-xs tracking-[0.18em] text-muted-foreground uppercase'>Changelog</p>
              <h1 className='mt-2 font-heading text-4xl leading-tight text-foreground'>What changed</h1>
              <p className='mt-3 max-w-xl text-sm leading-6 text-muted-foreground'>
                {weeks.length === 0
                  ? 'No updates yet.'
                  : topic === 'All'
                    ? `${shownCount} notes across ${weeks.length} weeks, newest first.`
                    : `${shownCount} notes in ${topic}.`}
              </p>
            </div>

            <div className='flex flex-wrap gap-2'>
              {['All', ...UPDATE_TOPICS].map((name) => {
                const active = topic === name;
                return (
                  <button
                    key={name}
                    type='button'
                    onClick={() => setTopic(name)}
                    className={
                      active
                        ? 'rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-900'
                        : 'rounded-full bg-white/5 px-3 py-1 text-xs text-muted-foreground ring-1 ring-white/15 transition hover:text-foreground'
                    }
                  >
                    {name}
                  </button>
                );
              })}
            </div>

            {latest && latestGroups.length > 0 && (
              <article className='rounded-2xl bg-white/8 p-7 ring-1 ring-white/25'>
                <p className='text-xs tracking-[0.16em] text-muted-foreground uppercase'>This week</p>
                <h2 className='mt-2 font-heading text-2xl text-foreground'>{latest.label}</h2>
                <WeekBody week={latest} groups={latestGroups} />
              </article>
            )}

            {visibleOlder.length > 0 && (
              <div className='flex flex-col gap-3'>
                <h2 className='font-heading text-lg text-foreground'>Earlier</h2>
                {visibleOlder.map((week) => (
                  <details className='rounded-xl bg-white/5 px-5 py-4 ring-1 ring-white/15' key={week.weekStart}>
                    <summary className='cursor-pointer list-none'>
                      <span className='flex items-baseline justify-between gap-4'>
                        <span className='font-heading text-base text-foreground'>{week.label}</span>
                        <span className='text-xs text-muted-foreground'>
                          {weekGroups(week, topic).reduce((sum, group) => sum + group.items.length, 0)}
                        </span>
                      </span>
                    </summary>
                    <WeekBody week={week} groups={weekGroups(week, topic)} />
                  </details>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function WeekBody({
  week,
  groups,
}: {
  week: WeeklyUpdate;
  groups: { title: string; items: string[] }[];
}) {
  return (
    <div className='mt-5 flex flex-col gap-4'>
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className='text-xs tracking-wide text-muted-foreground uppercase'>{group.title}</h3>
          <ul className='mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-foreground/90'>
            {group.items.map((subject, index) => (
              <li key={`${week.weekStart}-${group.title}-${index}`}>{subject}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Updates />
  </StrictMode>,
);
