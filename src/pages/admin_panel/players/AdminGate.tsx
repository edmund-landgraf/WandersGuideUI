import { WorkspaceHeader } from '@pages/phase1/Phase1Workspace';
import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_LOCKED_EVENT, getAdminUnlock, unlockAdmin } from './admin-api';
import { useAdminAccess } from './useAdminAccess';

export function AdminGate({ children }: { children: ReactNode }) {
  const access = useAdminAccess();
  const [unlocked, setUnlocked] = useState(() => Boolean(getAdminUnlock()));
  const queryClient = useQueryClient();
  useEffect(() => {
    const onLocked = () => {
      setUnlocked(false);
      queryClient.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('admin-') });
    };
    window.addEventListener(ADMIN_LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(ADMIN_LOCKED_EVENT, onLocked);
  }, [queryClient]);

  if (access === 'allowed' && unlocked) return <>{children}</>;
  return (
    <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader label='Admin' />
      <main className='mx-auto max-w-5xl px-6 py-10' data-testid='admin-gate'>
        {access === 'loading' ? (
          <p className='text-sm text-p1-muted'>Loading…</p>
        ) : access === 'allowed' ? (
          <PasswordPrompt onUnlocked={() => setUnlocked(true)} />
        ) : (
          <div className='border border-p1-border bg-p1-surface p-5'>
            <h1 className='text-xl font-semibold'>Not authorized</h1>
            <p className='mt-2 text-sm text-p1-muted'>
              {access === 'signed-out' ? 'Sign in with an administrator account to use this page.' : 'This page is only available to administrators.'}
            </p>
            <Link to='/phase1/characters' className='toolbar-button mt-4 inline-flex'>Back to Characters</Link>
          </div>
        )}
      </main>
    </div>
  );
}

function PasswordPrompt({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlockAdmin(password);
      setPassword('');
      onUnlocked();
    } catch (e) {
      setError((e as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className='max-w-sm border border-p1-border bg-p1-surface p-5' onSubmit={(e) => void submit(e)} data-testid='admin-password-prompt'>
      <div className='flex items-center gap-2'>
        <Lock size={16} className='text-p1-muted' />
        <h1 className='text-xl font-semibold'>Admin panel locked</h1>
      </div>
      <p className='mt-2 text-sm text-p1-muted'>Enter the admin password to continue.</p>
      <input
        type='password'
        autoFocus
        autoComplete='off'
        className='settings-input mt-4 h-9 w-full'
        aria-label='Admin password'
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className='mt-2 text-sm text-red-400' data-testid='admin-password-error'>{error}</p>}
      <button type='submit' className='toolbar-button mt-4' disabled={busy || !password}>{busy ? 'Checking…' : 'Unlock'}</button>
    </form>
  );
}