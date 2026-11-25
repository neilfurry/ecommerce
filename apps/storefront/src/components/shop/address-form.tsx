import { zodResolver } from '@hookform/resolvers/zod';
import { toDisplayError, useAddressMutations, useLocations } from '@marketplace/api-client';
import { applyApiErrors, SubmitButton } from '@marketplace/auth-ui';
import {
  type AddressDto,
  type AddressInput,
  addressInputSchema,
  type LocationDto,
} from '@marketplace/validation';
import {
  Alert,
  AlertDescription,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  cn,
} from '@marketplace/ui';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

const NCR = '1300000000';

function NativeSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: LocationDto[] | undefined;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled || !options}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50',
        invalid && 'border-destructive',
      )}
    >
      <option value="">{options ? placeholder : 'Loading…'}</option>
      {options?.map((o) => (
        <option key={o.code} value={o.code}>
          {o.name}
          {o.level === 'CITY' && placeholder.startsWith('Province') ? ' (city)' : ''}
        </option>
      ))}
    </select>
  );
}

/**
 * Add or edit a delivery address. Locations come from the PSGC tables one step at a time:
 * region → province (or a city outside any province) → city or municipality → barangay.
 */
export function AddressForm({
  address,
  onSaved,
  submitLabel = 'Save address',
}: {
  address?: AddressDto;
  onSaved: (address: AddressDto) => void;
  submitLabel?: string;
}) {
  const ids = useId();
  const { create, update } = useAddressMutations();
  const [formError, setFormError] = useState<string | null>(null);
  // The second step: a province, or (Metro Manila, independent cities) the city itself.
  const [areaCode, setAreaCode] = useState(address?.province?.code ?? address?.city.code ?? '');
  const form = useForm<AddressInput>({
    resolver: zodResolver(addressInputSchema) as never,
    defaultValues: {
      label: address?.label ?? '',
      recipientName: address?.recipientName ?? '',
      mobile: address?.mobile ? `0${address.mobile.slice(3)}` : '',
      regionCode: address?.region.code ?? '',
      provinceCode: address?.province?.code ?? null,
      cityCode: address?.city.code ?? '',
      barangayCode: address?.barangay.code ?? '',
      postalCode: address?.postalCode ?? '',
      streetAddress: address?.streetAddress ?? '',
      addressLine2: address?.addressLine2 ?? '',
      isDefault: address?.isDefault ?? false,
    },
  });
  const regionCode = useWatch({ control: form.control, name: 'regionCode' });
  const provinceCode = useWatch({ control: form.control, name: 'provinceCode' });
  const cityCode = useWatch({ control: form.control, name: 'cityCode' });
  const barangayCode = useWatch({ control: form.control, name: 'barangayCode' });
  const regions = useLocations(undefined);
  const areas = useLocations(regionCode || null);
  const area = areas.data?.find((a) => a.code === areaCode);
  const cities = useLocations(provinceCode || null);
  const barangays = useLocations(cityCode || null);
  const errors = form.formState.errors;

  const chooseRegion = (code: string) => {
    form.setValue('regionCode', code, { shouldValidate: form.formState.isSubmitted });
    form.setValue('provinceCode', null);
    form.setValue('cityCode', '');
    form.setValue('barangayCode', '');
    setAreaCode('');
  };
  const chooseArea = (code: string) => {
    setAreaCode(code);
    const chosen = areas.data?.find((a) => a.code === code);
    form.setValue('provinceCode', chosen?.level === 'PROVINCE' ? code : null);
    form.setValue('cityCode', chosen && chosen.level !== 'PROVINCE' ? code : '', {
      shouldValidate: form.formState.isSubmitted,
    });
    form.setValue('barangayCode', '');
  };

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = address
        ? await update.mutateAsync({ id: address.id, body: values })
        : await create.mutateAsync(values);
      onSaved(saved);
    } catch (error) {
      setFormError(applyApiErrors(form, error) ?? toDisplayError(error)?.message ?? null);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="recipientName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Recipient’s full name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="mobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mobile number</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0917 123 4567"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${ids}-region`}>Region</Label>
            <NativeSelect
              id={`${ids}-region`}
              value={regionCode}
              onChange={chooseRegion}
              options={regions.data}
              placeholder="Choose a region"
              invalid={!!errors.regionCode}
            />
            {errors.regionCode ? (
              <p className="text-sm text-destructive">{errors.regionCode.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${ids}-area`}>
              {regionCode === NCR ? 'City or municipality' : 'Province (or city)'}
            </Label>
            <NativeSelect
              id={`${ids}-area`}
              value={areaCode}
              onChange={chooseArea}
              options={regionCode ? areas.data : []}
              placeholder={regionCode === NCR ? 'Choose a city' : 'Province or independent city'}
              disabled={!regionCode}
              invalid={!!errors.cityCode && !areaCode}
            />
          </div>
          {area?.level === 'PROVINCE' ? (
            <div className="space-y-2">
              <Label htmlFor={`${ids}-city`}>City or municipality</Label>
              <NativeSelect
                id={`${ids}-city`}
                value={cityCode}
                onChange={(code) => {
                  form.setValue('cityCode', code, { shouldValidate: form.formState.isSubmitted });
                  form.setValue('barangayCode', '');
                }}
                options={cities.data}
                placeholder="Choose a city or municipality"
                invalid={!!errors.cityCode}
              />
              {errors.cityCode ? (
                <p className="text-sm text-destructive">{errors.cityCode.message}</p>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor={`${ids}-barangay`}>Barangay</Label>
            <NativeSelect
              id={`${ids}-barangay`}
              value={barangayCode}
              onChange={(code) =>
                form.setValue('barangayCode', code, { shouldValidate: form.formState.isSubmitted })
              }
              options={cityCode ? barangays.data : []}
              placeholder="Choose a barangay"
              disabled={!cityCode}
              invalid={!!errors.barangayCode}
            />
            {errors.barangayCode ? (
              <p className="text-sm text-destructive">{errors.barangayCode.message}</p>
            ) : null}
          </div>
          <FormField
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postal code</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" autoComplete="postal-code" maxLength={4} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="streetAddress"
          render={({ field }) => (
            <FormItem>
              <FormLabel>House number and street</FormLabel>
              <FormControl>
                <Input
                  autoComplete="address-line1"
                  placeholder="e.g. 45 Kalayaan Street"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="addressLine2"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Building, floor, subdivision or landmark (optional)</FormLabel>
              <FormControl>
                <Input autoComplete="address-line2" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="label"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Label (optional)</FormLabel>
                <FormControl>
                  <Input placeholder="Home, Office…" {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isDefault"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 pt-7">
                <FormControl>
                  <Checkbox
                    checked={!!field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                    disabled={address?.isDefault}
                  />
                </FormControl>
                <FormLabel className="font-normal">Use as my default address</FormLabel>
              </FormItem>
            )}
          />
        </div>
        <SubmitButton pending={create.isPending || update.isPending}>{submitLabel}</SubmitButton>
      </form>
    </Form>
  );
}
