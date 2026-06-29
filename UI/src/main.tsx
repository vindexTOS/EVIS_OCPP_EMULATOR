import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import App from './App.tsx';
import { AuthGate } from './auth/AuthGate.tsx';
import { LiveProvider } from './lib/live.tsx';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto">
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <BrowserRouter>
            <LiveProvider>
              <App />
            </LiveProvider>
          </BrowserRouter>
        </AuthGate>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
