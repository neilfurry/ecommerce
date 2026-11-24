import { zodResolver } from '@hookform/resolvers/zod';
import {
  hasPermission,
  toDisplayError,
  useApiClient,
  useSession,
  useSetStoreOpen,
  useStoreImage,
  useUpdateStore,
  useUpdateStoreSettings,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import { queryKeys } from '@marketplace/api-client';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  ErrorState,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@marketplace/ui';
import {
  type StoreDto,
  type UpdateStoreRequest,
  type UpdateStoreSettingsRequest,
  updateStoreSchema,
  updateStoreSettingsSchema,
} from '@marketplace/validation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangleIcon, ImageIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router';
import { showError } from '../../lib/errors';
import { StoreStatusBadge } from './store-status';

const SOCIALS = [
  ['facebook', 'Facebook page'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['website', 'Website'],
] as const;

function useStore(storeId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: [...queryKeys.seller.stores, storeId],
    queryFn: ({ signal }) => client.seller.stores.get(storeId!, signal),
    enabled: !!storeId,
  });
}

function Field({
  control,
  name,
  label,
  disabled,
  multiline,
  description,
  type,
}: {
  control: ReturnType<typeof useForm<UpdateStoreRequest>>['control'];
  name: string;
  label: string;
  disabled: boolean;
  multiline?: boolean;
  description?: ReactNode;
  type?: string;
}) {
  return (
    <FormField
      control={control}
      name={name as keyof UpdateStoreRequest}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? (
              <Textarea
                rows={4}
                {...field}
                value={(field.value as string | null | undefined) ?? ''}
                disabled={disabled}
              />
            ) : (
              <Input
                type={type}
                {...field}
                value={(field.value as string | null | undefined) ?? ''}
                disabled={disabled}
              />
            )}
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function DetailsTab({ store, editable }: { store: StoreDto; editable: boolean }) {
  const update = useUpdateStore();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<UpdateStoreRequest>({
    resolver: zodResolver(updateStoreSchema),
    values: {
      name: store.name,
      description: store.description ?? '',
      email: store.email,
      phone: store.phone,
      addressLine1: store.addressLine1 ?? '',
      addressLine2: store.addressLine2 ?? '',
      barangay: store.barangay ?? '',
      city: store.city ?? '',
      province: store.province ?? '',
      postalCode: store.postalCode,
      socialLinks: store.socialLinks,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const socialLinks = Object.fromEntries(
      Object.entries(values.socialLinks ?? {}).filter(([, v]) => v),
    );
    try {
      await update.mutateAsync({
        storeId: store.id,
        body: {
          ...values,
          email: values.email || null,
          phone: values.phone || null,
          postalCode: values.postalCode || null,
          socialLinks,
        },
      });
      toast.success('Store details saved');
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  const control = form.control;
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <FormAlert message={formError} />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>About the store</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field control={control} name="name" label="Store name" disabled={!editable} />
            <Field
              control={control}
              name="description"
              label="Description"
              disabled={!editable}
              multiline
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Contact and address</h2>
            </CardTitle>
            <CardDescription>Shown to shoppers on your store page.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field control={control} name="email" label="Email" type="email" disabled={!editable} />
            <Field
              control={control}
              name="phone"
              label="Mobile number"
              type="tel"
              disabled={!editable}
            />
            <Field
              control={control}
              name="addressLine1"
              label="Street address"
              disabled={!editable}
            />
            <Field
              control={control}
              name="addressLine2"
              label="Unit, building"
              disabled={!editable}
            />
            <Field control={control} name="barangay" label="Barangay" disabled={!editable} />
            <Field
              control={control}
              name="city"
              label="City or municipality"
              disabled={!editable}
            />
            <Field control={control} name="province" label="Province" disabled={!editable} />
            <Field control={control} name="postalCode" label="Postal code" disabled={!editable} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Social media</h2>
            </CardTitle>
            <CardDescription>Full links starting with https://</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {SOCIALS.map(([key, label]) => (
              <Field
                key={key}
                control={control}
                name={`socialLinks.${key}`}
                label={label}
                type="url"
                disabled={!editable}
              />
            ))}
          </CardContent>
        </Card>
        {editable ? (
          <div className="max-w-xs">
            <SubmitButton pending={update.isPending}>Save details</SubmitButton>
          </div>
        ) : null}
      </form>
    </Form>
  );
}

function SettingsTab({ store, editable }: { store: StoreDto; editable: boolean }) {
  const update = useUpdateStoreSettings();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<UpdateStoreSettingsRequest>({
    resolver: zodResolver(updateStoreSettingsSchema),
    values: store.settings,
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v : null);
    try {
      await update.mutateAsync({
        storeId: store.id,
        body: {
          ...values,
          accentColor: blankToNull(values.accentColor),
          announcement: blankToNull(values.announcement),
          shippingPolicy: blankToNull(values.shippingPolicy),
          returnPolicy: blankToNull(values.returnPolicy),
          vacationMessage: blankToNull(values.vacationMessage),
        },
      });
      toast.success('Settings saved');
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  const text = (
    name: keyof UpdateStoreSettingsRequest,
    label: string,
    multiline = false,
    description?: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? (
              <Textarea
                rows={4}
                {...field}
                value={(field.value as string | null) ?? ''}
                disabled={!editable}
              />
            ) : (
              <Input {...field} value={(field.value as string | null) ?? ''} disabled={!editable} />
            )}
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
  const color = (name: 'primaryColor' | 'accentColor', label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${label} picker`}
              value={(field.value as string | null) || '#ffffff'}
              onChange={(e) => field.onChange(e.target.value)}
              disabled={!editable}
              className="h-9 w-12 rounded border"
            />
            <FormControl>
              <Input
                {...field}
                value={(field.value as string | null) ?? ''}
                disabled={!editable}
                className="font-mono"
              />
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <FormAlert message={formError} />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Branding</h2>
            </CardTitle>
            <CardDescription>
              Colours used on your store page. Custom domains come in a later release.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {color('primaryColor', 'Main colour')}
            {color('accentColor', 'Accent colour (optional)')}
            <div className="sm:col-span-2">
              {text(
                'announcement',
                'Announcement bar',
                false,
                'Up to 280 characters, shown at the top of your store.',
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Policies</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {text('shippingPolicy', 'Shipping policy', true)}
            {text('returnPolicy', 'Return and refund policy', true)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Vacation mode</h2>
            </CardTitle>
            <CardDescription>Let shoppers know you are away.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="vacationMode"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={!!field.value}
                      onCheckedChange={(v) => field.onChange(v === true)}
                      disabled={!editable}
                    />
                  </FormControl>
                  <Label className="font-normal">The store is on vacation</Label>
                </FormItem>
              )}
            />
            {text('vacationMessage', 'Message to shoppers')}
          </CardContent>
        </Card>
        {editable ? (
          <div className="max-w-xs">
            <SubmitButton pending={update.isPending}>Save settings</SubmitButton>
          </div>
        ) : null}
      </form>
    </Form>
  );
}

function ImageCard({
  store,
  kind,
  editable,
}: {
  store: StoreDto;
  kind: 'logo' | 'banner';
  editable: boolean;
}) {
  const image = useStoreImage();
  const input = useRef<HTMLInputElement>(null);
  const url = kind === 'logo' ? store.logoUrl : store.bannerUrl;
  const label = kind === 'logo' ? 'Logo' : 'Banner';
  const change = async (file: File | null) => {
    try {
      await image.mutateAsync({ storeId: store.id, kind, file });
      toast.success(file ? `${label} updated` : `${label} removed`);
    } catch (error) {
      showError(`Could not update the ${label.toLowerCase()}`, error);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{label}</h2>
        </CardTitle>
        <CardDescription>
          {kind === 'logo'
            ? 'Square image, at least 256 × 256 px.'
            : 'Wide image, about 1600 × 400 px.'}{' '}
          PNG, JPEG or WebP.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {url ? (
          <img
            src={url}
            alt={`${store.name} ${label.toLowerCase()}`}
            className={
              kind === 'logo'
                ? 'size-32 rounded-md border object-cover'
                : 'aspect-[4/1] w-full rounded-md border object-cover'
            }
          />
        ) : (
          <div
            className={`flex items-center justify-center rounded-md border border-dashed bg-muted/40 ${kind === 'logo' ? 'size-32' : 'aspect-[4/1] w-full'}`}
          >
            <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          </div>
        )}
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label={`Upload ${label.toLowerCase()}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void change(file);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              onClick={() => input.current?.click()}
              disabled={image.isPending}
            >
              {image.isPending ? <Spinner /> : <UploadIcon />} {url ? 'Replace' : 'Upload'}
            </Button>
            {url ? (
              <Button variant="ghost" onClick={() => void change(null)} disabled={image.isPending}>
                <Trash2Icon /> Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusCard({ store, editable }: { store: StoreDto; editable: boolean }) {
  const setOpen = useSetStoreOpen();
  if (store.status === 'SUSPENDED') {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>Suspended by the marketplace</AlertTitle>
        <AlertDescription>
          {store.statusNote ?? 'Contact marketplace support.'} The store is hidden and cannot be
          changed.
        </AlertDescription>
      </Alert>
    );
  }
  const open = store.status === 'ACTIVE';
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Visibility</h2>
        </CardTitle>
        <CardDescription>
          {open ? 'Shoppers can see this store.' : 'The store is hidden from shoppers.'}
        </CardDescription>
      </CardHeader>
      {editable ? (
        <CardContent>
          <ConfirmDialog
            trigger={
              <Button variant={open ? 'outline' : 'default'}>
                {open ? 'Hide store' : 'Open store'}
              </Button>
            }
            title={open ? 'Hide this store?' : 'Open this store?'}
            description={
              open ? 'Shoppers will no longer see it.' : 'Shoppers will be able to find it.'
            }
            confirmLabel={open ? 'Hide' : 'Open'}
            onConfirm={async () => {
              try {
                await setOpen.mutateAsync({ storeId: store.id, open: !open });
              } catch (error) {
                showError('Could not change visibility', error);
                throw error;
              }
            }}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}

export function StoreDetailPage() {
  const { storeId } = useParams();
  const session = useSession();
  const store = useStore(storeId);
  if (store.isPending) return <LoadingState />;
  if (store.isError) {
    return (
      <ErrorState
        message={toDisplayError(store.error)?.message ?? 'Could not load the store.'}
        onRetry={() => void store.refetch()}
      />
    );
  }
  const data = store.data;
  const editable =
    hasPermission(session.data, 'seller.store.manage') &&
    session.data?.user.seller?.status === 'VERIFIED' &&
    data.status !== 'SUSPENDED';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Breadcrumbs items={[{ label: 'Stores', to: '/stores' }, { label: data.name }]} />
      <PageHeader
        title={data.name}
        description={`/${data.slug}`}
        actions={<StoreStatusBadge status={data.status} />}
      />
      {!editable && data.status !== 'SUSPENDED' ? (
        <Alert>
          <AlertDescription>
            You can view this store. Changing it needs the store-management permission.
          </AlertDescription>
        </Alert>
      ) : null}
      <Tabs defaultValue="details">
        <TabsList aria-label="Store sections">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="images">Logo & banner</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="visibility">Visibility</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <DetailsTab store={data} editable={editable} />
        </TabsContent>
        <TabsContent value="images" className="grid gap-4">
          <ImageCard store={data} kind="logo" editable={editable} />
          <ImageCard store={data} kind="banner" editable={editable} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab store={data} editable={editable} />
        </TabsContent>
        <TabsContent value="visibility">
          <StatusCard store={data} editable={editable} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
