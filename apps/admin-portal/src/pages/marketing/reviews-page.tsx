import {
  toDisplayError,
  useAdminReviews,
  useEngagementAction,
  useModerateReview,
} from '@marketplace/api-client';
import { REVIEW_STATUSES, type ReviewStatus } from '@marketplace/shared-types';
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@marketplace/ui';
import type { AdminReviewDto } from '@marketplace/validation';
import { StarIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { ReasonDialog } from '../../components/reason-dialog';
import { formatDateTime } from '../../lib/format';
import { showError } from '../../lib/errors';

const PAGE_SIZE = 25;
const STATUS_LABELS: Record<ReviewStatus, string> = { PUBLISHED: 'Published', HIDDEN: 'Hidden' };

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} className="whitespace-nowrap text-amber-500">
      {'★'.repeat(rating)}
      <span className="text-muted-foreground/40">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

/** Customer reviews: hide abusive or off-topic ones, publish them again. */
export function ReviewsPage() {
  const [status, setStatus] = useState<ReviewStatus | 'ALL'>('ALL');
  const [rating, setRating] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reported, setReported] = useState(false);
  const resolve = useEngagementAction();
  const deferred = useDeferredValue(search.trim());
  const reviews = useAdminReviews({
    status: status === 'ALL' ? undefined : status,
    rating: rating === 'ALL' ? undefined : Number(rating),
    search: deferred || undefined,
    ...(reported ? { reported: 'true' } : {}),
    page,
    pageSize: PAGE_SIZE,
  });
  const moderate = useModerateReview();

  const columns: DataTableColumn<AdminReviewDto>[] = [
    {
      id: 'review',
      header: 'Review',
      cell: (r) => (
        <div className="max-w-md space-y-1">
          <Stars rating={r.rating} />
          {r.title ? <p className="font-medium">{r.title}</p> : null}
          {r.body ? <p className="text-sm whitespace-pre-line">{r.body}</p> : null}
          {r.images.length > 0 ? (
            <div className="flex gap-1">
              {r.images.map((i) => (
                <img
                  key={i.id}
                  src={i.url}
                  alt="Customer photo"
                  className="size-12 rounded object-cover"
                />
              ))}
            </div>
          ) : null}
          {r.sellerReply ? (
            <p className="rounded bg-muted p-2 text-xs">Seller reply: {r.sellerReply.body}</p>
          ) : null}
          {r.openReports > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">{r.openReports} open report(s)</Badge>
              <ReasonDialog
                trigger={
                  <Button size="sm" variant="outline">
                    Uphold
                  </Button>
                }
                title="Uphold the reports?"
                description="The review is hidden and its open reports are closed."
                label="Reason (kept for staff)"
                submitLabel="Hide review"
                onSubmit={async (note) => {
                  await resolve.mutateAsync((e) =>
                    e.admin.resolveReviewReports(r.id, { action: 'UPHOLD', note }),
                  );
                  toast.success('Reports upheld; review hidden');
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  resolve.mutate((e) => e.admin.resolveReviewReports(r.id, { action: 'DISMISS' }), {
                    onSuccess: () => toast.success('Reports dismissed'),
                    onError: (error) => showError('Could not dismiss the reports', error),
                  })
                }
              >
                Dismiss
              </Button>
            </div>
          ) : null}
          {r.moderationNote ? (
            <p className="text-xs text-muted-foreground">Moderator note: {r.moderationNote}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'product',
      header: 'Product',
      hideOnMobile: true,
      cell: (r) => (
        <div>
          <p>{r.product.name}</p>
          <p className="text-xs text-muted-foreground">
            {r.variantTitle} · {r.store.name}
          </p>
        </div>
      ),
    },
    {
      id: 'author',
      header: 'By',
      hideOnMobile: true,
      cell: (r) => (
        <div>
          <p>{r.authorName}</p>
          <p className="text-xs text-muted-foreground">{r.customerEmail}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge variant={r.status === 'PUBLISHED' ? 'success' : 'secondary'}>
          {STATUS_LABELS[r.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (r) =>
        r.status === 'PUBLISHED' ? (
          <ReasonDialog
            trigger={
              <Button size="sm" variant="ghost">
                Hide
              </Button>
            }
            title="Hide this review?"
            description="It disappears from the product page and stops counting toward the rating."
            label="Reason (kept for staff)"
            submitLabel="Hide review"
            onSubmit={async (note) => {
              await moderate.mutateAsync({ id: r.id, body: { status: 'HIDDEN', note } });
              toast.success('Review hidden');
            }}
          />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              moderate.mutate(
                { id: r.id, body: { status: 'PUBLISHED' } },
                {
                  onSuccess: () => toast.success('Review published'),
                  onError: (e) => showError('Could not publish the review', e),
                },
              )
            }
          >
            Publish
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        description="Reviews from customers who received the product. Hidden reviews do not count toward ratings."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reported}
            onChange={(e) => {
              setReported(e.target.checked);
              setPage(1);
            }}
          />
          Reported only
        </label>
        <Input
          type="search"
          aria-label="Search reviews"
          placeholder="Product, store or customer"
          className="sm:w-72"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div className="sm:w-44">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as ReviewStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {REVIEW_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-40">
          <Select
            value={rating}
            onValueChange={(v) => {
              setRating(v);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Rating">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any rating</SelectItem>
              {[5, 4, 3, 2, 1].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} star{n > 1 ? 's' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        label="Reviews"
        columns={columns}
        rows={reviews.data?.items}
        getRowId={(r) => r.id}
        isLoading={reviews.isPending}
        error={toDisplayError(reviews.error)}
        onRetry={() => void reviews.refetch()}
        empty={{ icon: StarIcon, title: 'No reviews found' }}
        pagination={
          reviews.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: reviews.data.totalItems,
                onPageChange: setPage,
                isFetching: reviews.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
