import { zodResolver } from '@hookform/resolvers/zod';
import { useSignUpSeller } from '@marketplace/api-client';
import { applyApiErrors, FormAlert, PASSWORD_HINT, SubmitButton } from '@marketplace/auth-ui';
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPES, type BusinessType } from '@marketplace/shared-types';
import {
  AuthShell,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PasswordInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@marketplace/ui';
import { type SellerSignUpRequest, sellerSignUpSchema } from '@marketplace/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { SellerBrand } from '../../components/brand';

/** "Sell with us": creates the owner account and a seller that is verified later. */
export function RegisterPage() {
  const navigate = useNavigate();
  const signUp = useSignUpSeller();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SellerSignUpRequest>({
    resolver: zodResolver(sellerSignUpSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      businessName: '',
      businessType: undefined as unknown as BusinessType,
      mobile: '',
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await signUp.mutateAsync(values);
      toast.success('Welcome to the Seller Center', {
        description: `We sent a link to ${session.user.email}. Confirm it, then complete your application.`,
      });
      void navigate('/verification', { replace: true });
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <AuthShell
      brand={<SellerBrand />}
      title="Sell with us"
      description="Register your business. You can start selling once our team has verified your documents."
      footer={
        <p>
          Already registered?{' '}
          <Link to="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      <Form {...form}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormAlert message={formError} />
          <FormField
            control={form.control}
            name="businessName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registered business name</FormLabel>
                <FormControl>
                  <Input autoComplete="organization" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="businessType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Business type</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose the business type" />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner first name</FormLabel>
                  <FormControl>
                    <Input autoComplete="given-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner last name</FormLabel>
                  <FormControl>
                    <Input autoComplete="family-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="mobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Business mobile number</FormLabel>
                <FormControl>
                  <Input type="tel" inputMode="tel" placeholder="0917 123 4567" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" {...field} />
                </FormControl>
                <FormDescription>
                  You sign in with this email. Use one not registered as a shopper.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>{PASSWORD_HINT}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <SubmitButton pending={signUp.isPending}>Register business</SubmitButton>
        </form>
      </Form>
    </AuthShell>
  );
}
