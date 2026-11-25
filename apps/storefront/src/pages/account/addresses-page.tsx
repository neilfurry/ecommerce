import { toDisplayError, useAddresses, useAddressMutations } from '@marketplace/api-client';
import type { AddressDto } from '@marketplace/validation';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  toast,
} from '@marketplace/ui';
import { MapPinIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { AddressForm } from '../../components/shop/address-form';

export function AddressesPage() {
  const addresses = useAddresses();
  const { setDefault, remove } = useAddressMutations();
  const [editing, setEditing] = useState<AddressDto | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Addresses"
        description="Where we deliver. Your default address is chosen first at checkout."
        actions={
          <Button onClick={() => setEditing('new')}>
            <PlusIcon aria-hidden="true" /> Add address
          </Button>
        }
      />
      {addresses.isPending ? (
        <Skeleton className="h-40" />
      ) : addresses.isError ? (
        <ErrorState
          message={toDisplayError(addresses.error)?.message ?? 'Could not load addresses.'}
          onRetry={() => void addresses.refetch()}
        />
      ) : addresses.data.length === 0 ? (
        <EmptyState
          icon={MapPinIcon}
          title="No addresses yet"
          description="Add one to check out faster."
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {addresses.data.map((a) => (
            <li key={a.id}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-3 pt-6 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.recipientName}</span>
                    {a.label ? <Badge variant="outline">{a.label}</Badge> : null}
                    {a.isDefault ? <Badge>Default</Badge> : null}
                  </div>
                  <p className="text-muted-foreground">{a.mobile}</p>
                  <p className="flex-1">{a.formatted}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(a)}>
                      Edit
                    </Button>
                    {a.isDefault ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDefault.mutate(a.id, {
                            onSuccess: () => toast.success('Default address changed'),
                          })
                        }
                      >
                        Make default
                      </Button>
                    )}
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm">
                          Delete
                        </Button>
                      }
                      title="Delete this address?"
                      description="Orders already placed keep their own copy of the address."
                      confirmLabel="Delete"
                      destructive
                      onConfirm={() => remove.mutateAsync(a.id)}
                    />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Add an address' : 'Edit address'}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <AddressForm
              address={editing === 'new' ? undefined : editing}
              onSaved={() => {
                setEditing(null);
                toast.success('Address saved');
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
