import { zodResolver } from '@hookform/resolvers/zod';
import {
  toDisplayError,
  useApiClient,
  useCreateStore,
  useMyStores,
  useSession,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import { MAX_STORES_PER_SELLER } from '@marketplace/shared-types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from '@marketplace/ui';
import { type CreateStoreRequest, createStoreSchema } from '@marketplace/validation';
import { PlusIcon, StoreIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { slugify } from '../../lib/slug';
import { StoreStatusBadge } from './store-status';

function CreateStoreDialog() {
  const client = useApiClient();
  const create = useCreateStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ slug: string; message: string } | null>(null);
  const form = useForm<CreateStoreRequest>({
    resolver: zodResolver(createStoreSchema),
    defaultValues: { name: '', slug: '' },
  });
  const slug = useWatch({ control: form.control, name: 'slug' });

  // Live check of the store link, debounced.
  useEffect(() => {
    if (!slug || slug.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      client.seller.stores
        .slugAvailability(slug, controller.signal)
        .then((result) =>
          setChecked({
            slug,
            message: result.available ? 'Available' : (result.reason ?? 'Not available'),
          }),
        )
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, client]);

  // Only show the answer for the link currently typed.
  const availability = checked && checked.slug === slug ? checked.message : null;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const store = await create.mutateAsync(values);
      setOpen(false);
      void navigate(`/stores/${store.id}`);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> Create store
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a store</DialogTitle>
          <DialogDescription>You can change everything except the link later.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FormAlert message={formError} />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Store name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);
                        if (!form.getFieldState('slug').isDirty) {
                          form.setValue('slug', slugify(event.target.value));
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Store link</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toLowerCase())}
                    />
                  </FormControl>
                  <FormDescription aria-live="polite">
                    marketplace.ph/store/{slug || 'your-store'}
                    {availability ? ` — ${availability}` : ''}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={create.isPending}>Create store</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function StoresPage() {
  const session = useSession();
  const stores = useMyStores();
  const sellerStatus = session.data?.user.seller?.status;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Stores"
        description={`Each store has its own page, branding and settings. Up to ${MAX_STORES_PER_SELLER} per business.`}
        actions={stores.data?.canCreate ? <CreateStoreDialog /> : null}
      />
      {stores.isPending ? (
        <LoadingState />
      ) : stores.isError ? (
        <ErrorState
          message={toDisplayError(stores.error)?.message ?? 'Could not load stores.'}
          onRetry={() => void stores.refetch()}
        />
      ) : stores.data.stores.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title="No stores yet"
          description={
            sellerStatus === 'VERIFIED'
              ? 'Create your first store to start selling.'
              : 'You can create a store once your business is verified.'
          }
          action={
            sellerStatus !== 'VERIFIED' ? (
              <Button asChild variant="outline">
                <Link to="/verification">Go to verification</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {stores.data.stores.map((store) => (
            <Card key={store.id}>
              <CardHeader className="flex flex-row items-center gap-3">
                {store.logoUrl ? (
                  <img
                    src={store.logoUrl}
                    alt=""
                    className="size-12 rounded-md border object-cover"
                  />
                ) : (
                  <div className="flex size-12 items-center justify-center rounded-md border bg-muted">
                    <StoreIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <CardTitle>
                    <h2 className="truncate">{store.name}</h2>
                  </CardTitle>
                  <CardDescription className="truncate">/{store.slug}</CardDescription>
                </div>
                <StoreStatusBadge status={store.status} />
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/stores/${store.id}`}>Manage store</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
