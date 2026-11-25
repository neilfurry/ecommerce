import { zodResolver } from '@hookform/resolvers/zod';
import { toDisplayError, useAllCategories, useCategoryMutations } from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import { CATEGORY_ATTRIBUTE_TYPES, MAX_CATEGORY_DEPTH } from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  Label,
  LoadingState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@marketplace/ui';
import {
  type CategoryDto,
  type CreateCategoryRequest,
  createCategorySchema,
  slugify,
} from '@marketplace/validation';
import {
  FolderTreeIcon,
  ImageIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { showError } from '../../lib/errors';

type Editing =
  { mode: 'create'; parent: CategoryDto | null } | { mode: 'edit'; category: CategoryDto };

function CategoryDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { create, update } = useCategoryMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const current = editing.mode === 'edit' ? editing.category : null;
  const form = useForm<CreateCategoryRequest>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: {
      name: current?.name ?? '',
      slug: current?.slug ?? '',
      description: current?.description ?? '',
      status: current?.status ?? 'ACTIVE',
      sortOrder: current?.sortOrder ?? 0,
      parentId: editing.mode === 'create' ? (editing.parent?.id ?? null) : undefined,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body = { ...values, slug: values.slug || slugify(values.name) };
    try {
      if (current) {
        const { parentId: _p, ...rest } = body;
        await update.mutateAsync({ categoryId: current.id, body: rest });
      } else {
        await create.mutateAsync(body);
      }
      toast.success(current ? 'Category saved' : 'Category created');
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {current
              ? `Edit ${current.name}`
              : editing.mode === 'create' && editing.parent
                ? `New subcategory of ${editing.parent.name}`
                : 'New top-level category'}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormAlert message={formError} />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                  <FormLabel>Link name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="Generated from the name"
                    />
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
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort order</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" {...field} value={String(field.value ?? 0)} />
                    </FormControl>
                    <FormDescription>Lower numbers first.</FormDescription>
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
                        <SelectItem value="INACTIVE">Inactive (hidden)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <SubmitButton pending={create.isPending || update.isPending}>
              {current ? 'Save' : 'Create'}
            </SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface AttributeDraft {
  code: string;
  name: string;
  type: (typeof CATEGORY_ATTRIBUTE_TYPES)[number];
  options: string;
  unit: string;
  isRequired: boolean;
}

const TYPE_LABELS: Record<AttributeDraft['type'], string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  BOOLEAN: 'Yes / no',
  SELECT: 'Choice list',
};

function AttributesDialog({ category, onClose }: { category: CategoryDto; onClose: () => void }) {
  const { setAttributes } = useCategoryMutations();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<AttributeDraft[]>(
    category.attributes.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      options: a.options.join(', '),
      unit: a.unit ?? '',
      isRequired: a.isRequired,
    })),
  );
  const update = (i: number, patch: Partial<AttributeDraft>) =>
    setDrafts((list) => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const save = async () => {
    setError(null);
    try {
      await setAttributes.mutateAsync({
        categoryId: category.id,
        body: {
          attributes: drafts.map((d, sortOrder) => ({
            code: d.code || slugify(d.name).replace(/-/g, '_'),
            name: d.name,
            type: d.type,
            options:
              d.type === 'SELECT'
                ? d.options
                    .split(',')
                    .map((o) => o.trim())
                    .filter(Boolean)
                : [],
            unit: d.unit,
            isRequired: d.isRequired,
            sortOrder,
          })),
        },
      });
      toast.success('Attributes saved');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Attributes of {category.name}</DialogTitle>
          <DialogDescription>
            Details sellers fill in for products here and in subcategories. Required ones must be
            filled before approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormAlert message={error} />
          {drafts.map((d, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6 sm:items-end">
              <div className="grid gap-1 sm:col-span-2">
                <Label htmlFor={`attr-name-${i}`}>Name</Label>
                <Input
                  id={`attr-name-${i}`}
                  value={d.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`attr-code-${i}`}>Code</Label>
                <Input
                  id={`attr-code-${i}`}
                  className="font-mono"
                  value={d.code}
                  placeholder="auto"
                  onChange={(e) => update(i, { code: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`attr-type-${i}`}>Type</Label>
                <Select
                  value={d.type}
                  onValueChange={(v) => update(i, { type: v as AttributeDraft['type'] })}
                >
                  <SelectTrigger id={`attr-type-${i}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ATTRIBUTE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`attr-unit-${i}`}>Unit</Label>
                <Input
                  id={`attr-unit-${i}`}
                  value={d.unit}
                  placeholder="kg"
                  onChange={(e) => update(i, { unit: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`attr-req-${i}`}
                  checked={d.isRequired}
                  onCheckedChange={(v) => update(i, { isRequired: v === true })}
                />
                <Label htmlFor={`attr-req-${i}`} className="font-normal">
                  Required
                </Label>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove attribute ${i + 1}`}
                  onClick={() => setDrafts((l) => l.filter((_, j) => j !== i))}
                >
                  <Trash2Icon />
                </Button>
              </div>
              {d.type === 'SELECT' ? (
                <div className="grid gap-1 sm:col-span-6">
                  <Label htmlFor={`attr-options-${i}`}>Choices, separated by commas</Label>
                  <Input
                    id={`attr-options-${i}`}
                    value={d.options}
                    onChange={(e) => update(i, { options: e.target.value })}
                  />
                </div>
              ) : null}
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setDrafts((l) => [
                  ...l,
                  { code: '', name: '', type: 'TEXT', options: '', unit: '', isRequired: false },
                ])
              }
            >
              <PlusIcon /> Add attribute
            </Button>
            <Button onClick={() => void save()} disabled={setAttributes.isPending}>
              Save attributes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({
  category,
  onEdit,
}: {
  category: CategoryDto;
  onEdit: (editing: Editing | { mode: 'attributes'; category: CategoryDto }) => void;
}) {
  const { remove, setImage } = useCategoryMutations();
  const input = useRef<HTMLInputElement>(null);
  return (
    <li
      className="flex flex-wrap items-center gap-3 border-b py-3 last:border-0"
      style={{ paddingLeft: `${category.depth * 1.5}rem` }}
    >
      {category.imageUrl ? (
        <img src={category.imageUrl} alt="" className="size-10 rounded border object-cover" />
      ) : (
        <div className="flex size-10 items-center justify-center rounded border bg-muted/40">
          <FolderTreeIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {category.name}{' '}
          {category.status === 'INACTIVE' ? <Badge variant="secondary">Inactive</Badge> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          /{category.slug} · {category.productCount} product(s) · {category.attributes.length}{' '}
          attribute(s)
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {category.depth < MAX_CATEGORY_DEPTH ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onEdit({ mode: 'create', parent: category })}
            aria-label={`Add subcategory to ${category.name}`}
          >
            <PlusIcon /> Sub
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEdit({ mode: 'attributes', category })}
          aria-label={`Attributes of ${category.name}`}
        >
          <ListChecksIcon /> Attributes
        </Button>
        <input
          ref={input}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          className="sr-only"
          aria-label={`Image for ${category.name}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setImage.mutate(
                { categoryId: category.id, file },
                {
                  onSuccess: () => toast.success('Image saved'),
                  onError: (err) => showError('Could not save the image', err),
                },
              );
            }
            e.target.value = '';
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => input.current?.click()}
          aria-label={`Upload image for ${category.name}`}
        >
          <ImageIcon />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEdit({ mode: 'edit', category })}
          aria-label={`Edit ${category.name}`}
        >
          <PencilIcon />
        </Button>
        {category.childCount === 0 && category.productCount === 0 ? (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost" aria-label={`Delete ${category.name}`}>
                <Trash2Icon />
              </Button>
            }
            title={`Delete ${category.name}?`}
            description="Only empty categories can be deleted."
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              try {
                await remove.mutateAsync(category.id);
              } catch (e) {
                showError('Could not delete', e);
                throw e;
              }
            }}
          />
        ) : null}
      </div>
    </li>
  );
}

export function CategoriesPage() {
  const categories = useAllCategories();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [attributesOf, setAttributesOf] = useState<CategoryDto | null>(null);
  const open = (e: Editing | { mode: 'attributes'; category: CategoryDto }) =>
    e.mode === 'attributes' ? setAttributesOf(e.category) : setEditing(e);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Categories"
        description={`The marketplace's category tree (up to ${MAX_CATEGORY_DEPTH + 1} levels). Inactive categories are hidden from shoppers and sellers.`}
        actions={
          <Button onClick={() => setEditing({ mode: 'create', parent: null })}>
            <PlusIcon /> New category
          </Button>
        }
      />
      {categories.isPending ? (
        <LoadingState />
      ) : categories.isError ? (
        <ErrorState
          message={toDisplayError(categories.error)?.message ?? 'Could not load.'}
          onRetry={() => void categories.refetch()}
        />
      ) : categories.data.categories.length === 0 ? (
        <EmptyState icon={FolderTreeIcon} title="No categories yet" />
      ) : (
        <Card>
          <CardContent className="pt-2">
            <ul aria-label="Category tree">
              {categories.data.categories.map((c) => (
                <CategoryRow key={c.id} category={c} onEdit={open} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {editing ? <CategoryDialog editing={editing} onClose={() => setEditing(null)} /> : null}
      {attributesOf ? (
        <AttributesDialog category={attributesOf} onClose={() => setAttributesOf(null)} />
      ) : null}
    </div>
  );
}
