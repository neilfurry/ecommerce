import {
  toDisplayError,
  useMovements,
  useReservations,
  useTransfers,
} from '@marketplace/api-client';
import {
  INVENTORY_MOVEMENT_LABELS,
  INVENTORY_MOVEMENT_TYPES,
  type InventoryMovementType,
} from '@marketplace/shared-types';
import {
  Badge,
  DataTable,
  type DataTableColumn,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@marketplace/ui';
import type { MovementDto, ReservationDto, TransferDto } from '@marketplace/validation';
import { HistoryIcon } from 'lucide-react';
import { useState } from 'react';
import { ALL_WAREHOUSES } from '../../components/catalog/constants';
import { WarehouseSelect } from '../../components/catalog/warehouse-select';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 25;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function Movements() {
  const [warehouseId, setWarehouseId] = useState(ALL_WAREHOUSES);
  const [type, setType] = useState<InventoryMovementType | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const movements = useMovements({
    warehouseId: warehouseId === ALL_WAREHOUSES ? undefined : warehouseId,
    type: type === 'ALL' ? undefined : type,
    page,
    pageSize: PAGE_SIZE,
  });
  const columns: DataTableColumn<MovementDto>[] = [
    { id: 'when', header: 'When', cell: (m) => formatDateTime(m.createdAt) },
    {
      id: 'type',
      header: 'Type',
      cell: (m) => <Badge variant="outline">{INVENTORY_MOVEMENT_LABELS[m.type]}</Badge>,
    },
    {
      id: 'item',
      header: 'Item',
      cell: (m) => (
        <div>
          <p>{m.product.name}</p>
          <p className="text-xs text-muted-foreground">
            {m.variant.title} · <span className="font-mono">{m.variant.sku}</span> ·{' '}
            {m.warehouse.code}
          </p>
        </div>
      ),
    },
    {
      id: 'change',
      header: 'Change',
      cell: (m) => (
        <span className="font-mono">
          {m.quantityChange !== 0 ? signed(m.quantityChange) : ''}
          {m.damagedChange !== 0 ? ` (damaged ${signed(m.damagedChange)})` : ''}
        </span>
      ),
    },
    { id: 'after', header: 'On hand after', hideOnMobile: true, cell: (m) => m.onHandAfter },
    { id: 'reason', header: 'Reason', hideOnMobile: true, cell: (m) => m.reason ?? '—' },
    { id: 'by', header: 'By', hideOnMobile: true, cell: (m) => m.actor ?? 'System' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-64">
          <WarehouseSelect
            id="history-warehouse"
            value={warehouseId}
            onChange={(v) => {
              setWarehouseId(v);
              setPage(1);
            }}
            includeAll
          />
        </div>
        <div className="sm:w-64">
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v as InventoryMovementType | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Movement type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {INVENTORY_MOVEMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {INVENTORY_MOVEMENT_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        label="Inventory movements"
        columns={columns}
        rows={movements.data?.items}
        getRowId={(m) => m.id}
        isLoading={movements.isPending}
        error={toDisplayError(movements.error)}
        onRetry={() => void movements.refetch()}
        empty={{ icon: HistoryIcon, title: 'No movements yet' }}
        pagination={
          movements.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: movements.data.totalItems,
                onPageChange: setPage,
                isFetching: movements.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}

function Transfers() {
  const [page, setPage] = useState(1);
  const transfers = useTransfers({ page, pageSize: PAGE_SIZE });
  const columns: DataTableColumn<TransferDto>[] = [
    { id: 'when', header: 'When', cell: (t) => formatDateTime(t.createdAt) },
    {
      id: 'route',
      header: 'From → to',
      cell: (t) => `${t.fromWarehouse.code} → ${t.toWarehouse.code}`,
    },
    {
      id: 'items',
      header: 'Items',
      cell: (t) => (
        <ul>
          {t.items.map((i) => (
            <li key={i.variantId}>
              {i.quantity} × {i.productName} ({i.title})
            </li>
          ))}
        </ul>
      ),
    },
    { id: 'note', header: 'Note', hideOnMobile: true, cell: (t) => t.note ?? '—' },
    { id: 'by', header: 'By', hideOnMobile: true, cell: (t) => t.createdBy },
  ];
  return (
    <DataTable
      label="Stock transfers"
      columns={columns}
      rows={transfers.data?.items}
      getRowId={(t) => t.id}
      isLoading={transfers.isPending}
      error={toDisplayError(transfers.error)}
      onRetry={() => void transfers.refetch()}
      empty={{ title: 'No transfers yet' }}
      pagination={
        transfers.data
          ? {
              page,
              pageSize: PAGE_SIZE,
              totalItems: transfers.data.totalItems,
              onPageChange: setPage,
              isFetching: transfers.isFetching,
            }
          : undefined
      }
    />
  );
}

function Reservations() {
  const [page, setPage] = useState(1);
  const reservations = useReservations({ page, pageSize: PAGE_SIZE });
  const columns: DataTableColumn<ReservationDto>[] = [
    { id: 'when', header: 'Created', cell: (r) => formatDateTime(r.createdAt) },
    {
      id: 'item',
      header: 'Item',
      cell: (r) => `${r.variant.title} · ${r.variant.sku} · ${r.warehouse.code}`,
    },
    { id: 'qty', header: 'Units', cell: (r) => r.quantity },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge variant={r.status === 'ACTIVE' ? 'warning' : 'secondary'}>
          {r.status.toLowerCase()}
        </Badge>
      ),
    },
    {
      id: 'expires',
      header: 'Expires',
      hideOnMobile: true,
      cell: (r) => formatDateTime(r.expiresAt),
    },
  ];
  return (
    <DataTable
      label="Stock reservations"
      columns={columns}
      rows={reservations.data?.items}
      getRowId={(r) => r.id}
      isLoading={reservations.isPending}
      error={toDisplayError(reservations.error)}
      onRetry={() => void reservations.refetch()}
      empty={{ title: 'No reservations', description: 'Stock held for checkouts appears here.' }}
      pagination={
        reservations.data
          ? {
              page,
              pageSize: PAGE_SIZE,
              totalItems: reservations.data.totalItems,
              onPageChange: setPage,
              isFetching: reservations.isFetching,
            }
          : undefined
      }
    />
  );
}

/** The inventory ledger, transfers and reservations. */
export function HistoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Movement history"
        description="Every change to your stock, newest first. Entries cannot be edited or deleted."
      />
      <Tabs defaultValue="movements">
        <TabsList aria-label="History type">
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
          <TabsTrigger value="reservations">Reservations</TabsTrigger>
        </TabsList>
        <TabsContent value="movements">
          <Movements />
        </TabsContent>
        <TabsContent value="transfers">
          <Transfers />
        </TabsContent>
        <TabsContent value="reservations">
          <Reservations />
        </TabsContent>
      </Tabs>
    </div>
  );
}
