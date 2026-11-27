import '@fontsource-variable/inter';
import './styles.css';
import { initBrowserErrorReporting } from '@marketplace/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppProviders } from './app/providers';
import { routes } from './app/routes';

const router = createBrowserRouter(routes);

initBrowserErrorReporting({
  app: 'admin',
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
  release: import.meta.env.VITE_APP_VERSION,
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
