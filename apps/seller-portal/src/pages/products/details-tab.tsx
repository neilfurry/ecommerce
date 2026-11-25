import { zodResolver } from '@hookform/resolvers/zod';
import { useCategoryAttributes, useMyStores, useUpdateProduct } from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@marketplace/ui';
import {
  type CategoryAttributeDto,
  type ProductDetail,
  type UpdateProductRequest,
  updateProductSchema,
} from '@marketplace/validation';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { type Control, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { BrandPicker } from '../../components/catalog/brand-picker';
import { CategorySelect } from '../../components/catalog/category-select';

type Values = UpdateProductRequest & {
  specifications: { name: string; value: string }[];
  attributeValues: Record<string, string | number | boolean>;
};

function AttributeField({
  control,
  attribute,
  disabled,
}: {
  control: Control<Values>;
  attribute: CategoryAttributeDto;
  disabled: boolean;
}) {
  const id = `attr-${attribute.code}`;
  const label = `${attribute.name}${attribute.unit ? ` (${attribute.unit})` : ''}${attribute.isRequired ? ' *' : ''}`;
  return (
    <FormField
      control={control}
      name={`attributeValues.${attribute.code}`}
      render={({ field }) => (
        <FormItem>
          {attribute.type === 'BOOLEAN' ? (
            <div className="flex items-center gap-2 pt-6">
              <Checkbox
                id={id}
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true)}
                disabled={disabled}
              />
              <Label htmlFor={id} className="font-normal">
                {label}
              </Label>
            </div>
          ) : (
            <>
              <FormLabel htmlFor={id}>{label}</FormLabel>
              {attribute.type === 'SELECT' ? (
                <Select
                  value={(field.value as string | undefined) ?? ''}
                  onValueChange={field.onChange}
                  disabled={disabled}
                >
                  <SelectTrigger id={id}>
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {attribute.options.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id}
                  inputMode={attribute.type === 'NUMBER' ? 'decimal' : undefined}
                  value={field.value === undefined ? '' : String(field.value)}
                  onChange={(e) =>
                    field.onChange(
                      attribute.type === 'NUMBER'
                        ? e.target.value === ''
                          ? ''
                          : Number.isNaN(Number(e.target.value))
                            ? e.target.value
                            : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                  disabled={disabled}
                />
              )}
            </>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Name, category, brand, description, specifications, attributes and SEO. */
export function DetailsTab({ product, editable }: { product: ProductDetail; editable: boolean }) {
  const update = useUpdateProduct();
  const stores = useMyStores();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(updateProductSchema) as never,
    values: {
      storeId: product.storeId,
      name: product.name,
      slug: product.slug,
      categoryId: product.category.id,
      brandId: product.brand?.id ?? null,
      description: product.description ?? '',
      specifications: product.specifications,
      attributeValues: product.attributeValues,
      seoTitle: product.seoTitle ?? '',
      seoDescription: product.seoDescription ?? '',
      seoKeywords: product.seoKeywords ?? '',
    },
  });
  const specs = useFieldArray({ control: form.control, name: 'specifications' });
  const categoryId = useWatch({ control: form.control, name: 'categoryId' });
  const attributes = useCategoryAttributes(categoryId);
  const approved = product.status === 'ACTIVE' || product.status === 'INACTIVE';

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const known = new Set((attributes.data?.attributes ?? []).map((a) => a.code));
    const attributeValues = Object.fromEntries(
      Object.entries(values.attributeValues ?? {}).filter(
        ([code, v]) => known.has(code) && v !== '',
      ),
    );
    try {
      const saved = await update.mutateAsync({
        productId: product.id,
        body: { ...values, attributeValues },
      });
      toast.success('Product saved', {
        description:
          saved.status === 'PENDING_APPROVAL' && approved
            ? 'The changes go to the marketplace team; the product is hidden until approved.'
            : undefined,
      });
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  const text = (
    name: 'name' | 'slug' | 'seoTitle' | 'seoKeywords',
    label: string,
    description?: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={(field.value as string | null | undefined) ?? ''}
              disabled={!editable}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
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
              <h2>About the product</h2>
            </CardTitle>
            {approved && editable ? (
              <CardDescription>
                Changing the name, category, brand, description, specifications or attributes sends
                the product back for approval; it is hidden until approved.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            {text('name', 'Product name')}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <CategorySelect
                        value={field.value}
                        onChange={field.onChange}
                        disabled={!editable}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brandId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <FormControl>
                      <BrandPicker
                        value={field.value}
                        onChange={field.onChange}
                        disabled={!editable}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={8} {...field} value={field.value ?? ''} disabled={!editable} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="storeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Store</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(stores.data?.stores ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {text('slug', 'Link name', 'Shown in the product address.')}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Category details</h2>
            </CardTitle>
            <CardDescription>
              What this category asks for. Fields marked * are needed before approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {(attributes.data?.attributes ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                This category has no extra details.
              </p>
            ) : (
              attributes.data!.attributes.map((a) => (
                <AttributeField
                  key={a.id}
                  control={form.control}
                  attribute={a}
                  disabled={!editable}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Specifications</h2>
            </CardTitle>
            <CardDescription>
              Anything else shoppers should know, e.g. Origin: Nueva Ecija.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {specs.fields.map((spec, index) => (
              <div key={spec.id} className="grid grid-cols-[1fr_2fr_auto] items-start gap-2">
                <FormField
                  control={form.control}
                  name={`specifications.${index}.name`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          {...field}
                          aria-label={`Specification ${index + 1} name`}
                          placeholder="Name"
                          disabled={!editable}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`specifications.${index}.value`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          {...field}
                          aria-label={`Specification ${index + 1} value`}
                          placeholder="Value"
                          disabled={!editable}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {editable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove specification ${index + 1}`}
                    onClick={() => specs.remove(index)}
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}
              </div>
            ))}
            {editable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => specs.append({ name: '', value: '' })}
              >
                <PlusIcon /> Add specification
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Search engines</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {text('seoTitle', 'Page title', 'Up to 70 characters. Defaults to the product name.')}
            <FormField
              control={form.control}
              name="seoDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Meta description</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} value={field.value ?? ''} disabled={!editable} />
                  </FormControl>
                  <FormDescription>Up to 160 characters.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {text('seoKeywords', 'Keywords', 'Comma-separated.')}
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
