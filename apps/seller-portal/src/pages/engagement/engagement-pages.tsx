import {
  hasPermission,
  toDisplayError,
  useEngagement,
  useEngagementAction,
  useMyProducts,
  useSession,
} from '@marketplace/api-client';
import { CampaignManager, ReportsDashboard, TicketList, TicketThread } from '@marketplace/auth-ui';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  PageHeader,
  Textarea,
  toast,
} from '@marketplace/ui';
import type { AdminReviewDto } from '@marketplace/validation';
import { MessageSquareIcon } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;
const TABS = [
  { name: 'sales', label: 'Sales' },
  { name: 'products', label: 'Products' },
  { name: 'inventory', label: 'Inventory' },
  { name: 'ratings', label: 'Customer ratings' },
  { name: 'commissions', label: 'Commission deductions' },
  { name: 'settlements', label: 'Settlements' },
];

/** Seller analytics: sales, products, inventory, ratings, commission and settlements. */
export function SellerReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Live figures for your business. Dates are Philippine time."
      />
      <ReportsDashboard scope="seller" tabs={TABS} />
    </div>
  );
}

/** Store-funded automatic promotions. */
export function SellerCampaignsPage() {
  const session = useSession();
  const canManage =
    hasPermission(session.data, 'seller.marketing.manage') &&
    session.data?.user.seller?.status === 'VERIFIED';
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE };
  const campaigns = useEngagement(['seller', 'campaigns', query], (e, s) =>
    e.seller.campaigns(query, s),
  );
  const products = useMyProducts({ page: 1, pageSize: 100 });
  const action = useEngagementAction();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Automatic deals on your items: bundles, buy 1 take 1, percent or amount off and free shipping. Your business pays these discounts."
      />
      <CampaignManager
        campaigns={campaigns}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        canManage={canManage}
        fundedBy="your business"
        targets={{
          products: (products.data?.items ?? []).map((p) => ({ id: p.id, name: p.name })),
        }}
        mutations={{
          create: (body) => action.mutateAsync((e) => e.seller.createCampaign(body)),
          update: (id, body) => action.mutateAsync((e) => e.seller.updateCampaign(id, body)),
          pending: action.isPending,
        }}
      />
    </div>
  );
}

function ReplyDialog({ review, onClose }: { review: AdminReviewDto; onClose: () => void }) {
  const [body, setBody] = useState(review.sellerReply?.body ?? '');
  const action = useEngagementAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    action.mutate((api) => api.seller.reply(review.id, { body }), {
      onSuccess: () => {
        toast.success('Reply posted');
        onClose();
      },
      onError: (error) => showError('Could not post the reply', error),
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reply to {review.authorName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <p className="rounded bg-muted p-2 text-sm">{review.body ?? `${review.rating} stars`}</p>
          <Label htmlFor="reply-body">Your public reply</Label>
          <Textarea
            id="reply-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
          />
          <Button type="submit" disabled={action.isPending || body.trim().length < 2}>
            Post reply
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reviews of my products, with replies, and my seller rating. */
export function SellerReviewsPage() {
  const session = useSession();
  const canReply = hasPermission(session.data, 'seller.reviews.reply');
  const [page, setPage] = useState(1);
  const [unanswered, setUnanswered] = useState(false);
  const [replying, setReplying] = useState<AdminReviewDto | null>(null);
  const query = { page, pageSize: PAGE_SIZE, ...(unanswered ? { replied: 'false' } : {}) };
  const reviews = useEngagement(
    ['seller', 'reviews', query],
    (e, s) => e.seller.reviews(query, s),
    { enabled: canReply },
  );
  const ratings = useEngagement(['seller', 'ratings'], (e, s) => e.seller.ratings(s));
  const columns: DataTableColumn<AdminReviewDto>[] = [
    {
      id: 'review',
      header: 'Review',
      cell: (r) => (
        <div className="max-w-md space-y-1">
          <p className="text-amber-500" aria-label={`${r.rating} out of 5 stars`}>
            {'★'.repeat(r.rating)}
            <span className="text-muted-foreground/40">{'★'.repeat(5 - r.rating)}</span>
          </p>
          {r.body ? <p className="text-sm">{r.body}</p> : null}
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
            <p className="rounded bg-muted p-2 text-xs">You replied: {r.sellerReply.body}</p>
          ) : null}
        </div>
      ),
    },
    { id: 'product', header: 'Product', hideOnMobile: true, cell: (r) => r.product.name },
    { id: 'date', header: 'Date', hideOnMobile: true, cell: (r) => formatDateTime(r.createdAt) },
    {
      id: 'verified',
      header: 'Purchase',
      hideOnMobile: true,
      cell: (r) =>
        r.verifiedPurchase ? (
          <Badge variant="success">Verified</Badge>
        ) : (
          <Badge variant="outline">Not delivered yet</Badge>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (r) =>
        canReply ? (
          <Button size="sm" variant="outline" onClick={() => setReplying(r)}>
            {r.sellerReply ? 'Edit reply' : 'Reply'}
          </Button>
        ) : null,
    },
  ];
  const summary = ratings.data?.summary;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews and ratings"
        description="What customers say about your products and your service (from delivered orders)."
      />
      {summary ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Seller rating: {summary.count > 0 ? `${summary.overall} ★` : 'no ratings yet'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-4">
            <p>Product quality: {summary.productQuality}</p>
            <p>Shipping: {summary.shippingSpeed}</p>
            <p>Communication: {summary.communication}</p>
            <p>
              {summary.count} rating(s) from {summary.deliveredOrders} delivered order(s)
            </p>
          </CardContent>
        </Card>
      ) : null}
      {canReply ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unanswered}
              onChange={(e) => {
                setUnanswered(e.target.checked);
                setPage(1);
              }}
            />
            Without a reply only
          </label>
          <DataTable
            label="Reviews"
            columns={columns}
            rows={reviews.data?.items}
            getRowId={(r) => r.id}
            isLoading={reviews.isPending}
            error={toDisplayError(reviews.error)}
            empty={{ icon: MessageSquareIcon, title: 'No reviews yet' }}
            pagination={
              reviews.data
                ? {
                    page,
                    pageSize: PAGE_SIZE,
                    totalItems: reviews.data.totalItems,
                    onPageChange: setPage,
                  }
                : undefined
            }
          />
        </>
      ) : null}
      {replying ? <ReplyDialog review={replying} onClose={() => setReplying(null)} /> : null}
    </div>
  );
}

export function SellerSupportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer questions"
        description="Tickets about your orders. Marketplace support may join or take over a ticket."
      />
      <TicketList scope="seller" basePath="/support" />
    </div>
  );
}

export function SellerTicketPage() {
  const { ticketId } = useParams();
  return (
    <div className="space-y-6">
      <PageHeader title="Ticket" />
      <TicketThread scope="seller" ticketId={ticketId!} />
    </div>
  );
}
