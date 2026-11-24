import { createApiClient } from '@marketplace/api-client';

/** The browser's API client. In development Vite proxies /api to the NestJS server. */
export const defaultApiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  app: 'admin',
});
