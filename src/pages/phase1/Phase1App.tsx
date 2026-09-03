import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Phase1CampaignPage, Phase1CharactersPage, Phase1IndexPage } from './Phase1Workspace';
import { Phase1SheetPage } from './Phase1SheetPage';
import { Phase1StatBlockPage } from './Phase1StatBlockPage';
import { Phase1BuilderPage } from './Phase1BuilderPage';
import { Phase1AuthCallback } from '@auth/Phase1AuthCallback';
import { ContentLinkProvider } from './phase1-content-links';
import { CloseStackOnNavigate, ContentStackModal } from './phase1-content-stack';
import { getPublicUser } from '@auth/user-manager';
import { applyDisplayPrefsFromUser } from './display-prefs';
import { applyPhase1CssTheme, readStoredPhase1CssTheme } from './phase1-css-theme';
import { applyPhase1Theme, readStoredPhase1Theme } from './phase1-theme';
import { OperationErrorModalHost } from '@utils/operation-error-modal';
import './phase1.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

export function Phase1Shell() {
  useEffect(() => {
    applyPhase1Theme(readStoredPhase1Theme());
    applyPhase1CssTheme(readStoredPhase1CssTheme());
    void getPublicUser().then((user) => {
      applyDisplayPrefsFromUser(user);
      applyPhase1Theme(readStoredPhase1Theme());
      applyPhase1CssTheme(readStoredPhase1CssTheme());
    });
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

const router = createBrowserRouter([
  {
    element: <Phase1Shell />,
    children: [
      { path: '/', Component: Phase1AuthCallback },
      { path: '/phase1', Component: Phase1IndexPage },
      { path: '/phase1/characters', Component: Phase1CharactersPage },
      { path: '/phase1/campaign/:campaignId', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/encounters/:encounterId', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/notes/:noteIndex', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/settings', Component: Phase1CampaignPage },
      { path: '/sheet/:characterId', Component: Phase1SheetPage },
      { path: '/builder/:characterId', Component: Phase1BuilderPage },
      { path: '/stat-block/:type/:id', Component: Phase1StatBlockPage },
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
