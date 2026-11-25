import { toDisplayError, useInventoryOverview } from '@marketplace/api-client';
import {
  Card,
  CardContent,
  DataTable,
  type DataTableColumn,
  Input,
  PageHeader,
} from '@marketplace/ui';
import type { InventoryOverview } from '@marketplace/validation';
import { BoxesIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';

type SellerRow = InventoryOverview['sellers']['items'][number];
const PAGE_SIZE = 25;

/** Stock across every seller (inventory.read). */
export function InventoryOverviewPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const overview = useInventoryOverview({
    search: deferred || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const t = overview.data?.totals;
  const columns: DataTableColumn<SellerRow>[] = [
    {
      id: 'seller',
      header: 'Seller',
      cell: (s) => (
        <Link
          to={`/sellers/${s.sellerId}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {s.businessName}
        </Link>
      ),
    },
    { id: 'warehouses', header: 'Warehouses', hideOnMobile: true, cell: (s) => s.warehouses },
    { id: 'skus', header: 'Stock lines', hideOnMobile: true, cell: (s) => s.skus },
    { id: 'onHand', header: 'On hand', cell: (s) => s.onHand },
    { id: 'reserved', header: 'Reserved', hideOnMobile: true, cell: (s) => s.reserved },
    { id: 'available', header: 'Available', cell: (s) => s.available },
    { id: 'damaged', header: 'Damaged', hideOnMobile: true, cell: (s) => s.damaged },
    { id: 'low', header: 'Low / out', cell: (s) => `${s.lowStock} / ${s.outOfStock}` },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory overview"
        description="Stock held by every seller. Sellers manage their own stock in the Seller Center."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {(
          [
            ['Units on hand', t?.onHand],
            ['Reserved', t?.reserved],
            ['Available', t?.available],
            ['Active reservations', t?.activeReservations],
            ['Low stock lines', t?.lowStock],
          ] as const
        ).map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold">{value ?? '—'}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Input
        type="search"
        aria-label="Search sellers"
        placeholder="Business name"
        className="max-w-xs"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <DataTable
        label="Inventory by seller"
        columns={columns}
        rows={overview.data?.sellers.items}
        getRowId={(s) => s.sellerId}
        isLoading={overview.isPending}
        error={toDisplayError(overview.error)}
        onRetry={() => void overview.refetch()}
        empty={{ icon: BoxesIcon, title: 'No stock recorded yet' }}
        pagination={
          overview.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: overview.data.sellers.totalItems,
                onPageChange: setPage,
                isFetching: overview.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
