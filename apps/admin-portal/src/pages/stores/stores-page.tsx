import {
  hasPermission,
  toDisplayError,
  useAdminStores,
  useSession,
  useStoreStatusAction,
} from '@marketplace/api-client';
import { STORE_STATUSES, type StoreStatus } from '@marketplace/shared-types';
import {
  Button,
  DataTable,
  type DataTableColumn,
  Input,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from '@marketplace/ui';
import type { StoreDto } from '@marketplace/validation';
import { BanIcon, RotateCcwIcon, StoreIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ReasonDialog } from '../../components/reason-dialog';
import { StoreStatusBadge } from '../../components/store-status';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;
type Filter = StoreStatus | 'ALL';
const FILTER_LABELS: Record<Filter, string> = {
  ALL: 'All',
  ACTIVE: 'Open',
  INACTIVE: 'Hidden',
  SUSPENDED: 'Suspended',
};

function StoreActions({ store }: { store: StoreDto }) {
  const action = useStoreStatusAction();
  if (store.status === 'SUSPENDED') {
    return (
      <ReasonDialog
        trigger={
          <Button size="sm" variant="outline">
            <RotateCcwIcon /> Reinstate
          </Button>
        }
        title={`Reinstate ${store.name}?`}
        description="The store becomes visible to shoppers again (if the seller is verified)."
        submitLabel="Reinstate store"
        onSubmit={async (reason) => {
          await action.mutateAsync({ storeId: store.id, action: 'reinstate', reason });
          toast.success('Store reinstated');
        }}
      />
    );
  }
  return (
    <ReasonDialog
      trigger={
        <Button size="sm" variant="outline">
          <BanIcon /> Suspend
        </Button>
      }
      title={`Suspend ${store.name}?`}
      description="The store is hidden from shoppers and the seller cannot change it until reinstated."
      hint="Shown to the seller in Seller Center."
      submitLabel="Suspend store"
      onSubmit={async (reason) => {
        await action.mutateAsync({ storeId: store.id, action: 'suspend', reason });
        toast.success('Store suspended');
      }}
    />
  );
}

export function StoresPage() {
  const session = useSession();
  const canManage = hasPermission(session.data, 'stores.manage');
  const canSeeSellers = hasPermission(session.data, 'sellers.read');
  const [params, setParams] = useSearchParams();
  const sellerId = params.get('sellerId') ?? undefined;
  const [status, setStatus] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const stores = useAdminStores({
    status: status === 'ALL' ? undefined : status,
    search: deferredSearch || undefined,
    sellerId,
    page,
    pageSize: PAGE_SIZE,
  });

  const columns: DataTableColumn<StoreDto>[] = [
    {
      id: 'store',
      header: 'Store',
      cell: (s) => (
        <div className="min-w-0">
          <p className="font-medium">{s.name}</p>
          <p className="text-xs text-muted-foreground">/{s.slug}</p>
        </div>
      ),
    },
    {
      id: 'seller',
      header: 'Seller',
      hideOnMobile: true,
      cell: (s) =>
        canSeeSellers ? (
          <Link to={`/sellers/${s.sellerId}`} className="underline-offset-4 hover:underline">
            {s.sellerName}
          </Link>
        ) : (
          s.sellerName
        ),
    },
    {
      id: 'created',
      header: 'Created',
      hideOnMobile: true,
      cell: (s) => formatDateTime(s.createdAt),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => (
        <div className="space-y-1">
          <StoreStatusBadge status={s.status} />
          {s.statusNote ? (
            <p className="max-w-56 text-xs text-muted-foreground">{s.statusNote}</p>
          ) : null}
        </div>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (s: StoreDto) => <StoreActions store={s} />,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stores"
        description="Every seller's stores. Suspend a store that breaks marketplace rules."
      />
      {sellerId ? (
        <p className="text-sm">
          Showing one seller's stores.{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => setParams({})}>
            Show all stores
          </Button>
        </p>
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={status}
          onValueChange={(value) => {
            setStatus(value as Filter);
            setPage(1);
          }}
        >
          <TabsList aria-label="Store status">
            {(['ALL', ...STORE_STATUSES] as Filter[]).map((s) => (
              <TabsTrigger key={s} value={s}>
                {FILTER_LABELS[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          type="search"
          aria-label="Search stores"
          placeholder="Store name or link"
          className="lg:max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        label="Stores"
        columns={columns}
        rows={stores.data?.items}
        getRowId={(s) => s.id}
        isLoading={stores.isPending}
        error={toDisplayError(stores.error)}
        onRetry={() => void stores.refetch()}
        empty={{ icon: StoreIcon, title: 'No stores found' }}
        pagination={
          stores.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: stores.data.totalItems,
                onPageChange: setPage,
                isFetching: stores.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
