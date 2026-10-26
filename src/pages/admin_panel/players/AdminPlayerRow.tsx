import { Eye, EyeOff, Minus, Plus, Shield } from 'lucide-react';
import { useState } from 'react';
import { AdminCharacterRow } from './AdminCharacterRow';
import { ADMIN_PC_CAP } from './admin-config';
import { AdminPlayer, revealEmail, useAdminPlayerCharacters } from './admin-api';

const PROVIDER_LABELS: Record<string, string> = { email: 'Email', google: 'Google', discord: 'Discord', github: 'GitHub', apple: 'Apple' };

/** One player = the Phase 1 character list for that player, behind a +/- folder-style row. */
export function AdminPlayerRow({ player, canRevealEmail }: { player: AdminPlayer; canRevealEmail: boolean }) {
  const [open, setOpen] = useState(false);
  const [fullEmail, setFullEmail] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const characters = useAdminPlayerCharacters(player.user_id, open);
  const over = player.is_capped && player.pc_count > ADMIN_PC_CAP;
  const pcLabel = player.is_capped ? `${player.pc_count}/${ADMIN_PC_CAP}` : `${player.pc_count}`;

  async function toggleEmail() {
    if (fullEmail) return setFullEmail(null);
    setRevealing(true);
    try {
      setFullEmail((await revealEmail(player.user_id)).email ?? '(none)');
    } catch {
      setFullEmail(null);
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div data-testid='admin-player-row'>
      <div className='grid w-full grid-cols-[auto_1fr_7rem_7rem_4rem_5rem_10rem] items-center gap-3 px-2 py-2 hover:bg-p1-hover'>
        <button
          type='button'
          className='icon-button'
          data-testid='admin-player-toggle'
          aria-expanded={open}
          aria-label={open ? `Collapse ${player.display_name}` : `Expand ${player.display_name}`}
          onClick={() => {
            if (open) setFullEmail(null);
            setOpen((value) => !value);
          }}
        >
          {open ? <Minus size={15} /> : <Plus size={15} />}
        </button>
        <div className='min-w-0'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate text-base font-semibold'>{player.display_name ?? 'Unknown User'}</span>
            {player.is_admin && <Shield size={14} className='shrink-0 text-p1-accent' aria-label='Admin' />}
            {player.is_mod && <span className='text-[10px] uppercase tracking-wide text-p1-muted'>Mod</span>}
            {player.deactivated && <span className='text-[10px] uppercase tracking-wide text-red-400'>Deactivated</span>}
          </div>
          <div className='flex min-w-0 items-center gap-1 text-xs text-p1-muted'>
            <span className='truncate' data-testid='admin-player-email'>{fullEmail ?? player.masked_email ?? '(no email)'}</span>
            {canRevealEmail && player.masked_email && (
              <button
                type='button'
                className='text-p1-faint hover:text-p1-text'
                title={fullEmail ? 'Hide email' : 'Reveal email (logged)'}
                aria-label='Reveal email'
                disabled={revealing}
                onClick={() => void toggleEmail()}
              >
                {fullEmail ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            )}
          </div>
        </div>
        <span className='truncate text-sm text-p1-muted'>{player.providers.length ? player.providers.map((p) => PROVIDER_LABELS[p] ?? p).join(', ') : 'â€”'}</span>
        <span className='truncate text-sm text-p1-muted'>{player.patreon_tier ?? 'no Patreon tier'}</span>
        <span className={`text-right text-sm font-semibold${over ? ' text-red-400' : ''}`} data-testid='admin-player-pcs'>{pcLabel}</span>
        <span className='text-right text-sm text-p1-muted' data-testid='admin-player-campaigns'>{player.campaign_count ?? 0}</span>
        <span className='truncate text-right text-sm text-p1-muted' data-testid='admin-player-last-login' title={player.last_sign_in_at ?? undefined}>{player.last_sign_in_at ? new Date(player.last_sign_in_at).toLocaleString() : 'Never'}</span>
      </div>
      {open && (
        <div className='divide-y divide-p1-border border-t border-p1-border' data-testid='admin-player-expanded'>
          {characters.isPending ? (
            <p className='px-10 py-3 text-sm text-p1-muted'>Loadingâ€¦</p>
          ) : characters.error ? (
            <p className='px-10 py-3 text-sm text-red-400'>{(characters.error as Error).message}</p>
          ) : !characters.data?.length ? (
            <p className='px-10 py-3 text-sm text-p1-muted' data-testid='admin-no-pcs'>(no PCs)</p>
          ) : (
            characters.data.map((character) => <AdminCharacterRow key={character.id} character={character} />)
          )}
        </div>
      )}
    </div>
  );
}