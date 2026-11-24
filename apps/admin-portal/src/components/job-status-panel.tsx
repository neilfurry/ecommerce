import { toDisplayError, useJobStatus } from '@marketplace/api-client';
import { Badge, type BadgeProps, ErrorState, Progress, Spinner } from '@marketplace/ui';
import type { JobState } from '@marketplace/validation';
import { formatDateTime } from '../lib/format';

const STATE_BADGE: Record<JobState, { label: string; variant: BadgeProps['variant'] }> = {
  waiting: { label: 'Waiting', variant: 'secondary' },
  'waiting-children': { label: 'Waiting', variant: 'secondary' },
  prioritized: { label: 'Queued', variant: 'secondary' },
  delayed: { label: 'Retrying soon', variant: 'warning' },
  active: { label: 'Running', variant: 'default' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  unknown: { label: 'Unknown', variant: 'outline' },
};

/** Live status of one job: polls every second until it completes or fails permanently. */
export function JobStatusPanel({ queue, jobId }: { queue: string; jobId: string }) {
  const job = useJobStatus(queue, jobId);

  if (job.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading job {jobId}…
      </p>
    );
  }
  if (!job.data) {
    const error = toDisplayError(job.error);
    return (
      <ErrorState
        title="Could not load job"
        message={error?.message ?? 'Unknown error'}
        requestId={error?.requestId}
      />
    );
  }

  const data = job.data;
  const badge = STATE_BADGE[data.state];
  return (
    <div
      className="space-y-3 rounded-lg border bg-muted/30 p-4"
      data-testid="job-status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          Job <code className="font-mono">{data.jobId}</code>
        </span>
        <span className="text-muted-foreground">on {data.queue}</span>
        <Badge variant={badge.variant} data-testid="job-state">
          {badge.label}
        </Badge>
        <span className="text-muted-foreground">
          Attempt{' '}
          {Math.min(data.attemptsMade + (data.state === 'active' ? 1 : 0), data.maxAttempts) || 1}{' '}
          of {data.maxAttempts}
        </span>
      </div>
      <Progress value={data.progress} label="Job progress" />
      {data.failedReason ? (
        <p className="text-sm text-destructive">Last error: {data.failedReason}</p>
      ) : null}
      {data.state === 'failed' ? (
        <p className="text-sm text-muted-foreground">
          All attempts failed; the job was moved to the dead-letter queue below.
        </p>
      ) : null}
      {data.returnValue !== null ? (
        <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
          {JSON.stringify(data.returnValue, null, 2)}
        </pre>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Created {formatDateTime(data.createdAt)}
        {data.finishedAt ? ` · finished ${formatDateTime(data.finishedAt)}` : ''}
      </p>
    </div>
  );
}
