import {
  keepPreviousData,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  DevSampleJobRequest,
  DevTestEmailRequest,
  JobStatusResponse,
} from '@marketplace/validation';
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
  session: ['session'] as const,
  account: {
    wholesale: ['account', 'wholesale-application'] as const,
  },
  admin: {
    all: ['admin'] as const,
    users: (query: object) => ['admin', 'users', query] as const,
    user: (id: string) => ['admin', 'user', id] as const,
    roles: ['admin', 'roles'] as const,
    wholesale: (query: object) => ['admin', 'wholesale', query] as const,
    auditLogs: (query: object) => ['admin', 'audit-logs', query] as const,
  },
  dev: {
    all: ['dev'] as const,
    smsOutbox: ['dev', 'sms-outbox'] as const,
    queues: ['dev', 'queues'] as const,
    job: (queue: string, jobId: string) => ['dev', 'job', queue, jobId] as const,
    deadLetters: (page: number, pageSize: number) =>
      ['dev', 'dead-letters', page, pageSize] as const,
    files: (page: number, pageSize: number) => ['dev', 'files', page, pageSize] as const,
  },
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

// ---- Developer tools (development only) -------------------------------------

const TERMINAL_JOB_STATES: JobStatusResponse['state'][] = ['completed', 'failed'];

/** Queue counts, refreshed every 5 seconds. */
export function useQueueStats() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dev.queues,
    queryFn: ({ signal }) => client.devTools.queueStats(signal),
    refetchInterval: 5_000,
  });
}

/** Polls a job every second until it completes or fails permanently. */
export function useJobStatus(queue: string | undefined, jobId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dev.job(queue ?? '', jobId ?? ''),
    queryFn: ({ signal }) => client.devTools.getJob(queue!, jobId!, signal),
    enabled: Boolean(queue && jobId),
    // Between retries BullMQ reports "delayed"; "failed" only once retries are exhausted.
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state && TERMINAL_JOB_STATES.includes(state) ? false : 1_000;
    },
  });
}

export function useDeadLetters(page: number, pageSize: number) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dev.deadLetters(page, pageSize),
    queryFn: ({ signal }) => client.devTools.listDeadLetters(page, pageSize, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
}

export function useDevFiles(page: number, pageSize: number) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dev.files(page, pageSize),
    queryFn: ({ signal }) => client.devTools.listFiles(page, pageSize, signal),
    placeholderData: keepPreviousData,
  });
}

function useDevMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.dev.all }),
  });
}

export function useEnqueueSampleJob() {
  const client = useApiClient();
  return useDevMutation((body: DevSampleJobRequest) => client.devTools.enqueueSampleJob(body));
}

export function useEnqueueTestEmail() {
  const client = useApiClient();
  return useDevMutation((body: DevTestEmailRequest) => client.devTools.enqueueTestEmail(body));
}

export function useRetryDeadLetter() {
  const client = useApiClient();
  return useDevMutation((id: string) => client.devTools.retryDeadLetter(id));
}

export function useDiscardDeadLetter() {
  const client = useApiClient();
  return useDevMutation((id: string) => client.devTools.discardDeadLetter(id));
}

export function useUploadDevFile() {
  const client = useApiClient();
  return useDevMutation((file: File) => client.devTools.uploadFile(file));
}

export function useDeleteDevFile() {
  const client = useApiClient();
  return useDevMutation((id: string) => client.devTools.deleteFile(id));
}
