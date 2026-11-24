import { zodResolver } from '@hookform/resolvers/zod';
import {
  hasPermission,
  toDisplayError,
  useReviewWholesale,
  useSession,
  useWholesaleApplications,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import type { WholesaleApplicationStatus } from '@marketplace/shared-types';
import {
  Badge,
  Button,
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
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@marketplace/ui';
import type { WholesaleApplicationDto } from '@marketplace/validation';
import { BuildingIcon, CheckIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;
const STATUS_BADGE: Record<
  WholesaleApplicationStatus,
  { label: string; variant: 'secondary' | 'success' | 'destructive' }
> = {
  PENDING: { label: 'Pending', variant: 'secondary' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
};

const rejectSchema = z.object({
  note: z.string().trim().min(5, 'Tell the customer why (at least 5 characters)').max(500),
});

function RejectDialog({ application }: { application: WholesaleApplicationDto }) {
  const review = useReviewWholesale();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof rejectSchema>>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { note: '' },
  });
  const submit = form.handleSubmit(async ({ note }) => {
    setFormError(null);
    try {
      await review.mutateAsync({ id: application.id, body: { decision: 'REJECT', note } });
      toast.success('Application rejected', {
        description: 'The customer was emailed the reason.',
      });
      setOpen(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <XIcon /> Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {application.businessName}?</DialogTitle>
          <DialogDescription>
            The customer keeps retail access and can correct their details and apply again.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FormAlert message={formError} />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormDescription>
                    Sent to the customer by email and shown in their account.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={review.isPending}>Reject application</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewActions({ application }: { application: WholesaleApplicationDto }) {
  const review = useReviewWholesale();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ConfirmDialog
        trigger={
          <Button size="sm">
            <CheckIcon /> Approve
          </Button>
        }
        title={`Approve ${application.businessName}?`}
        description={`${application.applicant.firstName} ${application.applicant.lastName} gets wholesale prices immediately and is notified by email.`}
        confirmLabel="Approve"
        onConfirm={async () => {
          try {
            await review.mutateAsync({ id: application.id, body: { decision: 'APPROVE' } });
            toast.success('Wholesale access granted');
          } catch (error) {
            showError('Could not approve the application', error);
            throw error;
          }
        }}
      />
      <RejectDialog application={application} />
    </div>
  );
}

export function WholesalePage() {
  const session = useSession();
  const canReview = hasPermission(session.data, 'wholesale.review');
  const [status, setStatus] = useState<WholesaleApplicationStatus>('PENDING');
  const [page, setPage] = useState(1);
  const applications = useWholesaleApplications({ status, page, pageSize: PAGE_SIZE });

  const columns: DataTableColumn<WholesaleApplicationDto>[] = [
    {
      id: 'business',
      header: 'Business',
      cell: (a) => (
        <div className="min-w-0">
          <p className="font-medium">{a.businessName}</p>
          <p className="text-xs text-muted-foreground">{a.businessAddress}</p>
        </div>
      ),
    },
    { id: 'tin', header: 'TIN', className: 'tabular-nums', cell: (a) => a.tin },
    {
      id: 'applicant',
      header: 'Applicant',
      hideOnMobile: true,
      cell: (a) => (
        <div className="min-w-0">
          <p>
            {a.applicant.firstName} {a.applicant.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{a.applicant.email}</p>
        </div>
      ),
    },
    {
      id: 'submitted',
      header: 'Submitted',
      hideOnMobile: true,
      cell: (a) => formatDateTime(a.createdAt),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (a) => (
        <div className="space-y-1">
          <Badge variant={STATUS_BADGE[a.status].variant}>{STATUS_BADGE[a.status].label}</Badge>
          {a.reviewNote ? (
            <p className="max-w-56 text-xs text-muted-foreground">{a.reviewNote}</p>
          ) : null}
        </div>
      ),
    },
    ...(canReview && status === 'PENDING'
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (a: WholesaleApplicationDto) => <ReviewActions application={a} />,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wholesale approvals"
        description="Customers who asked for wholesale prices. They shop at retail prices until approved. Oldest pending applications are listed first."
      />
      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value as WholesaleApplicationStatus);
          setPage(1);
        }}
      >
        <TabsList aria-label="Application status">
          <TabsTrigger value="PENDING">Pending</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        label="Wholesale applications"
        columns={columns}
        rows={applications.data?.items}
        getRowId={(a) => a.id}
        isLoading={applications.isPending}
        error={toDisplayError(applications.error)}
        onRetry={() => void applications.refetch()}
        empty={{
          icon: BuildingIcon,
          title: status === 'PENDING' ? 'No applications waiting' : 'Nothing here yet',
          description:
            status === 'PENDING'
              ? 'New applications appear here as customers submit them.'
              : undefined,
        }}
        pagination={
          applications.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: applications.data.totalItems,
                onPageChange: setPage,
                isFetching: applications.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
