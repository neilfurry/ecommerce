import { QueryClient, useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './client';
import { ApiError } from './errors';

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  client: ApiClient;
  children: ReactNode;
}) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error('useApiClient must be used inside <ApiClientProvider>.');
  return client;
}

/** Central query-key factory: keeps cache keys consistent for invalidation. */
export const queryKeys = {
  health: ['health'] as const,
};

/** Shared TanStack Query defaults for all three frontends. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Never retry 4xx: the request is wrong, not the network.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.isClientError) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  });
}

export const HEALTH_REFRESH_INTERVAL_MS = 15_000;

/** Live system health, refreshed every 15 seconds while the page is open. */
export function useSystemHealth() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => client.health.get(signal),
    refetchInterval: HEALTH_REFRESH_INTERVAL_MS,
    staleTime: 5_000,
  });
}

/** Normalises any thrown value into what error components display. */
export function toDisplayError(error: unknown): { message: string; requestId?: string } | null {
  if (!error) return null;
  if (error instanceof ApiError) return { message: error.message, requestId: error.requestId };
  return { message: 'Something unexpected happened. Please try again.' };
}
