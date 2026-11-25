import { zodResolver } from '@hookform/resolvers/zod';
import { useBrands, useRequestBrand } from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@marketplace/ui';
import { type CreateBrandRequest, createBrandSchema } from '@marketplace/validation';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

const NONE = 'none';

/**
 * Picks a brand: active brands plus the seller's own pending requests. A missing brand can be
 * requested; it is usable at once, but the product is approved only after the brand is.
 */
export function BrandPicker({
  value,
  onChange,
  id,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (brandId: string | null) => void;
  id?: string;
  disabled?: boolean;
}) {
  const brands = useBrands({ pageSize: 100 });
  const [requesting, setRequesting] = useState(false);
  const items = (brands.data?.items ?? []).filter(
    (b) => b.status === 'ACTIVE' || b.status === 'PENDING',
  );
  return (
    <div className="flex gap-2">
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
        disabled={disabled || brands.isPending}
      >
        <SelectTrigger id={id} className="flex-1">
          <SelectValue placeholder="No brand" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No brand</SelectItem>
          {items.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
              {b.status === 'PENDING' ? ' (requested)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!disabled ? (
        <Button type="button" variant="outline" onClick={() => setRequesting(true)}>
          <PlusIcon /> Request
        </Button>
      ) : null}
      <RequestBrandDialog
        open={requesting}
        onOpenChange={setRequesting}
        onRequested={(brandId) => onChange(brandId)}
      />
    </div>
  );
}

function RequestBrandDialog({
  open,
  onOpenChange,
  onRequested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequested: (brandId: string) => void;
}) {
  const request = useRequestBrand();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateBrandRequest>({
    resolver: zodResolver(createBrandSchema),
    defaultValues: { name: '', description: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const brand = await request.mutateAsync(values);
      toast.success(`"${brand.name}" requested`, {
        description: 'You can use it now; the product is approved once the brand is.',
      });
      onRequested(brand.id);
      form.reset();
      onOpenChange(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a brand</DialogTitle>
          <DialogDescription>
            The marketplace team checks new brands before they appear on products.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormAlert message={formError} />
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
                  <FormLabel>About the brand (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={request.isPending}>Send request</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
