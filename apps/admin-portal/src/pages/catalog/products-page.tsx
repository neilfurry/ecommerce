import { toDisplayError, useAdminProducts } from '@marketplace/api-client';
import {
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUSES,
  type ProductStatus,
} from '@marketplace/shared-types';
import {
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
import { ImageIcon, PackageSearchIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ProductStatusBadge } from '../../components/product-status';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;
type Filter = ProductStatus | 'ALL';

/** Product approval queue and monitoring of every seller's products. */
export function AdminProductsPage() {
  const [params, setParams] = useSearchParams();
  const sellerId = params.get('sellerId') ?? undefined;
  const [status, setStatus] = useState<Filter>(sellerId ? 'ALL' : 'PENDING_APPROVAL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const products = useAdminProducts({
    status: status === 'ALL' ? undefined : status,
    search: deferred || undefined,
    sellerId,
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
              to={`/catalog/products/${p.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {p.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{p.category.path.join(' › ')}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'seller',
      header: 'Seller',
      hideOnMobile: true,
      cell: (p) => (
        <Link to={`/sellers/${p.sellerId}`} className="underline-offset-4 hover:underline">
          {p.sellerName}
        </Link>
      ),
    },
    {
      id: 'price',
      header: 'Price',
      hideOnMobile: true,
      cell: (p) => (p.priceRange ? formatMoney(p.priceRange.min, p.currency) : '—'),
    },
    {
      id: 'when',
      header: status === 'PENDING_APPROVAL' ? 'Submitted' : 'Updated',
      hideOnMobile: true,
      cell: (p) =>
        formatDateTime(
          status === 'PENDING_APPROVAL' && p.submittedAt ? p.submittedAt : p.updatedAt,
        ),
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
        description="Approve new and changed products, and monitor every seller's catalog. Waiting products are oldest first."
      />
      {sellerId ? (
        <p className="text-sm">
          Showing one seller's products.{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => setParams({})}>
            Show all sellers
          </Button>
        </p>
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
            {PRODUCT_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {PRODUCT_STATUS_LABELS[s]}
              </TabsTrigger>
            ))}
            <TabsTrigger value="ALL">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          type="search"
          aria-label="Search products"
          placeholder="Name, SKU or seller"
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
          icon: PackageSearchIcon,
          title:
            status === 'PENDING_APPROVAL' ? 'Nothing waiting for approval' : 'No products found',
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
