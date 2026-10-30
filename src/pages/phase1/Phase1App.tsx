import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isRouteErrorResponse, Link, Outlet, RouterProvider, createBrowserRouter, useRouteError } from 'react-router-dom';
import { Phase1CampaignPage, Phase1CharactersPage, Phase1EncountersPage, Phase1IndexPage, Phase1StandaloneEncounterPage } from './Phase1Workspace';
import { Phase1SheetPage } from './Phase1SheetPage';
import { Phase1StatBlockPage } from './Phase1StatBlockPage';
import { TacticsPage } from './tactics/TacticsPage';
import { Phase1AccountPage } from './Phase1AccountPage';
import { Phase1HomebrewPage } from './Phase1HomebrewPage';
import { Phase1BuilderPage } from './Phase1BuilderPage';
import { Phase1AuthCallback } from '@auth/Phase1AuthCallback';
import { ContentLinkProvider } from './phase1-content-links';
import { CloseStackOnNavigate, ContentStackModal } from './phase1-content-stack';
import { getPublicUser } from '@auth/user-manager';
import { supabase } from '../../supabase-client';
import { ensurePhase1PublicUser } from './phase1-api';
import { applyDisplayPrefsFromUser } from './display-prefs';
import { applyPhase1CssTheme, readStoredPhase1CssTheme } from './phase1-css-theme';
import { applyPhase1Theme, readStoredPhase1Theme } from './phase1-theme';
import { OperationErrorModalHost } from '@utils/operation-error-modal';
import { Phase1AdminPage } from '@pages/admin_panel/players/Phase1AdminPage';
import { Phase1AdminCharacterView } from '@pages/admin_panel/players/Phase1AdminCharacterView';
import './phase1.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

export function Phase1Shell() {
  useEffect(() => {
    applyPhase1Theme(readStoredPhase1Theme());
    applyPhase1CssTheme(readStoredPhase1CssTheme());
    void (async () => {
      let user = await getPublicUser();
      if (!user) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          try {
            await ensurePhase1PublicUser(session.access_token);
            user = await getPublicUser();
          } catch {
            // Create/import still call ensure; a failed backfill must not block the shell.
          }
        }
      }
      applyDisplayPrefsFromUser(user);
      applyPhase1Theme(readStoredPhase1Theme());
      applyPhase1CssTheme(readStoredPhase1CssTheme());
    })();
  }, []);
  return (
    <ContentLinkProvider>
      <CloseStackOnNavigate />
      <Outlet />
      <ContentStackModal />
      <OperationErrorModalHost />
    </ContentLinkProvider>
  );
}

function Phase1NotFound({ detail }: { detail?: string }) {
  return (
    <div className='min-h-screen bg-p1-page p-8 text-p1-text'>
      <h1 className='text-xl font-semibold'>Page not found</h1>
      <p className='mt-2 max-w-md text-sm text-p1-muted'>{detail ?? `${window.location.pathname} is not a page in this app.`}</p>
      <Link to='/phase1' className='mt-4 inline-block text-sm text-p1-accent hover:underline'>
        Back to campaigns
      </Link>
    </div>
  );
}

function Phase1RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <Phase1NotFound detail={`${window.location.pathname} is not a page in this app.`} />;
  }
  return (
    <div className='min-h-screen bg-p1-page p-8 text-p1-text'>
      <h1 className='text-xl font-semibold'>Something went wrong</h1>
      <p className='mt-2 max-w-md text-sm text-p1-muted'>This page failed to load.</p>
      <Link to='/phase1' className='mt-4 inline-block text-sm text-p1-accent hover:underline'>
        Back to campaigns
      </Link>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Phase1Shell />,
    errorElement: <Phase1RouteError />,
    children: [
      { path: '/', Component: Phase1AuthCallback },
      { path: '/phase1', Component: Phase1IndexPage },
      { path: '/phase1/account', Component: Phase1AccountPage },
      { path: '/phase1/homebrew', Component: Phase1HomebrewPage },
      { path: '/phase1/admin', Component: Phase1AdminPage },
      { path: '/phase1/admin/view/:characterId', Component: Phase1AdminCharacterView },
      { path: '/phase1/characters', Component: Phase1CharactersPage },
      { path: '/phase1/encounters', Component: Phase1EncountersPage },
      { path: '/phase1/encounters/:encounterId', Component: Phase1StandaloneEncounterPage },
      { path: '/phase1/campaign/:campaignId', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/encounters/:encounterId', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/notes/:noteIndex', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/settings', Component: Phase1CampaignPage },
      { path: '/sheet/:characterId', Component: Phase1SheetPage },
      { path: '/builder/:characterId', Component: Phase1BuilderPage },
      { path: '/stat-block/:type/:id', Component: Phase1StatBlockPage },
      { path: '/tactics/:campaignId/:encounterId', Component: TacticsPage },
      { path: '*', Component: Phase1NotFound },
    ],
  },
]);

export function Phase1App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
