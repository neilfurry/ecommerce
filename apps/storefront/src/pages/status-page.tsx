import { toDisplayError, useSystemHealth } from '@marketplace/api-client';
import { PageHeader, SystemStatusPanel } from '@marketplace/ui';

export function StatusPage() {
  const health = useSystemHealth();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <PageHeader
        title="System status"
        description="Live availability of the marketplace services. Refreshes every 15 seconds."
      />
      <SystemStatusPanel
        health={health.data}
        isLoading={health.isPending}
        error={toDisplayError(health.error)}
        isRefreshing={health.isFetching && !health.isPending}
        onRefresh={() => void health.refetch()}
      />
    </div>
  );
}
