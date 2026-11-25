import { toDisplayError, useBrandMutations, useBrands } from '@marketplace/api-client';
import { BRAND_STATUS_LABELS, BRAND_STATUSES, type BrandStatus } from '@marketplace/shared-types';
import { zodResolver } from '@hookform/resolvers/zod';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  DataTable,
  type DataTableColumn,
  Input,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from '@marketplace/ui';
import { type BrandDto, type CreateBrandRequest, createBrandSchema } from '@marketplace/validation';
import { useForm } from 'react-hook-form';
import { CheckIcon, PlusIcon, TagIcon, XIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { ReasonDialog } from '../../components/reason-dialog';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 25;

function NewBrand() {
  const { create } = useBrandMutations();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateBrandRequest>({
    resolver: zodResolver(createBrandSchema),
    defaultValues: { name: '', description: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const brand = await create.mutateAsync(values);
      toast.success(`${brand.name} added`);
      form.reset();
      setOpen(false);
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> New brand
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a brand</DialogTitle>
          <DialogDescription>
            Active at once; sellers can choose it for their products.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormAlert message={error} />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={create.isPending}>Add brand</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function BrandActions({ brand }: { brand: BrandDto }) {
  const { review, update } = useBrandMutations();
  if (brand.status === 'PENDING') {
    return (
      <div className="flex justify-end gap-2">
        <ConfirmDialog
          trigger={
            <Button size="sm">
              <CheckIcon /> Approve
            </Button>
          }
          title={`Approve "${brand.name}"?`}
          description="It becomes available to every seller."
          confirmLabel="Approve"
          onConfirm={async () => {
            try {
              await review.mutateAsync({ brandId: brand.id, body: { decision: 'APPROVE' } });
              toast.success('Brand approved');
            } catch (e) {
              showError('Could not approve', e);
              throw e;
            }
          }}
        />
        <ReasonDialog
          trigger={
            <Button size="sm" variant="outline">
              <XIcon /> Reject
            </Button>
          }
          title={`Reject "${brand.name}"?`}
          description="The seller sees the reason. Products using it cannot be approved."
          submitLabel="Reject brand"
          onSubmit={async (note) => {
            await review.mutateAsync({ brandId: brand.id, body: { decision: 'REJECT', note } });
            toast.success('Brand rejected');
          }}
        />
      </div>
    );
  }
  if (brand.status === 'ACTIVE' || brand.status === 'INACTIVE') {
    const retiring = brand.status === 'ACTIVE';
    return (
      <div className="flex justify-end">
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="ghost">
              {retiring ? 'Retire' : 'Reactivate'}
            </Button>
          }
          title={retiring ? `Retire "${brand.name}"?` : `Reactivate "${brand.name}"?`}
          description={
            retiring
              ? 'Existing products keep it; new products cannot choose it.'
              : 'Sellers can choose it again.'
          }
          confirmLabel={retiring ? 'Retire' : 'Reactivate'}
          onConfirm={async () => {
            try {
              await update.mutateAsync({
                brandId: brand.id,
                body: { status: retiring ? 'INACTIVE' : 'ACTIVE' },
              });
            } catch (e) {
              showError('Could not change the brand', e);
              throw e;
            }
          }}
        />
      </div>
    );
  }
  return null;
}

/** The global brand list and sellers' brand requests. */
export function BrandsPage() {
  const [status, setStatus] = useState<BrandStatus>('PENDING');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const brands = useBrands({ status, search: deferred || undefined, page, pageSize: PAGE_SIZE });
  const columns: DataTableColumn<BrandDto>[] = [
    {
      id: 'name',
      header: 'Brand',
      cell: (b) => (
        <div>
          <p className="font-medium">{b.name}</p>
          {b.description ? <p className="text-xs text-muted-foreground">{b.description}</p> : null}
        </div>
      ),
    },
    {
      id: 'requested',
      header: 'Requested by',
      hideOnMobile: true,
      cell: (b) => b.requestedBy?.businessName ?? 'Marketplace',
    },
    { id: 'products', header: 'Products', cell: (b) => b.productCount },
    {
      id: 'created',
      header: 'Added',
      hideOnMobile: true,
      cell: (b) => formatDateTime(b.createdAt),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (b) => (
        <div>
          <Badge
            variant={
              b.status === 'ACTIVE' ? 'success' : b.status === 'PENDING' ? 'warning' : 'secondary'
            }
          >
            {BRAND_STATUS_LABELS[b.status]}
          </Badge>
          {b.reviewNote ? (
            <p className="mt-1 max-w-56 text-xs text-muted-foreground">{b.reviewNote}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (b) => <BrandActions brand={b} />,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Brands"
        description="Brands sellers can choose. Requests from sellers wait here for a decision."
        actions={<NewBrand />}
      />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v as BrandStatus);
            setPage(1);
          }}
        >
          <TabsList aria-label="Brand status">
            {BRAND_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {BRAND_STATUS_LABELS[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          type="search"
          aria-label="Search brands"
          placeholder="Brand name"
          className="lg:max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        label="Brands"
        columns={columns}
        rows={brands.data?.items}
        getRowId={(b) => b.id}
        isLoading={brands.isPending}
        error={toDisplayError(brands.error)}
        onRetry={() => void brands.refetch()}
        empty={{
          icon: TagIcon,
          title: status === 'PENDING' ? 'No brand requests waiting' : 'No brands',
        }}
        pagination={
          brands.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: brands.data.totalItems,
                onPageChange: setPage,
                isFetching: brands.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
