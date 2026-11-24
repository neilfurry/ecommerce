import { ApiClientProvider, createQueryClient, type ApiClient } from '@marketplace/api-client';
import { Toaster } from '@marketplace/ui';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { defaultApiClient } from './api';

/** App-wide providers. Tests pass their own clients to stay isolated. */
export function AppProviders({
  children,
  apiClient = defaultApiClient,
  queryClient: providedQueryClient,
}: {
  children: ReactNode;
  apiClient?: ApiClient;
  queryClient?: QueryClient;
}) {
  const [queryClient] = useState(() => providedQueryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        {children}
        <Toaster />
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
