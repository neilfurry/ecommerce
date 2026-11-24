import { toDisplayError, useSystemHealth } from '@marketplace/api-client';
import { PageHeader, SystemStatusPanel } from '@marketplace/ui';

export function StatusPage() {
  const health = useSystemHealth();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="System status"
        description="Live availability of marketplace services. If something is down, orders and stock updates may be delayed."
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
