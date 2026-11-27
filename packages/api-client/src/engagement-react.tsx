import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from './react';

type Engagement = ReturnType<typeof useApiClient>['engagement'];

/** Query keys of the Phase 7 screens: everything lives under 'engagement'. */
export const engagementKeys = {
  all: ['engagement'] as const,
  of: (...parts: unknown[]) => ['engagement', ...parts] as const,
};

/** A Phase 7 read (campaigns, loyalty, tickets, reports...). */
export function useEngagement<T>(
  parts: readonly unknown[],
  fn: (e: Engagement, signal?: AbortSignal) => Promise<T>,
  options: { enabled?: boolean; refetchInterval?: number } = {},
) {
  const client = useApiClient();
  return useQuery({
    queryKey: engagementKeys.of(...parts),
    queryFn: ({ signal }) => fn(client.engagement, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

/**
 * Runs one Phase 7 action and refreshes the engagement views, plus carts, checkout and orders
 * (promotions and points change what checkout shows).
 */
export function useEngagementAction<TResult = unknown>() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, (e: Engagement) => Promise<TResult>>({
    mutationFn: (run) => run(client.engagement),
    onSuccess: () =>
      Promise.all(
        [engagementKeys.all, ['shop'], ['seller'], ['admin'], ['account']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** Saves a downloaded report or attachment in the browser. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
