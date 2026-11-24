import { toDisplayError, useSystemHealth } from '@marketplace/api-client';
import { PageHeader, SystemStatusPanel } from '@marketplace/ui';

export function StatusPage() {
  const health = useSystemHealth();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="System health"
        description="Live status of the API, database, cache, file storage and background worker. Refreshes every 15 seconds."
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
