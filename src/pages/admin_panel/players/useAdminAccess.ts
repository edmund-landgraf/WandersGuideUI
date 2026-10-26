import { getPublicUser } from '@auth/user-manager';
import { useAuthSession } from '@auth/useAuthSession';
import { useQuery } from '@tanstack/react-query';
import { canUseAdminScreens } from './admin-config';

/** Client-side gate for the admin routes. The edge functions enforce access independently (403). */
export function useAdminAccess(): 'loading' | 'signed-out' | 'denied' | 'allowed' {
  const session = useAuthSession();
  const user = useQuery({
    queryKey: ['admin-public-user', session?.user.id],
    enabled: Boolean(session),
    queryFn: () => getPublicUser(),
    staleTime: 60_000,
  });
  if (session === undefined) return 'loading';
  if (!session) return 'signed-out';
  if (user.isPending) return 'loading';
  return canUseAdminScreens(user.data) ? 'allowed' : 'denied';
}