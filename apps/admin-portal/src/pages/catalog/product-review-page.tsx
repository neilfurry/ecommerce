import {
  hasPermission,
  toDisplayError,
  useAdminProduct,
  useProductModeration,
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
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  formatMoney,
  LoadingState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@marketplace/ui';
import type { ProductDetail } from '@marketplace/validation';
import { BanIcon, CheckIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ProductStatusBadge } from '../../components/product-status';
import { ReasonDialog } from '../../components/reason-dialog';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">{children || '—'}</dd>
    </div>
  );
}

function Decision({ product }: { product: ProductDetail }) {
  const { review, takeDown } = useProductModeration();
  const brandBlocked = product.brand && product.brand.status !== 'ACTIVE';
  return (
    <div className="flex flex-wrap gap-2">
      {product.status === 'PENDING_APPROVAL' ? (
        <>
          <ConfirmDialog
            trigger={
              <Button disabled={!!brandBlocked}>
                <CheckIcon /> Approve
              </Button>
            }
            title={`Approve "${product.name}"?`}
            description="It becomes visible to shoppers (when the store is open) and the seller is emailed."
            confirmLabel="Approve"
            onConfirm={async () => {
              try {
                await review.mutateAsync({ productId: product.id, body: { decision: 'APPROVE' } });
                toast.success('Product approved');
              } catch (e) {
                showError('Could not approve', e);
                throw e;
              }
            }}
          />
          <ReasonDialog
            trigger={
              <Button variant="outline">
                <XIcon /> Reject
              </Button>
            }
            title="Reject this product?"
            description="The seller sees your note, fixes the product and submits it again."
            label="What should the seller fix?"
            submitLabel="Reject product"
            onSubmit={async (note) => {
              await review.mutateAsync({
                productId: product.id,
                body: { decision: 'REJECT', note },
              });
              toast.success('Product rejected');
            }}
          />
        </>
      ) : null}
      {product.status === 'ACTIVE' ||
      product.status === 'PENDING_APPROVAL' ||
      (product.status === 'INACTIVE' && !product.takenDown) ? (
        <ReasonDialog
          trigger={
            <Button variant="destructive">
              <BanIcon /> Take down
            </Button>
          }
          title="Take this product down?"
          description="It is hidden at once. The seller must fix it and submit it for approval again."
          submitLabel="Take down"
          onSubmit={async (reason) => {
            await takeDown.mutateAsync({ productId: product.id, reason });
            toast.success('Product taken down');
          }}
        />
      ) : null}
      {brandBlocked ? (
        <p className="w-full text-sm text-muted-foreground">
          The brand “{product.brand!.name}” is{' '}
          {product.brand!.status === 'PENDING' ? 'waiting for a decision' : 'not active'};{' '}
          <Link to="/catalog/brands" className="underline">
            decide on it first
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

/** Product review: everything the seller submitted, with approve, reject and take-down. */
export function ProductReviewPage() {
  const { productId } = useParams();
  const session = useSession();
  const product = useAdminProduct(productId);
  if (product.isPending) return <LoadingState />;
  if (product.isError) {
    return (
      <ErrorState
        message={toDisplayError(product.error)?.message ?? 'Could not load.'}
        onRetry={() => void product.refetch()}
      />
    );
  }
  const p = product.data;
  const canReview = hasPermission(session.data, 'catalog.products.review');
  const values = p.attributeValues;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Breadcrumbs items={[{ label: 'Products', to: '/catalog/products' }, { label: p.name }]} />
      <PageHeader
        title={p.name}
        description={`${p.sellerName} · ${p.storeName} · ${p.category.path.join(' › ')}`}
        actions={<ProductStatusBadge status={p.status} takenDown={p.takenDown} />}
      />
      {p.reviewNote ? (
        <Alert variant={p.takenDown || p.status === 'REJECTED' ? 'destructive' : 'default'}>
          <AlertTitle>Latest note to the seller</AlertTitle>
          <AlertDescription>{p.reviewNote}</AlertDescription>
        </Alert>
      ) : null}
      {canReview ? <Decision product={p} /> : null}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Content</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {p.images.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Photos">
                {p.images.map((img, i) => (
                  <li key={img.id}>
                    <a href={img.url} target="_blank" rel="noreferrer">
                      <img
                        src={img.thumbnailUrl}
                        alt={img.altText ?? `Photo ${i + 1}`}
                        className="aspect-square w-full rounded border object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No photos.</p>
            )}
            <p className="whitespace-pre-line text-sm">{p.description}</p>
            <dl className="grid gap-2">
              <Row label="Brand">
                {p.brand
                  ? `${p.brand.name}${p.brand.status !== 'ACTIVE' ? ` (${p.brand.status.toLowerCase()})` : ''}`
                  : null}
              </Row>
              {p.categoryAttributes.map((a) => (
                <Row key={a.code} label={a.name}>
                  {values[a.code] === undefined
                    ? null
                    : `${String(values[a.code])}${a.unit ? ` ${a.unit}` : ''}`}
                </Row>
              ))}
              {p.specifications.map((s) => (
                <Row key={s.name} label={s.name}>
                  {s.value}
                </Row>
              ))}
              <Row label="Page title">{p.seoTitle}</Row>
              <Row label="Meta description">{p.seoDescription}</Row>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>History</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {p.events.map((e) => (
                <li key={e.id}>
                  <p className="font-medium">
                    {e.type.replace(/_/g, ' ').toLowerCase()}
                    {e.toStatus ? ` → ${PRODUCT_STATUS_LABELS[e.toStatus]}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                    {e.actor ? ` · ${e.actor}` : ''}
                  </p>
                  {e.note ? <p className="text-muted-foreground">{e.note}</p> : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Variants and prices</h2>
          </CardTitle>
          <CardDescription>
            Minimum order {p.minOrderQuantity}
            {p.maxOrderQuantity ? `, maximum ${p.maxOrderQuantity}` : ''}. Wholesale{' '}
            {p.wholesaleEnabled ? `from ${p.wholesaleMinOrderQuantity} units` : 'off'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table aria-label="Variants">
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{v.title}</TableCell>
                  <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                  <TableCell>
                    {formatMoney(v.salePrice ?? v.regularPrice, p.currency)}
                    {v.salePrice ? (
                      <s className="ml-1 text-xs text-muted-foreground">
                        {formatMoney(v.regularPrice, p.currency)}
                      </s>
                    ) : null}
                  </TableCell>
                  <TableCell>{v.trackInventory ? v.stock.available : 'Not tracked'}</TableCell>
                  <TableCell>{v.status === 'ACTIVE' ? 'For sale' : 'Inactive'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {p.priceTiers.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">Wholesale tiers</h3>
              <ul className="text-sm">
                {p.priceTiers.map((t) => (
                  <li key={t.id}>
                    {t.minQuantity}+ units: {formatMoney(t.unitPrice, p.currency)}
                    {t.variantId
                      ? ` (${p.variants.find((v) => v.id === t.variantId)?.title ?? 'variant'})`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
