import {
  hasPermission,
  toDisplayError,
  useInventorySummary,
  useSession,
  useSetLowStockThreshold,
  useStockLevels,
} from '@marketplace/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  toast,
} from '@marketplace/ui';
import type { StockLevelDto } from '@marketplace/validation';
import { ArrowLeftRightIcon, BellIcon, BoxesIcon, PlusIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ALL_WAREHOUSES } from '../../components/catalog/constants';
import { WarehouseSelect } from '../../components/catalog/warehouse-select';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 25;

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: 'warning' | 'danger';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={`text-2xl font-semibold ${tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-warning-foreground' : ''}`}
        >
          {value ?? '—'}
        </p>
      </CardContent>
    </Card>
  );
}

function ThresholdDialog({ level, onClose }: { level: StockLevelDto; onClose: () => void }) {
  const save = useSetLowStockThreshold();
  const [value, setValue] = useState(
    level.lowStockThreshold === null ? '' : String(level.lowStockThreshold),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Low-stock alert</DialogTitle>
          <DialogDescription>
            {level.product.name} — {level.variant.title} in {level.warehouse.name}. We email you
            once when available stock falls to this number.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              { stockLevelId: level.id, threshold: value === '' ? null : Number(value) },
              {
                onSuccess: () => {
                  toast.success(value === '' ? 'Alert turned off' : 'Alert saved');
                  onClose();
                },
                onError: (error) => showError('Could not save', error),
              },
            );
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="threshold">Alert at (units available)</Label>
            <Input
              id="threshold"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Empty: no alert"
            />
          </div>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Inventory dashboard: totals and every stock level, with low-stock filtering. */
export function InventoryPage() {
  const session = useSession();
  const canManage = hasPermission(session.data, 'seller.inventory.manage');
  const [params] = useSearchParams();
  const [warehouseId, setWarehouseId] = useState(ALL_WAREHOUSES);
  const [lowStock, setLowStock] = useState(params.get('lowStock') === 'true');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<StockLevelDto | null>(null);
  const deferred = useDeferredValue(search.trim());
  const summary = useInventorySummary();
  const stock = useStockLevels({
    warehouseId: warehouseId === ALL_WAREHOUSES ? undefined : warehouseId,
    lowStock,
    search: deferred || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const columns: DataTableColumn<StockLevelDto>[] = [
    {
      id: 'item',
      header: 'Item',
      cell: (l) => (
        <div className="min-w-0">
          <Link
            to={`/products/${l.product.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {l.product.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {l.variant.title} · <span className="font-mono">{l.variant.sku}</span>
          </p>
        </div>
      ),
    },
    {
      id: 'warehouse',
      header: 'Warehouse',
      hideOnMobile: true,
      cell: (l) => `${l.warehouse.name} (${l.warehouse.code})`,
    },
    { id: 'onHand', header: 'On hand', cell: (l) => l.quantityOnHand },
    { id: 'reserved', header: 'Reserved', hideOnMobile: true, cell: (l) => l.reservedQuantity },
    {
      id: 'available',
      header: 'Available',
      cell: (l) => (
        <span className="flex items-center gap-2">
          {l.availableQuantity}
          {l.availableQuantity === 0 ? (
            <Badge variant="destructive">Out</Badge>
          ) : l.isLowStock ? (
            <Badge variant="warning">Low</Badge>
          ) : null}
        </span>
      ),
    },
    { id: 'damaged', header: 'Damaged', hideOnMobile: true, cell: (l) => l.damagedQuantity },
    {
      id: 'alert',
      header: 'Alert at',
      hideOnMobile: true,
      cell: (l) =>
        canManage ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(l)}
            aria-label={`Low-stock alert for ${l.variant.sku} in ${l.warehouse.code}`}
          >
            <BellIcon /> {l.lowStockThreshold ?? 'Off'}
          </Button>
        ) : (
          (l.lowStockThreshold ?? 'Off')
        ),
    },
    {
      id: 'updated',
      header: 'Updated',
      hideOnMobile: true,
      cell: (l) => formatDateTime(l.updatedAt),
    },
  ];

  const s = summary.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Stock in every warehouse. Available = on hand − reserved for checkouts."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/inventory/adjustments">
                  <PlusIcon /> Record stock
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/inventory/adjustments?tab=transfer">
                  <ArrowLeftRightIcon /> Transfer
                </Link>
              </Button>
            </div>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Units on hand" value={s?.onHand} />
        <Stat label="Reserved" value={s?.reserved} />
        <Stat label="Available" value={s?.available} />
        <Stat label="Damaged" value={s?.damaged} />
        <Stat label="Low stock" value={s?.lowStock} tone={s?.lowStock ? 'warning' : undefined} />
        <Stat
          label="Out of stock"
          value={s?.outOfStock}
          tone={s?.outOfStock ? 'danger' : undefined}
        />
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="lg:w-64">
          <WarehouseSelect
            id="stock-warehouse"
            value={warehouseId}
            onChange={(v) => {
              setWarehouseId(v);
              setPage(1);
            }}
            includeAll
          />
        </div>
        <Input
          type="search"
          aria-label="Search stock"
          placeholder="Product name or SKU"
          className="lg:max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="low-only"
            checked={lowStock}
            onCheckedChange={(v) => {
              setLowStock(v === true);
              setPage(1);
            }}
          />
          <Label htmlFor="low-only" className="font-normal">
            Low stock only
          </Label>
        </div>
      </div>
      <DataTable
        label="Stock levels"
        columns={columns}
        rows={stock.data?.items}
        getRowId={(l) => l.id}
        isLoading={stock.isPending}
        error={toDisplayError(stock.error)}
        onRetry={() => void stock.refetch()}
        empty={{
          icon: BoxesIcon,
          title: lowStock ? 'Nothing is low on stock' : 'No stock recorded yet',
          description: lowStock ? undefined : 'Record stock in for your products to see it here.',
        }}
        pagination={
          stock.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: stock.data.totalItems,
                onPageChange: setPage,
                isFetching: stock.isFetching,
              }
            : undefined
        }
      />
      {editing ? <ThresholdDialog level={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
