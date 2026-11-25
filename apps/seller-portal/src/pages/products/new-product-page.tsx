import { zodResolver } from '@hookform/resolvers/zod';
import { useCreateProduct, useMyStores } from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  Breadcrumbs,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@marketplace/ui';
import { type CreateProductRequest, createProductSchema } from '@marketplace/validation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { BrandPicker } from '../../components/catalog/brand-picker';
import { CategorySelect } from '../../components/catalog/category-select';

/** Step one: the basics and one price. Options, photos and pricing follow on the product page. */
export function NewProductPage() {
  const stores = useMyStores();
  const create = useCreateProduct();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateProductRequest>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      storeId: '',
      categoryId: '',
      brandId: null,
      name: '',
      description: '',
      sku: '',
      regularPrice: '',
      specifications: [],
      attributeValues: {},
    },
  });
  const storeList = stores.data?.stores.filter((s) => s.status !== 'SUSPENDED') ?? [];
  const onlyStore = storeList.length === 1 ? storeList[0]!.id : null;
  useEffect(() => {
    if (onlyStore && !form.getValues('storeId')) form.setValue('storeId', onlyStore);
  }, [onlyStore, form]);

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const product = await create.mutateAsync(values);
      toast.success('Draft saved', {
        description: 'Add photos, options and prices, then submit it for approval.',
      });
      void navigate(`/products/${product.id}`);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumbs items={[{ label: 'Products', to: '/products' }, { label: 'Add product' }]} />
      <PageHeader
        title="Add product"
        description="Start with the basics. You can add sizes, colours and photos next."
      />
      <Form {...form}>
        <form onSubmit={submit} noValidate className="space-y-6">
          <FormAlert message={formError} />
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Basics</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField
                control={form.control}
                name="storeId"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Store</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-invalid={!!fieldState.error || undefined}>
                          <SelectValue
                            placeholder={
                              storeList.length ? 'Choose a store' : 'Create a store first'
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {storeList.map((s) => (
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
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. Sinandomeng Rice 25 kg" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <CategorySelect
                        value={field.value}
                        onChange={field.onChange}
                        invalid={!!fieldState.error}
                      />
                    </FormControl>
                    <FormDescription>Choose the most specific category.</FormDescription>
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
                      <BrandPicker value={field.value} onChange={field.onChange} />
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
                      <Textarea rows={6} {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormDescription>
                      At least 30 characters before you can submit it.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Price and SKU</h2>
              </CardTitle>
              <CardDescription>
                For products with sizes or colours, this is the first variant; you set each one
                later.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU</FormLabel>
                    <FormControl>
                      <Input {...field} className="font-mono" placeholder="RICE-SIN-25" />
                    </FormControl>
                    <FormDescription>
                      Your own stock code; unique among your products.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="regularPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Regular price (₱)</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="decimal" placeholder="500.00" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          <div className="max-w-xs">
            <SubmitButton pending={create.isPending}>Save draft</SubmitButton>
          </div>
        </form>
      </Form>
    </div>
  );
}
