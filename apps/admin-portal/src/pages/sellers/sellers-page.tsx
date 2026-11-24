import { toDisplayError, useAdminSellers } from '@marketplace/api-client';
import {
  BUSINESS_TYPE_LABELS,
  SELLER_STATUS_LABELS,
  SELLER_STATUSES,
  type SellerStatus,
} from '@marketplace/shared-types';
import {
  DataTable,
  type DataTableColumn,
  Input,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@marketplace/ui';
import type { SellerSummary } from '@marketplace/validation';
import { StoreIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { SellerStatusBadge } from '../../components/seller-status';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;
type Filter = SellerStatus | 'ALL';

export function SellersPage() {
  const [status, setStatus] = useState<Filter>('UNDER_REVIEW');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const sellers = useAdminSellers({
    status: status === 'ALL' ? undefined : status,
    search: deferredSearch || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const columns: DataTableColumn<SellerSummary>[] = [
    {
      id: 'business',
      header: 'Business',
      cell: (s) => (
        <div className="min-w-0">
          <Link to={`/sellers/${s.id}`} className="font-medium underline-offset-4 hover:underline">
            {s.businessName}
          </Link>
          <p className="text-xs text-muted-foreground">
            {BUSINESS_TYPE_LABELS[s.businessType].label}
          </p>
        </div>
      ),
    },
    {
      id: 'owner',
      header: 'Owner',
      hideOnMobile: true,
      cell: (s) => (
        <div className="min-w-0">
          <p>{s.owner.name}</p>
          <p className="truncate text-xs text-muted-foreground">{s.owner.email}</p>
        </div>
      ),
    },
    {
      id: 'location',
      header: 'Location',
      hideOnMobile: true,
      cell: (s) => [s.city, s.province].filter(Boolean).join(', ') || '—',
    },
    {
      id: 'submitted',
      header: 'Submitted',
      hideOnMobile: true,
      cell: (s) => (s.submittedAt ? formatDateTime(s.submittedAt) : '—'),
    },
    { id: 'status', header: 'Status', cell: (s) => <SellerStatusBadge status={s.status} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sellers"
        description="Seller applications and verified sellers. Applications waiting for review are listed oldest first."
      />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={status}
          onValueChange={(value) => {
            setStatus(value as Filter);
            setPage(1);
          }}
        >
          <TabsList aria-label="Seller status" className="flex-wrap">
            {SELLER_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {SELLER_STATUS_LABELS[s]}
              </TabsTrigger>
            ))}
            <TabsTrigger value="ALL">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          type="search"
          aria-label="Search sellers"
          placeholder="Business, owner or email"
          className="lg:max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        label="Sellers"
        columns={columns}
        rows={sellers.data?.items}
        getRowId={(s) => s.id}
        isLoading={sellers.isPending}
        error={toDisplayError(sellers.error)}
        onRetry={() => void sellers.refetch()}
        empty={{
          icon: StoreIcon,
          title: status === 'UNDER_REVIEW' ? 'No applications waiting' : 'No sellers found',
        }}
        pagination={
          sellers.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: sellers.data.totalItems,
                onPageChange: setPage,
                isFetching: sellers.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
