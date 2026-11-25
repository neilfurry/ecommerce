import {
  hasPermission,
  toDisplayError,
  useSellerCouponMutations,
  useSellerCoupons,
  useSellerFlashSaleMutations,
  useSellerFlashSales,
  useSession,
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
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  formatMoney,
  Input,
  LoadingState,
  PageHeader,
  toast,
} from '@marketplace/ui';
import type { FlashSaleDto, FlashSaleItemInput } from '@marketplace/validation';
import { PlusIcon, ZapIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { VariantPicker } from '../../components/catalog/variant-picker';
import { formatDateTime } from '../../lib/format';
import { showError } from '../../lib/errors';

const PAGE_SIZE = 20;

function useCanManageMarketing() {
  const session = useSession();
  return (
    hasPermission(session.data, 'seller.marketing.manage') &&
    session.data?.user.seller?.status === 'VERIFIED'
  );
}

/** Store-funded coupon codes. */
export function SellerCouponsPage() {
  const canManage = useCanManageMarketing();
  const [page, setPage] = useState(1);
  const coupons = useSellerCoupons({ page, pageSize: PAGE_SIZE });
  const { create, update } = useSellerCouponMutations();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Coupons"
        description="Discount codes for your stores. Your business pays for these discounts; they apply only to your items."
      />
      <CouponManager
        coupons={coupons}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        canManage={canManage}
        fundedBy="your business"
        mutations={{
          create: (body) => create.mutateAsync(body),
          update: (id, body) => update.mutateAsync({ id, body }),
          pending: create.isPending || update.isPending,
        }}
      />
    </div>
  );
}

interface JoinValues {
  variantId: string;
  flashPrice: string;
  quantityLimit: string;
  perOrderLimit: string;
}

function JoinDialog({ sale, onClose }: { sale: FlashSaleDto; onClose: () => void }) {
  const { addItem } = useSellerFlashSaleMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<JoinValues>({
    defaultValues: { variantId: '', flashPrice: '', quantityLimit: '', perOrderLimit: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    if (!v.variantId) {
      form.setError('variantId', { message: 'Choose a product variant' });
      return;
    }
    const body: FlashSaleItemInput = {
      variantId: v.variantId,
      flashPrice: v.flashPrice.trim(),
      quantityLimit: v.quantityLimit,
      perOrderLimit: v.perOrderLimit ? v.perOrderLimit : null,
    };
    try {
      await addItem.mutateAsync({ saleId: sale.id, body });
      toast.success(`Added to ${sale.title}`);
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Join {sale.title}</DialogTitle>
          <DialogDescription>
            {formatDateTime(sale.startsAt)} – {formatDateTime(sale.endsAt)}. Customers pay the flash
            price until the units you set aside are sold.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormAlert message={formError} />
            <FormField
              control={form.control}
              name="variantId"
              render={({ field }) => (
                <FormItem>
                  <VariantPicker idPrefix="flash" value={field.value} onChange={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="flashPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Flash price (₱)</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" {...field} />
                    </FormControl>
                    <FormDescription>Below the regular price</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quantityLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Units for the sale</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="perOrderLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Per order (optional)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <SubmitButton pending={addItem.isPending}>Join the sale</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Marketplace flash sales the seller can put products into. */
export function SellerFlashSalesPage() {
  const canManage = useCanManageMarketing();
  const sales = useSellerFlashSales();
  const { removeItem } = useSellerFlashSaleMutations();
  const [joining, setJoining] = useState<FlashSaleDto | null>(null);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Flash sales"
        description="Time-limited marketplace events. Add your products with a special price and a set number of units."
      />
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
          title="No flash sales open"
          description="When the marketplace schedules a flash sale, you can join it here."
        />
      ) : (
        sales.data.map((sale) => (
          <Card key={sale.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <h2>{sale.title}</h2>
                  <Badge variant={sale.phase === 'RUNNING' ? 'success' : 'outline'}>
                    {sale.phase === 'RUNNING' ? 'Running' : 'Upcoming'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {formatDateTime(sale.startsAt)} – {formatDateTime(sale.endsAt)}
                </CardDescription>
              </div>
              {canManage ? (
                <Button size="sm" onClick={() => setJoining(sale)}>
                  <PlusIcon /> Add a product
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {sale.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None of your products are in this sale yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {sale.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div>
                        <p className="font-medium">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.variantTitle} · <span className="font-mono">{item.sku}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
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
                          {item.perOrderLimit ? ` · max ${item.perOrderLimit} per order` : ''}
                        </span>
                        {item.status === 'INACTIVE' ? (
                          <Badge variant="secondary">Withdrawn</Badge>
                        ) : canManage ? (
                          <ConfirmDialog
                            trigger={
                              <Button size="sm" variant="ghost">
                                Withdraw
                              </Button>
                            }
                            title={`Withdraw ${item.productName}?`}
                            description={
                              item.soldQuantity > 0
                                ? 'It stops selling at the flash price. Units already sold stay recorded.'
                                : 'It is removed from the sale.'
                            }
                            confirmLabel="Withdraw"
                            onConfirm={async () => {
                              try {
                                await removeItem.mutateAsync(item.id);
                              } catch (e) {
                                showError('Could not withdraw the product', e);
                                throw e;
                              }
                            }}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))
      )}
      {joining ? <JoinDialog sale={joining} onClose={() => setJoining(null)} /> : null}
    </div>
  );
}
