import { zodResolver } from '@hookform/resolvers/zod';
import {
  toDisplayError,
  useDeadLetters,
  useDiscardDeadLetter,
  useEnqueueSampleJob,
  useEnqueueTestEmail,
  useQueueStats,
  useRetryDeadLetter,
} from '@marketplace/api-client';
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
} from '@marketplace/ui';
import {
  type DeadLetterEntry,
  DEV_SAMPLE_MAX_SIMULATED_FAILURES,
  devSampleJobRequestSchema,
  devTestEmailRequestSchema,
  type EnqueuedJobResponse,
  type QueueStats,
} from '@marketplace/validation';
import {
  ExternalLinkIcon,
  InboxIcon,
  MailIcon,
  PlayIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { JobStatusPanel } from '../../components/job-status-panel';
import { MAILPIT_URL } from '../../lib/env';
import { formatDateTime, formatDuration } from '../../lib/format';

const DEAD_LETTER_PAGE_SIZE = 10;

function showError(title: string, error: unknown) {
  const display = toDisplayError(error);
  toast.error(title, {
    description: display?.requestId
      ? `${display.message} (ref ${display.requestId})`
      : display?.message,
  });
}

function SampleJobCard() {
  const enqueue = useEnqueueSampleJob();
  const [job, setJob] = useState<EnqueuedJobResponse | null>(null);
  const form = useForm({
    resolver: zodResolver(devSampleJobRequestSchema),
    defaultValues: {
      message: 'Hello from the Admin Console',
      simulateFailures: 0,
      durationMs: 1500,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await enqueue.mutateAsync(values);
      setJob(result);
      toast.success('Sample job queued', {
        description: `Job ${result.jobId} on the ${result.queue} queue.`,
      });
    } catch (error) {
      showError('Could not queue the job', error);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run the sample job</CardTitle>
        <CardDescription>
          Queues a development-only job on the <code>system</code> queue. Simulated failures show
          retries with exponential backoff; failing every attempt sends it to the dead-letter queue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid items-start gap-4 sm:grid-cols-2" noValidate>
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>Echoed back in the job result.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="simulateFailures"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Simulated failures</FormLabel>
                  <Select value={String(field.value)} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Array.from({ length: DEV_SAMPLE_MAX_SIMULATED_FAILURES + 1 }, (_, n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n === 0
                            ? 'None (succeeds first time)'
                            : `Fail the first ${n} attempt${n > 1 ? 's' : ''}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>The system queue allows 3 attempts.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="durationMs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work duration (ms)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10000}
                      step={100}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value as number | string}
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  </FormControl>
                  <FormDescription>Simulated processing time, up to 10 seconds.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Spinner className="text-current" /> : <PlayIcon />}
                Run job
              </Button>
            </div>
          </form>
        </Form>
        {job ? <JobStatusPanel key={job.jobId} queue={job.queue} jobId={job.jobId} /> : null}
      </CardContent>
    </Card>
  );
}

function TestEmailCard() {
  const enqueue = useEnqueueTestEmail();
  const [job, setJob] = useState<EnqueuedJobResponse | null>(null);
  const form = useForm({
    resolver: zodResolver(devTestEmailRequestSchema),
    defaultValues: { to: 'developer@marketplace.local' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await enqueue.mutateAsync(values);
      setJob(result);
      toast.success('Test email queued', {
        description: `Job ${result.jobId} on the email queue.`,
      });
    } catch (error) {
      showError('Could not queue the email', error);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a test email</CardTitle>
        <CardDescription>
          Goes through the <code>email</code> queue and SMTP. Locally every email lands in Mailpit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-4 sm:flex-row sm:items-start"
            noValidate
          >
            <FormField
              control={form.control}
              name="to"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>Recipient</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="sm:mt-[22px]" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Spinner className="text-current" /> : <MailIcon />}
              Send test email
            </Button>
          </form>
        </Form>
        {job ? <JobStatusPanel key={job.jobId} queue={job.queue} jobId={job.jobId} /> : null}
        <Button asChild variant="link" className="h-auto p-0">
          <a href={MAILPIT_URL} target="_blank" rel="noreferrer">
            Open Mailpit inbox <ExternalLinkIcon />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

const QUEUE_COLUMNS: DataTableColumn<QueueStats>[] = [
  {
    id: 'name',
    header: 'Queue',
    cell: (queue) => (
      <div>
        <p className="font-medium">{queue.name}</p>
        <p className="hidden text-xs text-muted-foreground lg:block">{queue.description}</p>
      </div>
    ),
  },
  {
    id: 'policy',
    header: 'Retry policy',
    hideOnMobile: true,
    cell: (queue) =>
      queue.name === 'dead-letter'
        ? 'Kept until retried or discarded'
        : `${queue.attempts} attempts, backoff from ${formatDuration(queue.backoffDelayMs)}`,
  },
  {
    id: 'waiting',
    header: 'Waiting',
    className: 'text-right tabular-nums',
    cell: (q) => q.counts.waiting,
  },
  {
    id: 'active',
    header: 'Active',
    className: 'text-right tabular-nums',
    cell: (q) => q.counts.active,
  },
  {
    id: 'delayed',
    header: 'Delayed',
    className: 'text-right tabular-nums',
    hideOnMobile: true,
    cell: (q) => q.counts.delayed,
  },
  {
    id: 'completed',
    header: 'Completed',
    className: 'text-right tabular-nums',
    hideOnMobile: true,
    cell: (q) => q.counts.completed,
  },
  {
    id: 'failed',
    header: 'Failed',
    className: 'text-right tabular-nums',
    cell: (q) => q.counts.failed,
  },
];

function QueuesCard() {
  const stats = useQueueStats();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Queues</CardTitle>
        <CardDescription>Live job counts, refreshed every 5 seconds.</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          label="Queues"
          columns={QUEUE_COLUMNS}
          rows={stats.data?.queues}
          getRowId={(queue) => queue.name}
          isLoading={stats.isPending}
          error={toDisplayError(stats.error)}
          onRetry={() => void stats.refetch()}
          empty={{ title: 'No queues configured' }}
        />
      </CardContent>
    </Card>
  );
}

function DeadLetterActions({ entry }: { entry: DeadLetterEntry }) {
  const retry = useRetryDeadLetter();
  const discard = useDiscardDeadLetter();
  return (
    <div className="flex justify-end gap-1">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            Details
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Dead letter {entry.id}</DialogTitle>
            <DialogDescription>
              {entry.jobName} from the {entry.sourceQueue} queue failed after {entry.attemptsMade}{' '}
              attempt(s) on {formatDateTime(entry.failedAt)}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="font-medium">Last error</p>
            <p className="rounded-md bg-muted p-3 text-destructive">{entry.failedReason}</p>
            <p className="font-medium">Payload</p>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(entry.data, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm" aria-label={`Retry ${entry.id}`}>
            <RotateCcwIcon />
            <span className="hidden sm:inline">Retry</span>
          </Button>
        }
        title="Retry this job?"
        description={`The original ${entry.jobName} job is queued again on the ${entry.sourceQueue} queue with the same payload, and removed from the dead-letter queue.`}
        confirmLabel="Retry job"
        onConfirm={async () => {
          try {
            const result = await retry.mutateAsync(entry.id);
            toast.success('Job re-queued', {
              description: `New job ${result.jobId} on ${result.queue}.`,
            });
          } catch (error) {
            showError('Retry failed', error);
            throw error;
          }
        }}
      />
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm" aria-label={`Discard ${entry.id}`}>
            <Trash2Icon className="text-destructive" />
          </Button>
        }
        title="Discard this dead letter?"
        description="The failed job and its payload are deleted permanently. This cannot be undone."
        confirmLabel="Discard"
        destructive
        onConfirm={async () => {
          try {
            await discard.mutateAsync(entry.id);
            toast.success('Dead letter discarded');
          } catch (error) {
            showError('Discard failed', error);
            throw error;
          }
        }}
      />
    </div>
  );
}

const DEAD_LETTER_COLUMNS: DataTableColumn<DeadLetterEntry>[] = [
  {
    id: 'job',
    header: 'Job',
    cell: (entry) => (
      <div>
        <p className="font-medium">{entry.jobName}</p>
        <p className="text-xs text-muted-foreground">
          {entry.sourceQueue} · #{entry.sourceJobId}
        </p>
      </div>
    ),
  },
  {
    id: 'error',
    header: 'Last error',
    hideOnMobile: true,
    cell: (entry) => <span className="line-clamp-2 text-sm">{entry.failedReason}</span>,
  },
  {
    id: 'attempts',
    header: 'Attempts',
    hideOnMobile: true,
    className: 'tabular-nums',
    cell: (entry) => <Badge variant="outline">{entry.attemptsMade}</Badge>,
  },
  {
    id: 'failedAt',
    header: 'Failed at',
    hideOnMobile: true,
    cell: (entry) => formatDateTime(entry.failedAt),
  },
  {
    id: 'actions',
    header: <span className="sr-only">Actions</span>,
    cell: (entry) => <DeadLetterActions entry={entry} />,
  },
];

function DeadLettersCard() {
  const [page, setPage] = useState(1);
  const deadLetters = useDeadLetters(page, DEAD_LETTER_PAGE_SIZE);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dead-letter queue</CardTitle>
        <CardDescription>
          Jobs that failed every attempt. Inspect the error, then retry or discard them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          label="Dead letters"
          columns={DEAD_LETTER_COLUMNS}
          rows={deadLetters.data?.items}
          getRowId={(entry) => entry.id}
          isLoading={deadLetters.isPending}
          error={toDisplayError(deadLetters.error)}
          onRetry={() => void deadLetters.refetch()}
          empty={{
            icon: InboxIcon,
            title: 'No dead letters',
            description: 'Every job has either succeeded or is still being retried.',
          }}
          pagination={
            deadLetters.data
              ? {
                  page,
                  pageSize: DEAD_LETTER_PAGE_SIZE,
                  totalItems: deadLetters.data.totalItems,
                  onPageChange: setPage,
                  isFetching: deadLetters.isFetching,
                }
              : undefined
          }
        />
      </CardContent>
    </Card>
  );
}

export function JobsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Admin Console', to: '/' },
          { label: 'Developer tools', to: '/dev-tools' },
          { label: 'Background jobs' },
        ]}
      />
      <PageHeader
        title="Background jobs"
        description="Development only. Proves the queue, worker, retry and dead-letter pipeline end to end."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <SampleJobCard />
        <TestEmailCard />
      </div>
      <QueuesCard />
      <DeadLettersCard />
    </div>
  );
}
