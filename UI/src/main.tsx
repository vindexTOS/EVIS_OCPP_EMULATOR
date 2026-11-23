import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/scene.css';
import './styles/panels.css';
import App from './App.tsx';
import { AuthGate } from './auth/AuthGate.tsx';
import { DragProvider } from './dnd/DragProvider.tsx';
import { LiveProvider } from './lib/live.tsx';
import { theme } from './theme.ts';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {/* Top centre: clear of the garage dock below and of the switches on the right. */}
      <Notifications position="top-center" limit={3} containerWidth={380} />
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <BrowserRouter>
            <LiveProvider>
              <DragProvider>
                <App />
              </DragProvider>
            </LiveProvider>
          </BrowserRouter>
        </AuthGate>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
