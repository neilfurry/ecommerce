import type { HealthComponentName, SystemStatus } from '@marketplace/shared-types';
import type { HealthResponse } from '@marketplace/validation';
import {
  ActivityIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DatabaseIcon,
  HardDriveIcon,
  RefreshCwIcon,
  ServerCogIcon,
  XCircleIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeProps } from '../components/badge';
import { Button } from '../components/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/card';
import { Skeleton } from '../components/skeleton';
import { ErrorState } from './error-state';

const COMPONENT_LABELS: Record<HealthComponentName, { label: string; icon: LucideIcon }> = {
  database: { label: 'Database (PostgreSQL)', icon: DatabaseIcon },
  redis: { label: 'Cache & queues (Redis)', icon: ZapIcon },
  storage: { label: 'File storage (S3)', icon: HardDriveIcon },
  worker: { label: 'Background worker', icon: ServerCogIcon },
};

const STATUS_DISPLAY: Record<SystemStatus, { label: string; variant: BadgeProps['variant'] }> = {
  ok: { label: 'All systems operational', variant: 'success' },
  degraded: { label: 'Degraded performance', variant: 'warning' },
  down: { label: 'Service disruption', variant: 'destructive' },
};

export interface SystemStatusPanelProps {
  health: HealthResponse | undefined;
  isLoading: boolean;
  error: { message: string; requestId?: string } | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(totalSeconds)}s`;
}

/** Live status of the API and its dependencies, from GET /api/v1/health. */
export function SystemStatusPanel({
  health,
  isLoading,
  error,
  isRefreshing,
  onRefresh,
}: SystemStatusPanelProps) {
  if (isLoading) {
    return (
      <Card aria-busy="true" aria-label="Loading system status">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!health) {
    return (
      <ErrorState
        title="Unable to reach the API"
        message={error?.message ?? 'The status service did not respond.'}
        requestId={error?.requestId}
        onRetry={onRefresh}
        isRetrying={isRefreshing}
      />
    );
  }

  const overall = STATUS_DISPLAY[health.status];
  const checkedAt = new Date(health.timestamp);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ActivityIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          System status
          <Badge variant={overall.variant} data-testid="overall-status">
            {overall.label}
          </Badge>
        </CardTitle>
        <CardDescription>
          API v{health.version} · up {formatUptime(health.uptimeSeconds)} · checked{' '}
          <time dateTime={health.timestamp}>{checkedAt.toLocaleTimeString()}</time>
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCwIcon className={isRefreshing ? 'animate-spin' : undefined} />
            <span className="hidden sm:inline">{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
            <span className="sr-only sm:hidden">Refresh status</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="mb-3 text-sm text-destructive" role="status">
            Latest refresh failed: {error.message} Showing the previous result.
          </p>
        ) : null}
        <ul className="divide-y rounded-lg border" aria-label="Components">
          {health.components.map((component) => {
            const meta = COMPONENT_LABELS[component.name];
            const Icon = meta.icon;
            const up = component.status === 'up';
            return (
              <li
                key={component.name}
                className="flex items-start gap-3 p-3 sm:items-center"
                data-testid={`component-${component.name}`}
              >
                <Icon
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground sm:mt-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {meta.label}
                    {!component.critical ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        (non-critical)
                      </span>
                    ) : null}
                  </p>
                  {component.message ? (
                    <p className="text-xs text-muted-foreground">{component.message}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-sm">
                  {component.latencyMs !== null ? (
                    <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                      {component.latencyMs} ms
                    </span>
                  ) : null}
                  {up ? (
                    <CheckCircle2Icon className="size-5 text-success" aria-hidden="true" />
                  ) : component.critical ? (
                    <XCircleIcon className="size-5 text-destructive" aria-hidden="true" />
                  ) : (
                    <CircleAlertIcon className="size-5 text-warning" aria-hidden="true" />
                  )}
                  <span className="sr-only sm:not-sr-only sm:w-10">{up ? 'Up' : 'Down'}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
