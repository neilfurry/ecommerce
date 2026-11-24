import { zodResolver } from '@hookform/resolvers/zod';
import { useCompleteSignUp, useStartSignUp } from '@marketplace/api-client';
import { applyApiErrors, FormAlert, PASSWORD_HINT, SubmitButton } from '@marketplace/auth-ui';
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
  Label,
  PasswordInput,
  Textarea,
  toast,
} from '@marketplace/ui';
import {
  type CustomerSignUpRequest,
  customerSignUpSchema,
  type OtpChallengeResponse,
} from '@marketplace/validation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { OtpStep } from '../../components/otp-step';
import { StoreBrand } from '../../components/store-brand';

const ACCOUNT_TYPES = [
  { value: 'RETAIL', title: 'Personal', description: 'Shop for yourself or your family.' },
  {
    value: 'WHOLESALE',
    title: 'Business (wholesale)',
    description:
      'Bulk prices for registered businesses after we check your details. Shop at retail prices meanwhile.',
  },
] as const;

export function SignUpPage() {
  const navigate = useNavigate();
  const start = useStartSignUp();
  const complete = useCompleteSignUp();
  const [challenge, setChallenge] = useState<OtpChallengeResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CustomerSignUpRequest>({
    // Business details are kept while switching account types but only sent for wholesale.
    resolver: (values, context, options) =>
      zodResolver(customerSignUpSchema)(
        values.accountType === 'WHOLESALE' ? values : { ...values, business: undefined },
        context,
        options,
      ),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      mobile: '',
      password: '',
      accountType: 'RETAIL',
      business: { businessName: '', tin: '', businessAddress: '' },
    },
  });
  const accountType = useWatch({ control: form.control, name: 'accountType' });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      setChallenge(await start.mutateAsync(values));
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  if (challenge) {
    return (
      <AuthShell brand={<StoreBrand />} title="Confirm your mobile number">
        <OtpStep
          challenge={challenge}
          onChallengeChange={setChallenge}
          pending={complete.isPending}
          submitLabel="Create account"
          backLabel="Change my details"
          onBack={() => setChallenge(null)}
          onSubmit={async (code) => {
            const session = await complete.mutateAsync({
              challengeId: challenge.challengeId,
              code,
            });
            toast.success(`Welcome, ${session.user.firstName}!`, {
              description: `We sent a link to ${session.user.email} to confirm your email address.`,
            });
            void navigate('/account', { replace: true });
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      brand={<StoreBrand />}
      title="Create your account"
      description="We'll text a code to your mobile number to confirm it's yours."
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      <Form {...form}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormAlert message={formError} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Account type</legend>
            {ACCOUNT_TYPES.map((type) => (
              <Label
                key={type.value}
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[:checked]:border-primary has-[:checked]:bg-accent/40"
              >
                <input
                  type="radio"
                  value={type.value}
                  className="mt-1 accent-primary"
                  {...form.register('accountType')}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{type.title}</span>
                  <span className="text-xs text-muted-foreground">{type.description}</span>
                </span>
              </Label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First name</FormLabel>
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
                  <FormLabel>Last name</FormLabel>
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
                <FormLabel>Mobile number</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="0917 123 4567"
                    {...field}
                  />
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
                <FormDescription>For receipts and order updates.</FormDescription>
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
          {accountType === 'WHOLESALE' ? (
            <fieldset className="flex flex-col gap-4 rounded-md border p-4">
              <legend className="px-1 text-sm font-medium">Business details</legend>
              <FormField
                control={form.control}
                name="business.businessName"
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
                name="business.tin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>TIN</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="123-456-789-000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="business.businessAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business address</FormLabel>
                    <FormControl>
                      <Textarea rows={2} autoComplete="street-address" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>
          ) : null}
          <SubmitButton pending={start.isPending}>Continue</SubmitButton>
        </form>
      </Form>
    </AuthShell>
  );
}
