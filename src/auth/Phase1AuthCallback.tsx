import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { CampaignSignIn } from './CampaignSignIn';
import { consumeOAuthReturnPath, peekOAuthReturnPath } from './campaign-auth';
import { useAuthSession } from './useAuthSession';

export function Phase1AuthCallback() {
  const session = useAuthSession();
  const next = peekOAuthReturnPath() || '/phase1';

  useEffect(() => {
    if (session) consumeOAuthReturnPath();
  }, [session]);

  if (session === undefined) {
    return <div className='grid min-h-screen place-items-center bg-[#0d1114] text-sm text-[#7f8a90]'>Signing in...</div>;
  }
  if (!session) return <CampaignSignIn variant='phase1' />;
  return <Navigate to={next} replace />;
}
