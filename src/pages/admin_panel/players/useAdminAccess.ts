import { useAuthSession } from '@auth/useAuthSession';

/**
 * Client-side gate for the admin routes: any signed-in account may reach the password prompt.
 * The admin password (checked server-side by admin-unlock) is the only admin gate; the edge
 * functions reject every admin call without a valid, unexpired unlock token.
 */
export function useAdminAccess(): 'loading' | 'signed-out' | 'allowed' {
  const session = useAuthSession();
  if (session === undefined) return 'loading';
  if (!session) return 'signed-out';
  return 'allowed';
}