import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Phase1CampaignPage, Phase1IndexPage } from './Phase1Workspace';
import { ContentLinkProvider } from './phase1-content-links';
import { CloseStackOnNavigate, ContentStackModal } from './phase1-content-stack';
import './phase1.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

function Phase1Shell() {
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
      { path: '/phase1', Component: Phase1IndexPage },
      { path: '/phase1/campaign/:campaignId', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/encounters/:encounterId', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/notes/:noteIndex', Component: Phase1CampaignPage },
      { path: '/phase1/campaign/:campaignId/settings', Component: Phase1CampaignPage },
    ],
  },
]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
