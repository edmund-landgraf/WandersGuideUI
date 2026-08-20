import { CampaignSignIn } from '@auth/CampaignSignIn';
import { useAuthSession } from '@auth/useAuthSession';
import { defineDefaultSources, isContentPackageEmpty } from '@content/content-store';
import { COMMON_CORE_ID } from '@constants/data';
import type { Character } from '@schemas/content';
import { isPlayable } from '@utils/character';
import { usePhase1BuilderCharacter } from './phase1-builder-character';
import { uniq } from 'lodash-es';
import { Home, Hammer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { OLD_UI_ORIGIN } from '../phase-switch/PhaseViewSwitch';
import { Phase1BuilderLevels } from './phase1-builder-levels';
import { Phase1BuilderPicks } from './phase1-builder-picks';
import { Phase1BuilderHomeFields } from './phase1-builder-settings';
import { Phase1BuilderStats } from './phase1-builder-stats';

export function Phase1BuilderPage() {
  const { characterId } = useParams();
  return <Navigate to={`/sheet/${characterId}?view=builder`} replace />;
}

export function Phase1BuilderWorkspace({
  characterId,
  embedded,
  seed,
}: {
  characterId: number;
  embedded?: boolean;
  seed?: Character | null;
}) {
  const session = useAuthSession();
  if (session === undefined) return <Centered>Loading session…</Centered>;
  if (!Number.isFinite(characterId)) return <Centered>Invalid character id.</Centered>;
  if (!session && !embedded) return <CampaignSignIn variant='phase1' />;
  return <Phase1BuilderInner characterId={characterId} embedded={embedded} seed={seed} />;
}

function Phase1BuilderInner({ characterId, embedded, seed }: { characterId: number; embedded?: boolean; seed?: Character | null }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'home' | 'builder'>('home');
  const { character, setCharacter, flushSave, content, contentError, retryContent, results, isLoading } =
    usePhase1BuilderCharacter(characterId, seed);

  useEffect(() => {
    if (!embedded && character?.name) document.title = `${character.name} | Builder`;
  }, [character?.name, embedded]);

  useEffect(() => {
    const sources = uniq([COMMON_CORE_ID, ...(character?.content_sources?.enabled ?? [])]);
    if (sources.length > 0) defineDefaultSources('BOTH', sources);
  }, [character?.content_sources?.enabled]);

  if (!character) {
    return <Centered>{isLoading ? 'Loading character…' : 'Character not found.'}</Centered>;
  }
  if (!content) {
    return <Centered>Loading game content…</Centered>;
  }
  if (contentError || isContentPackageEmpty(content)) {
    return (
      <Centered>
        The content library didn’t load, so the builder stayed closed to avoid saving against missing data.{' '}
        <button type='button' className='toolbar-button ml-2' onClick={() => retryContent()}>
          Retry
        </button>
      </Centered>
    );
  }

  const playable = isPlayable(character);

  return (
    <div className={embedded ? 'text-p1-text' : 'min-h-screen bg-p1-page text-p1-text'}>
      {!embedded && (
        <div className='flex justify-end px-4 pt-4'>
          <a className='toolbar-button' href={`${OLD_UI_ORIGIN}/builder/${character.id}`} target='_blank' rel='noreferrer' title='Open the original builder'>
            Original
          </a>
        </div>
      )}
      <div className={`mb-4 grid grid-cols-2 border border-p1-border bg-p1-surface ${embedded ? '' : 'mx-auto max-w-6xl'}`}>
        <button
          type='button'
          className={`flex items-center justify-center gap-2 border-b-2 py-3 text-sm ${step === 'home' ? 'border-p1-accent text-p1-text' : 'border-transparent text-p1-muted hover:text-p1-text'}`}
          onClick={() => setStep('home')}
        >
          <Home size={15} /> Home
        </button>
        <button
          type='button'
          className={`flex items-center justify-center gap-2 border-b-2 py-3 text-sm ${step === 'builder' ? 'border-p1-accent text-p1-text' : 'border-transparent text-p1-muted hover:text-p1-text'}`}
          onClick={() => setStep('builder')}
        >
          <Hammer size={15} /> Builder
        </button>
      </div>
      {step === 'home' ? (
        <div className={`border border-p1-border bg-p1-surface p-4 ${embedded ? '' : 'mx-auto max-w-6xl'}`}>
          <div className='mb-6 grid gap-4 sm:grid-cols-2'>
            <Phase1BuilderPicks character={character} setCharacter={setCharacter} flushSave={flushSave} content={content} results={results} showPicks={false} />
          </div>
          <Phase1BuilderHomeFields character={character} setCharacter={setCharacter} />
        </div>
      ) : (
        <main className={`grid gap-4 ${embedded ? '' : 'mx-auto max-w-6xl px-4 pb-6'} lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]`}>
          <aside className='space-y-4 self-start border border-p1-border bg-p1-surface p-4 lg:sticky lg:top-4'>
            <Phase1BuilderPicks character={character} setCharacter={setCharacter} flushSave={flushSave} content={content} results={results} showIdentity={false} />
            <Phase1BuilderStats results={results} />
            {!embedded && (
              <button type='button' className='toolbar-button' disabled={!playable} onClick={() => navigate(`/sheet/${character.id}`)}>
                Open sheet
              </button>
            )}
          </aside>
          <section>
            <Phase1BuilderLevels character={character} setCharacter={setCharacter} results={results} />
          </section>
        </main>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className='grid min-h-screen place-items-center bg-p1-page px-6 text-center text-sm text-p1-muted'>{children}</div>;
}
