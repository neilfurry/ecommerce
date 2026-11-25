import {
  toDisplayError,
  useAdminProducts,
  useAdminStores,
  useBannerMutations,
  useBanners,
  useFeatured,
  useFeaturedMutations,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import { BANNER_PLACEMENTS, type BannerPlacement } from '@marketplace/shared-types';
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
import type { BannerAdminDto } from '@marketplace/validation';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImageIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { formatDateTime } from '../../lib/format';
import { showError } from '../../lib/errors';

const PLACEMENT_LABELS: Record<BannerPlacement, string> = {
  HERO: 'Hero carousel',
  PROMO: 'Promo strip',
};

interface BannerValues {
  title: string;
  subtitle: string;
  linkUrl: string;
  placement: BannerPlacement;
  status: 'ACTIVE' | 'INACTIVE';
  position: string;
  startsAt: string;
  endsAt: string;
  file: File | undefined;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

function BannerDialog({ banner, onClose }: { banner: BannerAdminDto | null; onClose: () => void }) {
  const { create, update, replaceImage } = useBannerMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<BannerValues>({
    defaultValues: {
      title: banner?.title ?? '',
      subtitle: banner?.subtitle ?? '',
      linkUrl: banner?.linkUrl ?? '',
      placement: banner?.placement ?? 'HERO',
      status: banner?.status ?? 'ACTIVE',
      position: String(banner?.position ?? 0),
      startsAt: toLocalInput(banner?.startsAt ?? null),
      endsAt: toLocalInput(banner?.endsAt ?? null),
      file: undefined,
    },
  });
  const pending = create.isPending || update.isPending || replaceImage.isPending;

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const fields = {
      title: v.title,
      subtitle: v.subtitle.trim() || null,
      linkUrl: v.linkUrl.trim() || null,
      placement: v.placement,
      status: v.status,
      position: Number(v.position || 0),
      startsAt: toIso(v.startsAt) || null,
      endsAt: toIso(v.endsAt) || null,
    };
    try {
      if (banner) {
        await update.mutateAsync({ id: banner.id, body: fields });
        if (v.file) await replaceImage.mutateAsync({ id: banner.id, file: v.file });
      } else {
        if (!v.file) {
          form.setError('file', { message: 'Choose an image' });
          return;
        }
        const data = new FormData();
        data.append('file', v.file);
        for (const [key, value] of Object.entries(fields)) {
          if (value !== null && value !== '') data.append(key, String(value));
        }
        await create.mutateAsync(data);
      }
      toast.success(banner ? 'Banner saved' : 'Banner added');
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{banner ? 'Edit banner' : 'New banner'}</DialogTitle>
          <DialogDescription>
            Shown on the storefront home page between the start and end dates.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormAlert message={formError} />
            </div>
            <FormField
              control={form.control}
              name="file"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{banner ? 'Replace image (optional)' : 'Image'}</FormLabel>
                  <FormControl>
                    <Input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      onChange={(e) => field.onChange(e.target.files?.[0])}
                    />
                  </FormControl>
                  <FormDescription>
                    PNG, JPEG or WebP. Wide images work best (about 1600 × 600).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {(
              [
                ['title', 'Title', 'sm:col-span-2'],
                ['subtitle', 'Subtitle (optional)', 'sm:col-span-2'],
                ['linkUrl', 'Link (optional)', undefined, 'A store path, e.g. /c/laptops'],
                ['position', 'Order', undefined, 'Lower numbers show first'],
                ['startsAt', 'Starts (optional)', undefined, undefined, 'datetime-local'],
                ['endsAt', 'Ends (optional)', undefined, undefined, 'datetime-local'],
              ] as const
            ).map(([name, label, className, description, type]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem className={className}>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <Input {...field} type={type ?? 'text'} />
                    </FormControl>
                    {description ? <FormDescription>{description}</FormDescription> : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <FormField
              control={form.control}
              name="placement"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Placement</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BANNER_PLACEMENTS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PLACEMENT_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                      <SelectItem value="ACTIVE">Showing</SelectItem>
                      <SelectItem value="INACTIVE">Hidden</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">
              <SubmitButton pending={pending}>{banner ? 'Save' : 'Add banner'}</SubmitButton>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function Banners() {
  const banners = useBanners();
  const { remove } = useBannerMutations();
  const [editing, setEditing] = useState<BannerAdminDto | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <PlusIcon /> New banner
        </Button>
      </div>
      {banners.isPending ? (
        <LoadingState />
      ) : banners.isError ? (
        <ErrorState
          message={toDisplayError(banners.error)?.message ?? 'Could not load.'}
          onRetry={() => void banners.refetch()}
        />
      ) : banners.data.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No banners"
          description="Banners promote categories, stores and sales on the home page."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {banners.data.map((b) => (
            <Card key={b.id} className={b.status === 'INACTIVE' ? 'opacity-70' : undefined}>
              <img
                src={b.imageUrl}
                alt=""
                className="aspect-[8/3] w-full rounded-t-xl border-b object-cover"
              />
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <h2>{b.title}</h2>
                  <Badge variant="outline">{PLACEMENT_LABELS[b.placement]}</Badge>
                  {b.status === 'INACTIVE' ? <Badge variant="secondary">Hidden</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {b.subtitle ?? 'No subtitle'}
                  {b.linkUrl ? ` · links to ${b.linkUrl}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Order {b.position}
                  {b.startsAt ? ` · from ${formatDateTime(b.startsAt)}` : ''}
                  {b.endsAt ? ` · until ${formatDateTime(b.endsAt)}` : ''}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(b)}>
                    <PencilIcon /> Edit
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="ghost" aria-label={`Delete ${b.title}`}>
                        <Trash2Icon />
                      </Button>
                    }
                    title={`Delete “${b.title}”?`}
                    description="The banner and its image are removed."
                    confirmLabel="Delete"
                    onConfirm={async () => {
                      try {
                        await remove.mutateAsync(b.id);
                      } catch (e) {
                        showError('Could not delete the banner', e);
                        throw e;
                      }
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing ? (
        <BannerDialog
          banner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

interface Pick {
  id: string;
  label: string;
  detail: string;
}

/** An ordered list edited locally, then saved in one request. */
function OrderedPicker({
  title,
  description,
  initial,
  max,
  search,
  onSearch,
  results,
  saving,
  onSave,
}: {
  title: string;
  description: string;
  initial: Pick[];
  max: number;
  search: string;
  onSearch: (v: string) => void;
  results: Pick[] | undefined;
  saving: boolean;
  onSave: (ids: string[]) => Promise<unknown>;
}) {
  const [items, setItems] = useState(initial);
  const move = (index: number, delta: number) =>
    setItems((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });
  const chosen = new Set(items.map((i) => i.id));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Featured ({items.length}/{max})
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing featured yet.</p>
          ) : (
            <ol className="divide-y rounded-md border">
              {items.map((item, index) => (
                <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="w-5 text-muted-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{item.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Move ${item.label} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Move ${item.label} down`}
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${item.label}`}
                    onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <Button
            disabled={saving}
            onClick={() =>
              void onSave(items.map((i) => i.id)).then(
                () => toast.success(`${title} saved`),
                (e: unknown) => showError(`Could not save ${title.toLowerCase()}`, e),
              )
            }
          >
            Save order
          </Button>
        </div>
        <div className="space-y-2">
          <Input
            type="search"
            aria-label={`Search to add to ${title.toLowerCase()}`}
            placeholder="Search to add"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <ul className="divide-y rounded-md border">
            {(results ?? [])
              .filter((r) => !chosen.has(r.id))
              .slice(0, 8)
              .map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{r.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.detail}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={items.length >= max}
                    onClick={() => setItems((list) => [...list, r])}
                  >
                    <PlusIcon /> Add
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function Featured() {
  const featured = useFeatured();
  const { putProducts, putStores } = useFeaturedMutations();
  const [productSearch, setProductSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const deferredProducts = useDeferredValue(productSearch.trim());
  const deferredStores = useDeferredValue(storeSearch.trim());
  const products = useAdminProducts({
    status: 'ACTIVE',
    search: deferredProducts || undefined,
    pageSize: 20,
  });
  const stores = useAdminStores({
    status: 'ACTIVE',
    search: deferredStores || undefined,
    pageSize: 20,
  });
  if (featured.isPending) return <LoadingState />;
  if (featured.isError)
    return (
      <ErrorState
        message={toDisplayError(featured.error)?.message ?? 'Could not load.'}
        onRetry={() => void featured.refetch()}
      />
    );
  return (
    <div className="space-y-6">
      <OrderedPicker
        // Remount after a save so the list starts from what the server stored.
        key={`p-${featured.dataUpdatedAt}`}
        title="Featured products"
        description="Shown in “Featured products” on the home page. Products that are no longer for sale are skipped."
        initial={featured.data.products.map((p) => ({
          id: p.productId,
          label: p.name,
          detail: `${p.storeName}${p.visible ? '' : ' · not visible to shoppers'}`,
        }))}
        max={24}
        search={productSearch}
        onSearch={setProductSearch}
        results={products.data?.items.map((p) => ({
          id: p.id,
          label: p.name,
          detail: p.storeName,
        }))}
        saving={putProducts.isPending}
        onSave={(ids) => putProducts.mutateAsync(ids)}
      />
      <OrderedPicker
        key={`s-${featured.dataUpdatedAt}`}
        title="Featured stores"
        description="Shown in “Featured stores” on the home page."
        initial={featured.data.stores.map((s) => ({ id: s.storeId, label: s.name, detail: '' }))}
        max={12}
        search={storeSearch}
        onSearch={setStoreSearch}
        results={stores.data?.items.map((s) => ({
          id: s.id,
          label: s.name,
          detail: s.sellerName,
        }))}
        saving={putStores.isPending}
        onSave={(ids) => putStores.mutateAsync(ids)}
      />
    </div>
  );
}

/** Home page content: banners and featured products and stores. */
export function StorefrontContentPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Storefront content"
        description="What shoppers see on the home page. Changes show on the storefront right away."
      />
      <Tabs defaultValue="banners">
        <TabsList aria-label="Content type">
          <TabsTrigger value="banners">Banners</TabsTrigger>
          <TabsTrigger value="featured">Featured</TabsTrigger>
        </TabsList>
        <TabsContent value="banners">
          <Banners />
        </TabsContent>
        <TabsContent value="featured">
          <Featured />
        </TabsContent>
      </Tabs>
    </div>
  );
}
