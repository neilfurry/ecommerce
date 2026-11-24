import { zodResolver } from '@hookform/resolvers/zod';
import {
  hasPermission,
  toDisplayError,
  useSellerProfile,
  useSession,
  useUpdateSellerProfile,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPES } from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
  toast,
} from '@marketplace/ui';
import {
  type SellerDetail,
  type UpdateSellerProfileRequest,
  updateSellerProfileSchema,
} from '@marketplace/validation';
import { LockIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

const text = (value: string | null) => value ?? '';

function ProfileForm({ seller, canEdit }: { seller: SellerDetail; canEdit: boolean }) {
  const update = useUpdateSellerProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const legalLocked = !seller.legalDetailsEditable || !canEdit;
  const form = useForm<UpdateSellerProfileRequest>({
    resolver: zodResolver(updateSellerProfileSchema),
    values: {
      businessName: seller.businessName,
      businessType: seller.businessType,
      registrationNumber: text(seller.registrationNumber),
      tin: text(seller.tin),
      vatRegistered: seller.vatRegistered,
      email: seller.email,
      mobile: seller.mobile,
      addressLine1: text(seller.addressLine1),
      addressLine2: text(seller.addressLine2),
      barangay: text(seller.barangay),
      city: text(seller.city),
      province: text(seller.province),
      postalCode: text(seller.postalCode),
    },
  });
  const businessType = useWatch({ control: form.control, name: 'businessType' });
  const registry = BUSINESS_TYPE_LABELS[businessType ?? seller.businessType].registry;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    // Only send what changed, and never locked fields.
    const dirty = Object.fromEntries(
      Object.entries(values).filter(
        ([key]) => form.formState.dirtyFields[key as keyof typeof values],
      ),
    );
    if (Object.keys(dirty).length === 0) return;
    try {
      await update.mutateAsync(dirty);
      toast.success('Business profile saved');
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  const textField = (
    name: keyof UpdateSellerProfileRequest,
    label: string,
    opts: {
      locked?: boolean;
      description?: string;
      autoComplete?: string;
      inputMode?: 'numeric' | 'tel';
    } = {},
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
              value={(field.value as string | undefined) ?? ''}
              disabled={opts.locked || !canEdit}
              autoComplete={opts.autoComplete}
              inputMode={opts.inputMode}
            />
          </FormControl>
          {opts.description ? <FormDescription>{opts.description}</FormDescription> : null}
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
              <h2>Legal details</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {legalLocked && canEdit ? (
              <Alert className="sm:col-span-2">
                <LockIcon />
                <AlertDescription>
                  {seller.status === 'UNDER_REVIEW'
                    ? 'Legal details are locked while your application is reviewed.'
                    : 'Legal details of a verified business can only be changed by marketplace support.'}
                </AlertDescription>
              </Alert>
            ) : null}
            {textField('businessName', 'Registered business name', {
              locked: legalLocked,
              autoComplete: 'organization',
            })}
            <FormField
              control={form.control}
              name="businessType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={legalLocked}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BUSINESS_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {BUSINESS_TYPE_LABELS[type].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {textField('registrationNumber', registry, { locked: legalLocked })}
            {textField('tin', 'BIR TIN', {
              locked: legalLocked,
              inputMode: 'numeric',
              description: 'e.g. 123-456-789-000',
            })}
            <FormField
              control={form.control}
              name="vatRegistered"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 sm:col-span-2">
                  <FormControl>
                    <Checkbox
                      checked={!!field.value}
                      onCheckedChange={(v) => field.onChange(v === true)}
                      disabled={legalLocked}
                    />
                  </FormControl>
                  <Label className="font-normal">VAT-registered</Label>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Contact and address</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {textField('email', 'Business email', { autoComplete: 'email' })}
            {textField('mobile', 'Business mobile number', {
              inputMode: 'tel',
              autoComplete: 'tel',
            })}
            {textField('addressLine1', 'Street address', { autoComplete: 'address-line1' })}
            {textField('addressLine2', 'Unit, building (optional)', {
              autoComplete: 'address-line2',
            })}
            {textField('barangay', 'Barangay (optional)')}
            {textField('city', 'City or municipality', { autoComplete: 'address-level2' })}
            {textField('province', 'Province', { autoComplete: 'address-level1' })}
            {textField('postalCode', 'Postal code', {
              inputMode: 'numeric',
              autoComplete: 'postal-code',
            })}
          </CardContent>
        </Card>
        {canEdit ? (
          <div className="max-w-xs">
            <SubmitButton pending={update.isPending}>Save profile</SubmitButton>
          </div>
        ) : null}
      </form>
    </Form>
  );
}

export function ProfilePage() {
  const session = useSession();
  const profile = useSellerProfile();
  const canEdit =
    hasPermission(session.data, 'seller.profile.manage') &&
    !!profile.data &&
    !['SUSPENDED', 'CLOSED'].includes(profile.data.status);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Business profile"
        description={
          canEdit
            ? 'Keep your business details current.'
            : 'Only the owner (or people they allow) can edit these details.'
        }
      />
      {profile.isPending ? (
        <LoadingState />
      ) : profile.isError ? (
        <ErrorState
          message={toDisplayError(profile.error)?.message ?? 'Could not load the profile.'}
          onRetry={() => void profile.refetch()}
        />
      ) : (
        <ProfileForm seller={profile.data} canEdit={canEdit} />
      )}
    </div>
  );
}
