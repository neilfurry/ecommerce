import { useRecordMovement, useTransferStock } from '@marketplace/api-client';
import { FormAlert } from '@marketplace/auth-ui';
import {
  INVENTORY_MOVEMENT_LABELS,
  MANUAL_MOVEMENT_TYPES,
  type ManualMovementType,
} from '@marketplace/shared-types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
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
  Textarea,
  toast,
} from '@marketplace/ui';
import type { MovementResult } from '@marketplace/validation';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { VariantPicker } from '../../components/catalog/variant-picker';
import { WarehouseSelect } from '../../components/catalog/warehouse-select';

const HELP: Record<ManualMovementType, string> = {
  STOCK_IN: 'Goods received: adds to on-hand stock.',
  STOCK_OUT: 'Goods removed for a reason other than a sale (samples, internal use).',
  ADJUSTMENT: 'Correct the count: positive if you found more, negative if units are missing.',
  DAMAGED: 'Moves sellable units to damaged stock.',
  DAMAGED_WRITE_OFF: 'Removes damaged units you disposed of.',
  RETURN_RESTOCK: 'A customer return you can sell again.',
  RETURN_DAMAGED: 'A customer return that cannot be sold again.',
};

function MovementForm() {
  const record = useRecordMovement();
  const [warehouseId, setWarehouseId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [type, setType] = useState<ManualMovementType>('STOCK_IN');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<MovementResult | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await record.mutateAsync({ warehouseId, variantId, type, quantity, reason });
      setLast(result);
      setQuantity('');
      setReason('');
      toast.success(`${INVENTORY_MOVEMENT_LABELS[type]} recorded`, {
        description: `${result.stockLevel.variant.sku}: ${result.stockLevel.availableQuantity} available`,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Record a stock movement</h2>
        </CardTitle>
        <CardDescription>
          Every movement is kept in the history with who recorded it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
          <FormAlert message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="move-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ManualMovementType)}>
                <SelectTrigger id="move-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_MOVEMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {INVENTORY_MOVEMENT_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{HELP[type]}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="move-warehouse">Warehouse</Label>
              <WarehouseSelect
                id="move-warehouse"
                value={warehouseId}
                onChange={setWarehouseId}
                activeOnly
              />
            </div>
          </div>
          <VariantPicker value={variantId} onChange={setVariantId} idPrefix="move" />
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="move-qty">
                {type === 'ADJUSTMENT' ? 'Change (+ or −)' : 'Units'}
              </Label>
              <Input
                id="move-qty"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="move-reason">
                Reason{type === 'STOCK_IN' || type === 'RETURN_RESTOCK' ? ' (optional)' : ''}
              </Label>
              <Textarea
                id="move-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={record.isPending || !warehouseId || !variantId || !quantity}
          >
            Record movement
          </Button>
          {last ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Now {last.stockLevel.quantityOnHand} on hand, {last.stockLevel.availableQuantity}{' '}
              available, {last.stockLevel.damagedQuantity} damaged in{' '}
              {last.stockLevel.warehouse.code}.{' '}
              <Link to="/inventory/history" className="underline">
                View history
              </Link>
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

interface Line {
  key: number;
  variantId: string;
  quantity: string;
}

function TransferForm() {
  const transfer = useTransferStock();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 0, variantId: '', quantity: '' }]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await transfer.mutateAsync({
        fromWarehouseId: from,
        toWarehouseId: to,
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        note,
      });
      toast.success('Stock transferred', {
        description: `${result.items.reduce((n, i) => n + i.quantity, 0)} units from ${result.fromWarehouse.code} to ${result.toWarehouse.code}`,
      });
      setLines([{ key: Date.now(), variantId: '', quantity: '' }]);
      setNote('');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Transfer stock between warehouses</h2>
        </CardTitle>
        <CardDescription>
          All items move together, or nothing moves if one is short.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
          <FormAlert message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="transfer-from">From</Label>
              <WarehouseSelect
                id="transfer-from"
                label="From warehouse"
                value={from}
                onChange={setFrom}
                activeOnly
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="transfer-to">To</Label>
              <WarehouseSelect
                id="transfer-to"
                label="To warehouse"
                value={to}
                onChange={setTo}
                activeOnly
              />
            </div>
          </div>
          {lines.map((line, index) => (
            <div key={line.key} className="space-y-2 rounded-md border p-3">
              <VariantPicker
                value={line.variantId}
                onChange={(variantId) =>
                  setLines((l) => l.map((x) => (x.key === line.key ? { ...x, variantId } : x)))
                }
                idPrefix={`transfer-${line.key}`}
              />
              <div className="flex items-end gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`transfer-qty-${line.key}`}>Units</Label>
                  <Input
                    id={`transfer-qty-${line.key}`}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((l) =>
                        l.map((x) => (x.key === line.key ? { ...x, quantity: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                {lines.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => setLines((l) => l.filter((x) => x.key !== line.key))}
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((l) => [...l, { key: Date.now(), variantId: '', quantity: '' }])
            }
          >
            <PlusIcon /> Add item
          </Button>
          <div className="grid gap-1.5">
            <Label htmlFor="transfer-note">Note (optional)</Label>
            <Input id="transfer-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button
            type="submit"
            disabled={
              transfer.isPending || !from || !to || lines.some((l) => !l.variantId || !l.quantity)
            }
          >
            Transfer
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Stock adjustments: manual movements (in, out, counts, damage, returns) and transfers. */
export function AdjustmentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'transfer' ? 'transfer' : 'movement';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Stock adjustments"
        description="Record stock coming in or going out, counts, damage and returns."
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'transfer' ? { tab: 'transfer' } : {})}
      >
        <TabsList aria-label="Adjustment type">
          <TabsTrigger value="movement">Stock movement</TabsTrigger>
          <TabsTrigger value="transfer">Transfer</TabsTrigger>
        </TabsList>
        <TabsContent value="movement">
          <MovementForm />
        </TabsContent>
        <TabsContent value="transfer">
          <TransferForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
