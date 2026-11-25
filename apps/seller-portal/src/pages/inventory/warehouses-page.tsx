import { zodResolver } from '@hookform/resolvers/zod';
import {
  hasPermission,
  toDisplayError,
  useSession,
  useWarehouseMutations,
  useWarehouses,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
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
  Input,
  LoadingState,
  PageHeader,
  toast,
} from '@marketplace/ui';
import {
  type CreateWarehouseRequest,
  createWarehouseSchema,
  type WarehouseDto,
} from '@marketplace/validation';
import { PencilIcon, PlusIcon, StarIcon, WarehouseIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { showError } from '../../lib/errors';

const FIELDS: [keyof CreateWarehouseRequest, string, string?][] = [
  ['name', 'Name'],
  ['code', 'Code', 'Short and unique, e.g. QC-1'],
  ['addressLine1', 'Street address'],
  ['addressLine2', 'Unit, building (optional)'],
  ['barangay', 'Barangay (optional)'],
  ['city', 'City or municipality'],
  ['province', 'Province'],
  ['postalCode', 'Postal code (optional)'],
  ['contactName', 'Contact person (optional)'],
  ['phone', 'Contact mobile (optional)'],
];

function WarehouseDialog({
  warehouse,
  onClose,
}: {
  warehouse: WarehouseDto | null;
  onClose: () => void;
}) {
  const { create, update } = useWarehouseMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateWarehouseRequest>({
    resolver: zodResolver(createWarehouseSchema),
    defaultValues: {
      name: warehouse?.name ?? '',
      code: warehouse?.code ?? '',
      addressLine1: warehouse?.addressLine1 ?? '',
      addressLine2: warehouse?.addressLine2 ?? '',
      barangay: warehouse?.barangay ?? '',
      city: warehouse?.city ?? '',
      province: warehouse?.province ?? '',
      postalCode: warehouse?.postalCode ?? null,
      contactName: warehouse?.contactName ?? '',
      phone: warehouse?.phone ?? null,
      isDefault: false,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body = { ...values, postalCode: values.postalCode || null, phone: values.phone || null };
    try {
      if (warehouse) {
        const { isDefault: _ignored, ...rest } = body;
        await update.mutateAsync({ warehouseId: warehouse.id, body: rest });
      } else {
        await create.mutateAsync(body);
      }
      toast.success(warehouse ? 'Warehouse saved' : 'Warehouse added');
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{warehouse ? `Edit ${warehouse.name}` : 'Add a warehouse'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormAlert message={formError} />
            </div>
            {FIELDS.map(([name, label, description]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem className={name === 'addressLine1' ? 'sm:col-span-2' : undefined}>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <Input {...field} value={(field.value as string | null | undefined) ?? ''} />
                    </FormControl>
                    {description ? <FormDescription>{description}</FormDescription> : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <div className="sm:col-span-2">
              <SubmitButton pending={create.isPending || update.isPending}>
                {warehouse ? 'Save' : 'Add warehouse'}
              </SubmitButton>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function WarehousesPage() {
  const session = useSession();
  const canManage =
    hasPermission(session.data, 'seller.inventory.manage') &&
    session.data?.user.seller?.status === 'VERIFIED';
  const warehouses = useWarehouses();
  const { update, makeDefault } = useWarehouseMutations();
  const [editing, setEditing] = useState<WarehouseDto | null | 'new'>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Warehouses"
        description="Where your stock is kept. Stock for checkouts is taken from the default warehouse first."
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <PlusIcon /> Add warehouse
            </Button>
          ) : null
        }
      />
      {warehouses.isPending ? (
        <LoadingState />
      ) : warehouses.isError ? (
        <ErrorState
          message={toDisplayError(warehouses.error)?.message ?? 'Could not load.'}
          onRetry={() => void warehouses.refetch()}
        />
      ) : warehouses.data.warehouses.length === 0 ? (
        <EmptyState
          icon={WarehouseIcon}
          title="No warehouses yet"
          description="Add the place where you keep your stock."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {warehouses.data.warehouses.map((w) => (
            <Card key={w.id} className={w.status === 'INACTIVE' ? 'opacity-70' : undefined}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <h2>{w.name}</h2>
                  <Badge variant="outline" className="font-mono">
                    {w.code}
                  </Badge>
                  {w.isDefault ? <Badge>Default</Badge> : null}
                  {w.status === 'INACTIVE' ? <Badge variant="secondary">Inactive</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {[w.addressLine1, w.addressLine2, w.barangay, w.city, w.province, w.postalCode]
                    .filter(Boolean)
                    .join(', ')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-4 gap-2 text-sm">
                  {(
                    [
                      ['SKUs', w.totals.skus],
                      ['On hand', w.totals.onHand],
                      ['Reserved', w.totals.reserved],
                      ['Damaged', w.totals.damaged],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(w)}>
                      <PencilIcon /> Edit
                    </Button>
                    {!w.isDefault && w.status === 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          makeDefault.mutate(w.id, {
                            onSuccess: () => toast.success(`${w.name} is now the default`),
                            onError: (e) => showError('Could not change the default', e),
                          })
                        }
                      >
                        <StarIcon /> Make default
                      </Button>
                    ) : null}
                    {!w.isDefault ? (
                      <ConfirmDialog
                        trigger={
                          <Button size="sm" variant="ghost">
                            {w.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </Button>
                        }
                        title={
                          w.status === 'ACTIVE' ? `Deactivate ${w.name}?` : `Activate ${w.name}?`
                        }
                        description={
                          w.status === 'ACTIVE'
                            ? 'No new stock can be recorded there and checkouts will not use it. Its stock stays visible.'
                            : 'Stock can be recorded and reserved there again.'
                        }
                        confirmLabel={w.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        onConfirm={async () => {
                          try {
                            await update.mutateAsync({
                              warehouseId: w.id,
                              body: { status: w.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
                            });
                          } catch (e) {
                            showError('Could not change the warehouse', e);
                            throw e;
                          }
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing ? (
        <WarehouseDialog
          warehouse={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
