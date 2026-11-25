import { hasPermission, toDisplayError, useMyProducts, useSession } from '@marketplace/api-client';
import {
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUSES,
  type ProductStatus,
} from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  Button,
  DataTable,
  type DataTableColumn,
  formatMoney,
  Input,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@marketplace/ui';
import type { ProductSummary } from '@marketplace/validation';
import { ImageIcon, PackageIcon, PlusIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { ProductStatusBadge } from '../../components/catalog/product-status';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;
type Filter = ProductStatus | 'ALL';

export function ProductsPage() {
  const session = useSession();
  const canEdit = hasPermission(session.data, 'seller.products.manage');
  const verified = session.data?.user.seller?.status === 'VERIFIED';
  const [status, setStatus] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const products = useMyProducts({
    status: status === 'ALL' ? undefined : status,
    search: deferred || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const columns: DataTableColumn<ProductSummary>[] = [
    {
      id: 'product',
      header: 'Product',
      cell: (p) => (
        <div className="flex items-center gap-3">
          {p.thumbnailUrl ? (
            <img
              src={p.thumbnailUrl}
              alt=""
              className="size-12 shrink-0 rounded border object-cover"
            />
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded border bg-muted/40">
              <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <Link
              to={`/products/${p.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {p.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {p.category.path.join(' › ')} · {p.storeName}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'price',
      header: 'Price',
      hideOnMobile: true,
      cell: (p) =>
        p.priceRange
          ? p.priceRange.min === p.priceRange.max
            ? formatMoney(p.priceRange.min, p.currency)
            : `${formatMoney(p.priceRange.min, p.currency)} – ${formatMoney(p.priceRange.max, p.currency)}`
          : '—',
    },
    { id: 'variants', header: 'Variants', hideOnMobile: true, cell: (p) => p.variantCount },
    { id: 'stock', header: 'Available', cell: (p) => p.totalAvailable },
    {
      id: 'updated',
      header: 'Updated',
      hideOnMobile: true,
      cell: (p) => formatDateTime(p.updatedAt),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (p) => <ProductStatusBadge status={p.status} takenDown={p.takenDown} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Your catalog. New products and content changes are checked by the marketplace before shoppers see them."
        actions={
          canEdit && verified ? (
            <Button asChild>
              <Link to="/products/new">
                <PlusIcon /> Add product
              </Link>
            </Button>
          ) : null
        }
      />
      {!verified ? (
        <Alert>
          <AlertDescription>Products can be added once your business is verified.</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v as Filter);
            setPage(1);
          }}
        >
          <TabsList aria-label="Product status" className="flex-wrap">
            <TabsTrigger value="ALL">All</TabsTrigger>
            {PRODUCT_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {PRODUCT_STATUS_LABELS[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          type="search"
          aria-label="Search products"
          placeholder="Name or SKU"
          className="lg:max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        label="Products"
        columns={columns}
        rows={products.data?.items}
        getRowId={(p) => p.id}
        isLoading={products.isPending}
        error={toDisplayError(products.error)}
        onRetry={() => void products.refetch()}
        empty={{
          icon: PackageIcon,
          title: status === 'ALL' && !deferred ? 'No products yet' : 'No products found',
          description:
            status === 'ALL' && !deferred && canEdit && verified
              ? 'Add your first product to start selling.'
              : undefined,
        }}
        pagination={
          products.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: products.data.totalItems,
                onPageChange: setPage,
                isFetching: products.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
