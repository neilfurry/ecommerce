import {
  hasPermission,
  toDisplayError,
  useProductAction,
  useSellerProduct,
  useSession,
} from '@marketplace/api-client';
import { PRODUCT_STATUS_LABELS } from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@marketplace/ui';
import type { ProductDetail, ProductEventDto } from '@marketplace/validation';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  EyeIcon,
  EyeOffIcon,
  RotateCcwIcon,
  SendIcon,
} from 'lucide-react';
import { useParams } from 'react-router';
import { ProductStatusBadge } from '../../components/catalog/product-status';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { DetailsTab } from './details-tab';
import { PhotosTab } from './photos-tab';
import { PricingTab } from './pricing-tab';
import { VariantsTab } from './variants-tab';

const EVENT_LABELS: Record<ProductEventDto['type'], string> = {
  CREATED: 'Created',
  SUBMITTED: 'Submitted for approval',
  CHANGED_AFTER_APPROVAL: 'Changed after approval; back to review',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  DEACTIVATED: 'Hidden from shoppers',
  ACTIVATED: 'Shown to shoppers',
  TAKEN_DOWN: 'Taken down by the marketplace',
  ARCHIVED: 'Archived',
  RESTORED: 'Restored as a draft',
};

function StatusNotice({ product }: { product: ProductDetail }) {
  if (product.takenDown) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>Taken down by the marketplace</AlertTitle>
        <AlertDescription>
          {product.reviewNote} Fix the product; your next change sends it back for approval.
        </AlertDescription>
      </Alert>
    );
  }
  switch (product.status) {
    case 'DRAFT':
      return product.missingForSubmission.length ? (
        <Alert>
          <AlertTitle>Before you submit</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5" aria-label="Missing before submission">
              {product.missingForSubmission.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertDescription>Ready to submit for approval.</AlertDescription>
        </Alert>
      );
    case 'PENDING_APPROVAL':
      return (
        <Alert>
          <AlertTitle>Waiting for approval</AlertTitle>
          <AlertDescription>
            The marketplace team is checking this product. It is hidden from shoppers until
            approved.
          </AlertDescription>
        </Alert>
      );
    case 'REJECTED':
      return (
        <Alert variant="destructive">
          <AlertTitle>Not approved</AlertTitle>
          <AlertDescription>
            {product.reviewNote ?? 'See the history below.'} Make the changes and submit it again.
            {product.missingForSubmission.length
              ? ` Still missing: ${product.missingForSubmission.join('; ')}.`
              : ''}
          </AlertDescription>
        </Alert>
      );
    default:
      return null;
  }
}

function Actions({ product }: { product: ProductDetail }) {
  const action = useProductAction();
  const run =
    (kind: 'submit' | 'deactivate' | 'activate' | 'archive' | 'restore', done: string) =>
    async () => {
      try {
        await action.mutateAsync({ productId: product.id, action: kind });
        toast.success(done);
      } catch (error) {
        showError('That did not work', error);
        throw error;
      }
    };
  const s = product.status;
  return (
    <div className="flex flex-wrap gap-2">
      {s === 'DRAFT' || s === 'REJECTED' ? (
        <ConfirmDialog
          trigger={
            <Button disabled={product.missingForSubmission.length > 0}>
              <SendIcon /> Submit for approval
            </Button>
          }
          title="Submit for approval?"
          description="The marketplace team checks the product before shoppers can see it."
          confirmLabel="Submit"
          onConfirm={run('submit', 'Submitted for approval')}
        />
      ) : null}
      {s === 'ACTIVE' ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <EyeOffIcon /> Hide
            </Button>
          }
          title="Hide this product?"
          description="Shoppers will not see it. You can show it again without approval."
          confirmLabel="Hide"
          onConfirm={run('deactivate', 'Product hidden')}
        />
      ) : null}
      {s === 'INACTIVE' && !product.takenDown ? (
        <Button
          variant="outline"
          onClick={() => void run('activate', 'Product visible again')().catch(() => undefined)}
        >
          <EyeIcon /> Show again
        </Button>
      ) : null}
      {s !== 'ARCHIVED' ? (
        <ConfirmDialog
          trigger={
            <Button variant="ghost">
              <ArchiveIcon /> Archive
            </Button>
          }
          title="Archive this product?"
          description="It is hidden and kept for order history. You can restore it as a draft later."
          confirmLabel="Archive"
          destructive
          onConfirm={run('archive', 'Product archived')}
        />
      ) : (
        <Button
          variant="outline"
          onClick={() => void run('restore', 'Restored as a draft')().catch(() => undefined)}
        >
          <RotateCcwIcon /> Restore
        </Button>
      )}
    </div>
  );
}

export function ProductPage() {
  const { productId } = useParams();
  const session = useSession();
  const product = useSellerProduct(productId);
  if (product.isPending) return <LoadingState />;
  if (product.isError) {
    return (
      <ErrorState
        message={toDisplayError(product.error)?.message ?? 'Could not load the product.'}
        onRetry={() => void product.refetch()}
      />
    );
  }
  const p = product.data;
  const editable =
    hasPermission(session.data, 'seller.products.manage') &&
    session.data?.user.seller?.status === 'VERIFIED' &&
    p.status !== 'ARCHIVED';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Breadcrumbs items={[{ label: 'Products', to: '/products' }, { label: p.name }]} />
      <PageHeader
        title={p.name}
        description={`${p.category.path.join(' › ')} · ${p.storeName}`}
        actions={<ProductStatusBadge status={p.status} takenDown={p.takenDown} />}
      />
      <StatusNotice product={p} />
      {editable || p.status === 'ARCHIVED' ? <Actions product={p} /> : null}
      <Tabs defaultValue="details">
        <TabsList aria-label="Product sections" className="flex-wrap">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="variants">Variants ({p.variants.length})</TabsTrigger>
          <TabsTrigger value="photos">Photos ({p.images.length})</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <DetailsTab product={p} editable={editable} />
        </TabsContent>
        <TabsContent value="variants">
          <VariantsTab product={p} editable={editable} />
        </TabsContent>
        <TabsContent value="photos">
          <PhotosTab product={p} editable={editable} />
        </TabsContent>
        <TabsContent value="pricing">
          <PricingTab
            product={p}
            editable={p.status !== 'ARCHIVED' && session.data?.user.seller?.status === 'VERIFIED'}
          />
        </TabsContent>
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>History</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {p.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="font-medium">
                      {EVENT_LABELS[e.type]}
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        · {formatDateTime(e.createdAt)}
                        {e.actor ? ` · ${e.actor}` : ''}
                        {e.toStatus
                          ? ` · now ${PRODUCT_STATUS_LABELS[e.toStatus].toLowerCase()}`
                          : ''}
                      </span>
                    </p>
                    {e.note ? <p className="text-muted-foreground">{e.note}</p> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
