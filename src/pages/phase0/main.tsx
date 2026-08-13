import { sessionState } from '@atoms/supabaseAtoms';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { supabase } from '../../supabase-client';
import { Component, CampaignComponent } from './Phase0CampaignPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  {
    path: '/phase0',
    Component,
  },
  {
    path: '/phase0/campaign/:campaignId',
    Component: CampaignComponent,
    loader: async ({ params }) => ({ campaignId: params.campaignId }),
  },
  {
    path: '/phase0/campaign/:campaignId/encounters/:encounterId',
    Component: CampaignComponent,
    loader: async ({ params }) => ({ campaignId: params.campaignId, encounterId: params.encounterId }),
  },
]);

function Phase0Root() {
  const setSession = useSetAtom(sessionState);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active) setSession(session);
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [setSession]);

  if (!authReady) {
    return (
      <div className='min-h-screen bg-slate-950 p-6 text-sm text-slate-400'>
        Loading your session...
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MantineProvider forceColorScheme='dark'>
      <QueryClientProvider client={queryClient}>
        <Phase0Root />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>
);
