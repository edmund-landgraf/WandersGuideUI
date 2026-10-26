import { Eyebrow } from '@pages/phase1/phase1-entity-panels';
import { WorkspaceHeader } from '@pages/phase1/Phase1Workspace';
import { User } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AdminGate } from './AdminGate';
import { useAdminCharacter } from './admin-api';

/**
 * /phase1/admin/view/:characterId — admin-only READ-ONLY character view.
 * No inputs, no mutations, and no imports from the sheet/builder, so nothing here can write.
 */
export function Phase1AdminCharacterView() {
  return (
    <AdminGate>
      <CharacterView />
    </AdminGate>
  );
}

function CharacterView() {
  const id = Number(useParams().characterId);
  const query = useAdminCharacter(id);
  const c = query.data?.character;
  const d = c?.details ?? {};
  const items: any[] = c?.inventory?.items ?? [];
  const coins = c?.inventory?.coins ?? {};
  const field = (label: string, value: unknown) => (
    <div className='border border-p1-border bg-p1-surface px-3 py-2'>
      <div className='text-[10px] uppercase tracking-wide text-p1-faint'>{label}</div>
      <div className='text-sm'>{value == null || value === '' ? '—' : String(value)}</div>
    </div>
  );

  return (
    <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader label='Admin' />
      <main className='mx-auto max-w-5xl px-6 py-10' data-testid='admin-character-view'>
        <div className='mb-4 flex items-center justify-between'>
          <Link to='/phase1/admin' className='text-sm text-p1-muted hover:text-p1-text'>← Back to Players</Link>
          <span className='border border-p1-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-p1-muted' data-testid='admin-readonly-badge'>
            Admin view · Read only
          </span>
        </div>
        {query.isPending ? (
          <p className='text-sm text-p1-muted'>Loading character…</p>
        ) : query.error || !c ? (
          <p className='text-sm text-red-400'>{(query.error as Error)?.message ?? 'Character not found'}</p>
        ) : (
          <>
            <div className='mb-6 flex items-center gap-4 border-b border-p1-border pb-4'>
              {d.image_url ? (
                <span className='h-20 w-20 shrink-0 overflow-hidden border border-p1-border bg-p1-inset'>
                  <img src={d.image_url} alt='' className='h-full w-full object-cover' />
                </span>
              ) : (
                <span className='grid h-20 w-20 shrink-0 place-items-center border border-p1-border bg-p1-inset text-p1-faint'><User size={28} /></span>
              )}
              <div>
                <Eyebrow>Character #{c.id}</Eyebrow>
                <h1 className='mt-1 text-3xl font-semibold'>{c.name}</h1>
                <p className='mt-1 text-sm text-p1-muted'>
                  Level {c.level} · Owner: {query.data.owner_display_name ?? c.user_id}
                  {query.data.campaign_name ? ` · Campaign: ${query.data.campaign_name}` : ''}
                </p>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
              {field('Ancestry', d.ancestry?.name)}
              {field('Heritage', d.heritage?.name)}
              {field('Background', d.background?.name)}
              {field('Class', [d.class?.name, d.class_2?.name].filter(Boolean).join(' / '))}
              {field('HP (current)', c.hp_current)}
              {field('Temp HP', c.hp_temp)}
              {field('Hero points', c.hero_points)}
              {field('Experience', c.experience)}
            </div>
            <h2 className='mt-6 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-p1-muted'>Inventory</h2>
            <div className='divide-y divide-p1-border border-y border-p1-border'>
              <p className='px-2 py-2 text-sm text-p1-muted'>{['pp', 'gp', 'sp', 'cp'].map((k) => `${coins[k] ?? 0} ${k}`).join(' · ')}</p>
              {items.length === 0 ? (
                <p className='px-2 py-2 text-sm text-p1-muted'>(no items)</p>
              ) : (
                items.map((it, i) => (
                  <p key={it?.id ?? i} className='px-2 py-1 text-sm'>
                    {it?.item?.name ?? 'Item'}
                    {it?.is_equipped ? <span className='text-p1-muted'> (equipped)</span> : null}
                  </p>
                ))
              )}
            </div>
            <h2 className='mt-6 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-p1-muted'>Raw details (read-only)</h2>
            <pre className='max-h-80 overflow-auto border border-p1-border bg-p1-inset p-3 text-xs text-p1-muted'>
              {JSON.stringify({ details: c.details, spells: c.spells, notes: c.notes }, null, 2)}
            </pre>
            <p className='mt-3 text-xs text-p1-faint'>Created {new Date(c.created_at).toLocaleString()} · Updated {new Date(c.updated_at).toLocaleString()}</p>
          </>
        )}
      </main>
    </div>
  );
}