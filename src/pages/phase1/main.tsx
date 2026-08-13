import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Phase1CampaignPage, Phase1IndexPage } from './Phase1Workspace';
import './phase1.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});
const router = createBrowserRouter([
  { path: '/phase1', Component: Phase1IndexPage },
  { path: '/phase1/campaign/:campaignId', Component: Phase1CampaignPage },
  { path: '/phase1/campaign/:campaignId/encounters/:encounterId', Component: Phase1CampaignPage },
]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>
);