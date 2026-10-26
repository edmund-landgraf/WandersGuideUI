import { Eyebrow } from '@pages/phase1/phase1-entity-panels';
import { WorkspaceHeader } from '@pages/phase1/Phase1Workspace';
import { useEffect, useState } from 'react';
import { AdminGate } from './AdminGate';
import { AdminPlayerRow } from './AdminPlayerRow';
import { AdminPlayerSort, useAdminPlayers } from './admin-api';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { getCachedPublicUser } from '@auth/user-manager';

const PAGE_SIZE = 50;

/** /phase1/admin â€” Players only. The legacy Mantine "Tools" stack needs the old app's providers, so it stays at the legacy /admin. */
export function Phase1AdminPage() {
  return (
    <AdminGate>
      <AdminPlayers />
    </AdminGate>
  );
}

function AdminPlayers() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('');
  const [provider, setProvider] = useState('');
  const [sort, setSort] = useState<AdminPlayerSort | null>(null);
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const onSort = (key: AdminPlayerSort) => {
    if (sort === key) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setDirection('asc'); }
    setPage(0);
  };
  const sh = (key: AdminPlayerSort, label: string, right = false) => <SortHeader k={key} label={label} sort={sort} direction={direction} onSort={onSort} right={right} />;
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const players = useAdminPlayers({ page, pageSize: PAGE_SIZE, query, tier: tier || null, provider: provider || null, sort, direction });
  const total = players.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canRevealEmail = Boolean(getCachedPublicUser()?.is_admin);

  return (
    <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader label='Admin' />
      <main className='mx-auto max-w-6xl px-6 py-10'>
        <div className='mb-3 flex flex-wrap items-end justify-between gap-6 border-b border-p1-border pb-3'>
          <div>
            <Eyebrow>Admin</Eyebrow>
            <h1 className='mt-2 text-3xl font-semibold'>Players</h1>
            <p className='mt-2 text-sm text-p1-muted'>Every player's character workspace, one layer up. Character links open a read-only admin view.</p>
            <p className='mt-2 text-xs text-p1-muted'>{players.data ? `${total} players` : ' '}</p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <input className='settings-input h-9 w-64' placeholder='Search name, email, or user id' value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            <select className='settings-input h-9' value={tier} onChange={(e) => { setTier(e.target.value); setPage(0); }} aria-label='Patreon tier'>
              <option value=''>All tiers</option>
              <option value='NONE'>No Patreon</option>
              <option value='ADVOCATE'>Advocate</option>
              <option value='WANDERER'>Wanderer</option>
              <option value='LEGEND'>Legend</option>
              <option value='GAME-MASTER'>Game Master</option>
            </select>
            <select className='settings-input h-9' value={provider} onChange={(e) => { setProvider(e.target.value); setPage(0); }} aria-label='Login method'>
              <option value=''>All logins</option>
              <option value='email'>Email</option>
              <option value='google'>Google</option>
              <option value='discord'>Discord</option>
            </select>
          </div>
        </div>

        <div className='grid grid-cols-[auto_1fr_7rem_7rem_4rem_5rem_10rem] gap-3 px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-p1-muted'>
          <span className='w-8' />
          <span className='flex items-center gap-3'>{sh('name', 'Player')}{sh('email', 'Email')}</span>
          {sh('login', 'Login')}
          {sh('tier', 'Patreon')}
          {sh('pcs', 'PCs', true)}
          {sh('campaigns', 'Campaigns', true)}
          {sh('last_login', 'Last logged in', true)}
        </div>
        <div className='divide-y divide-p1-border border-y border-p1-border'>
          {players.isPending ? (
            <p className='px-2 py-3 text-sm text-p1-muted'>Loading playersâ€¦</p>
          ) : players.error ? (
            <p className='px-2 py-3 text-sm text-red-400'>{(players.error as Error).message}</p>
          ) : players.data?.players.length ? (
            players.data.players.map((player) => <AdminPlayerRow key={player.user_id} player={player} canRevealEmail={canRevealEmail} />)
          ) : (
            <p className='px-2 py-3 text-sm text-p1-muted'>No players match.</p>
          )}
        </div>
        {pages > 1 && (
          <div className='mt-4 flex items-center justify-end gap-2 text-sm text-p1-muted'>
            <button type='button' className='toolbar-button' disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {page + 1} of {pages}</span>
            <button type='button' className='toolbar-button' disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </main>
    </div>
  );
}
function SortHeader({ k, label, sort, direction, onSort, right }: { k: AdminPlayerSort; label: string; sort: AdminPlayerSort | null; direction: 'asc' | 'desc'; onSort: (k: AdminPlayerSort) => void; right?: boolean }) {
  const active = sort === k;
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type='button'
      data-testid={`admin-sort-${k}`}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`flex items-center gap-1 uppercase tracking-wide hover:text-p1-text${right ? ' justify-end text-right' : ''}${active ? ' text-p1-text' : ''}`}
      onClick={() => onSort(k)}
    >
      {label}
      <Icon size={12} className={active ? '' : 'opacity-40'} />
    </button>
  );
}