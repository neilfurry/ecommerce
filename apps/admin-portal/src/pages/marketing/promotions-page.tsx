import {
  toDisplayError,
  useAdminCouponMutations,
  useAdminCoupons,
  useAdminFlashSaleMutations,
  useAdminFlashSales,
  useAllCategories,
} from '@marketplace/api-client';
import { applyApiErrors, CouponManager, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  formatMoney,
  Input,
  LoadingState,
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
  toast,
} from '@marketplace/ui';
import {
  type FlashSaleDto,
  flashSaleInputSchema,
  updateFlashSaleSchema,
} from '@marketplace/validation';
import { PencilIcon, PlusIcon, ZapIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { formatDateTime } from '../../lib/format';
import { showError } from '../../lib/errors';

const PAGE_SIZE = 20;

function MarketplaceCoupons() {
  const [page, setPage] = useState(1);
  const coupons = useAdminCoupons({ page, pageSize: PAGE_SIZE });
  const { create, update } = useAdminCouponMutations();
  const categories = useAllCategories();
  return (
    <CouponManager
      targets={{
        categories: (categories.data?.categories ?? []).map((c) => ({
          id: c.id,
          name: c.path.join(' › '),
        })),
      }}
      coupons={coupons}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      canManage
      showSeller
      canEdit={(c) => c.scope === 'PLATFORM'}
      fundedBy="the marketplace"
      mutations={{
        create: (body) => create.mutateAsync(body),
        update: (id, body) => update.mutateAsync({ id, body }),
        pending: create.isPending || update.isPending,
      }}
    />
  );
}

interface SaleValues {
  title: string;
  startsAt: string;
  endsAt: string;
  status: 'ACTIVE' | 'INACTIVE';
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

/** A new sale defaults to tomorrow, for six hours. */
function saleDefaults(sale: FlashSaleDto | null): SaleValues {
  const start = new Date(Date.now() + 24 * 3600_000);
  return {
    title: sale?.title ?? '',
    startsAt: toLocalInput(sale?.startsAt ?? start.toISOString()),
    endsAt: toLocalInput(sale?.endsAt ?? new Date(start.getTime() + 6 * 3600_000).toISOString()),
    status: sale?.status ?? 'ACTIVE',
  };
}

function SaleDialog({ sale, onClose }: { sale: FlashSaleDto | null; onClose: () => void }) {
  const { create, update } = useAdminFlashSaleMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SaleValues>({ defaultValues: saleDefaults(sale) });
  const started = sale ? sale.phase !== 'UPCOMING' : false;
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const body = {
      title: v.title,
      ...(started ? {} : { startsAt: toIso(v.startsAt) }),
      endsAt: toIso(v.endsAt),
      status: v.status,
    };
    const parsed = (sale ? updateFlashSaleSchema : flashSaleInputSchema).safeParse(
      sale ? body : { ...body, startsAt: toIso(v.startsAt) },
    );
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        form.setError(String(issue.path[0] ?? 'title') as keyof SaleValues, {
          message: issue.message,
        });
      }
      return;
    }
    try {
      if (sale) await update.mutateAsync({ id: sale.id, body: parsed.data });
      else await create.mutateAsync(parsed.data as Parameters<typeof create.mutateAsync>[0]);
      toast.success(sale ? 'Flash sale saved' : 'Flash sale scheduled');
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sale ? `Edit ${sale.title}` : 'New flash sale'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormAlert message={formError} />
            </div>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="startsAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Starts</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" disabled={started} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="endsAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ends</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="INACTIVE">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">
              <SubmitButton pending={create.isPending || update.isPending}>
                {sale ? 'Save' : 'Schedule sale'}
              </SubmitButton>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const PHASE: Record<
  FlashSaleDto['phase'],
  { label: string; variant: 'success' | 'outline' | 'secondary' }
> = {
  RUNNING: { label: 'Running', variant: 'success' },
  UPCOMING: { label: 'Upcoming', variant: 'outline' },
  ENDED: { label: 'Ended', variant: 'secondary' },
};

function FlashSales() {
  const sales = useAdminFlashSales();
  const { setItemStatus } = useAdminFlashSaleMutations();
  const [editing, setEditing] = useState<FlashSaleDto | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <PlusIcon /> New flash sale
        </Button>
      </div>
      {sales.isPending ? (
        <LoadingState />
      ) : sales.isError ? (
        <ErrorState
          message={toDisplayError(sales.error)?.message ?? 'Could not load.'}
          onRetry={() => void sales.refetch()}
        />
      ) : sales.data.length === 0 ? (
        <EmptyState
          icon={ZapIcon}
          title="No flash sales"
          description="Schedule one; sellers then add their products with a flash price."
        />
      ) : (
        sales.data.map((sale) => (
          <Card key={sale.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <h2>{sale.title}</h2>
                  <Badge variant={PHASE[sale.phase].variant}>{PHASE[sale.phase].label}</Badge>
                  {sale.status === 'INACTIVE' ? <Badge variant="secondary">Cancelled</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {formatDateTime(sale.startsAt)} – {formatDateTime(sale.endsAt)} ·{' '}
                  {sale.items.length} products
                </CardDescription>
              </div>
              {sale.phase !== 'ENDED' ? (
                <Button size="sm" variant="outline" onClick={() => setEditing(sale)}>
                  <PencilIcon /> Edit
                </Button>
              ) : null}
            </CardHeader>
            {sale.items.length > 0 ? (
              <CardContent>
                <ul className="divide-y">
                  {sale.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.sellerName} · {item.variantTitle} ·{' '}
                          <span className="font-mono">{item.sku}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <span>
                          <span className="font-mono font-semibold">
                            {formatMoney(item.flashPrice)}
                          </span>{' '}
                          <span className="text-muted-foreground line-through">
                            {formatMoney(item.regularPrice)}
                          </span>
                        </span>
                        <span>
                          {item.soldQuantity} / {item.quantityLimit} sold
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={setItemStatus.isPending}
                          onClick={() =>
                            setItemStatus.mutate(
                              {
                                itemId: item.id,
                                status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              },
                              { onError: (e) => showError('Could not change the item', e) },
                            )
                          }
                        >
                          {item.status === 'ACTIVE' ? 'Remove from sale' : 'Restore'}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            ) : null}
          </Card>
        ))
      )}
      {editing ? (
        <SaleDialog sale={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

export function PromotionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Promotions"
        description="Marketplace-funded coupons, every seller coupon, and flash sale events."
      />
      <Tabs defaultValue="coupons">
        <TabsList aria-label="Promotion type">
          <TabsTrigger value="coupons">Coupons</TabsTrigger>
          <TabsTrigger value="flash-sales">Flash sales</TabsTrigger>
        </TabsList>
        <TabsContent value="coupons">
          <MarketplaceCoupons />
        </TabsContent>
        <TabsContent value="flash-sales">
          <FlashSales />
        </TabsContent>
      </Tabs>
    </div>
  );
}
