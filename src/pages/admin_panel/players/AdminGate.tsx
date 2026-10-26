import { WorkspaceHeader } from '@pages/phase1/Phase1Workspace';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAdminAccess } from './useAdminAccess';

export function AdminGate({ children }: { children: ReactNode }) {
  const access = useAdminAccess();

  if (access === 'allowed') return <>{children}</>;
  return (
    <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader label='Admin' />
      <main className='mx-auto max-w-5xl px-6 py-10' data-testid='admin-gate'>
        {access === 'loading' ? (
          <p className='text-sm text-p1-muted'>Loading…</p>
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
