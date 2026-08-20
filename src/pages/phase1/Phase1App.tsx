import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Phase1CampaignPage, Phase1CharactersPage, Phase1IndexPage } from './Phase1Workspace';
import { Phase1SheetPage } from './Phase1SheetPage';
import { Phase1BuilderPage } from './Phase1BuilderPage';
import { Phase1AuthCallback } from '@auth/Phase1AuthCallback';
import { ContentLinkProvider } from './phase1-content-links';
import { CloseStackOnNavigate, ContentStackModal } from './phase1-content-stack';
import { applyPhase1Theme, readStoredPhase1Theme } from './phase1-theme';
import './phase1.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

export function Phase1Shell() {
  useEffect(() => {
    applyPhase1Theme(readStoredPhase1Theme());
  }, []);
  return (
    <ContentLinkProvider>
      <CloseStackOnNavigate />
      <Outlet />
      <ContentStackModal />
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
