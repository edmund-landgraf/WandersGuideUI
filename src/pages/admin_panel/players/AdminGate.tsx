import { WorkspaceHeader } from '@pages/phase1/Phase1Workspace';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_LOCKED_EVENT, getAdminUnlock, unlockAdmin } from './admin-api';
import { useAdminAccess } from './useAdminAccess';

export function AdminGate({ children }: { children: ReactNode }) {
  const access = useAdminAccess();
  const [unlocked, setUnlocked] = useState(() => Boolean(getAdminUnlock()));

  useEffect(() => {
    const onLock = () => setUnlocked(false);
    window.addEventListener(ADMIN_LOCKED_EVENT, onLock);
    return () => window.removeEventListener(ADMIN_LOCKED_EVENT, onLock);
  }, []);

  if (access === 'allowed' && unlocked) return <>{children}</>;
  if (access === 'allowed') {
    return (
      <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
        <WorkspaceHeader label='Admin' />
        <main className='mx-auto max-w-5xl px-6 py-10'>
          <AdminUnlockForm onUnlocked={() => setUnlocked(true)} />
        </main>
      </div>
    );
  }
  return (
    <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader label='Admin' />
      <main className='mx-auto max-w-5xl px-6 py-10' data-testid='admin-gate'>
        {access === 'loading' ? (
          <p className='text-sm text-p1-muted'>Loading…</p>
        ) : (
          <div className='border border-p1-border bg-p1-surface p-5'>
            <h1 className='text-xl font-semibold'>Sign in required</h1>
            <p className='mt-2 text-sm text-p1-muted'>
              Sign in to use this page, then enter the admin password.
            </p>
            <Link to='/phase1/characters' className='toolbar-button mt-4 inline-flex'>Back to Characters</Link>
          </div>
        )}
      </main>
    </div>
  );
}

function AdminUnlockForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await unlockAdmin(password);
      setPassword('');
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className='max-w-md border border-p1-border bg-p1-surface p-5' onSubmit={onSubmit} data-testid='admin-unlock'>
      <h1 className='text-xl font-semibold'>Admin panel is locked</h1>
      <p className='mt-2 text-sm text-p1-muted'>Enter the admin password. It is checked on the server and is not stored in the browser. The unlock lasts about eight hours, or until this tab closes.</p>
      <label className='mt-4 block text-xs font-semibold uppercase tracking-wide text-p1-muted' htmlFor='admin-password'>Password</label>
      <input
        id='admin-password'
        type='password'
        autoComplete='current-password'
        className='settings-input mt-1 h-9 w-full'
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className='mt-2 text-sm text-red-400'>{error}</p>}
      <button type='submit' className='toolbar-button mt-4' disabled={pending || !password}>
        {pending ? 'Checking…' : 'Unlock'}
      </button>
    </form>
  );
}
