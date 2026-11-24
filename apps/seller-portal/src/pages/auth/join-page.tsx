import { zodResolver } from '@hookform/resolvers/zod';
import {
  toDisplayError,
  useAcceptSellerInvitation,
  useSellerInvitationPreview,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, PASSWORD_HINT, SubmitButton } from '@marketplace/auth-ui';
import { ROLE_LABELS } from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  AuthShell,
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  LoadingState,
  PasswordInput,
} from '@marketplace/ui';
import { passwordSchema, personNameSchema } from '@marketplace/validation';
import { AlertCircleIcon, CheckCircle2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { SellerBrand } from '../../components/brand';

/** New people give a name and a policy-compliant password; existing accounts only confirm theirs. */
const joinSchema = z
  .object({
    existing: z.boolean(),
    firstName: z.string(),
    lastName: z.string(),
    password: z.string(),
  })
  .superRefine((value, ctx) => {
    const check = (path: 'firstName' | 'lastName' | 'password', schema: z.ZodType) => {
      const result = schema.safeParse(value[path]);
      if (!result.success)
        ctx.addIssue({ code: 'custom', path: [path], message: result.error.issues[0]!.message });
    };
    if (value.existing) {
      if (!value.password)
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'Enter your password' });
      return;
    }
    check('firstName', personNameSchema);
    check('lastName', personNameSchema);
    check('password', passwordSchema);
  });

/** Opened from an employee invitation email. */
export function JoinPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const preview = useSellerInvitationPreview(token);
  const accept = useAcceptSellerInvitation();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const existing = preview.data?.existingAccount ?? false;
  const form = useForm<z.infer<typeof joinSchema>>({
    resolver: zodResolver(joinSchema),
    defaultValues: { existing: false, firstName: '', lastName: '', password: '' },
  });
  useEffect(() => {
    form.setValue('existing', existing);
  }, [existing, form]);

  if (!token || preview.isError) {
    return (
      <AuthShell brand={<SellerBrand />} title="This invitation can't be used">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>
            {toDisplayError(preview.error)?.message ??
              'Open the link from your invitation email again.'}
          </AlertDescription>
        </Alert>
      </AuthShell>
    );
  }
  if (preview.isPending) {
    return (
      <AuthShell brand={<SellerBrand />} title="Opening your invitation">
        <LoadingState />
      </AuthShell>
    );
  }
  if (done) {
    return (
      <AuthShell brand={<SellerBrand />} title={`You joined ${preview.data.sellerName}`}>
        <div className="flex flex-col gap-4">
          <Alert>
            <CheckCircle2Icon />
            <AlertDescription>Sign in with {preview.data.email} to start working.</AlertDescription>
          </Alert>
          <Button asChild>
            <Link to="/sign-in">Sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await accept.mutateAsync(
        existing
          ? { token, password: values.password }
          : {
              token,
              firstName: values.firstName,
              lastName: values.lastName,
              password: values.password,
            },
      );
      setDone(true);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <AuthShell
      brand={<SellerBrand />}
      title={`Join ${preview.data.sellerName}`}
      description={`You were invited as ${preview.data.roles.map((r) => ROLE_LABELS[r]).join(', ')}, using ${preview.data.email}.`}
    >
      <Form {...form}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormAlert message={formError} />
          {existing ? (
            <p className="text-sm text-muted-foreground">
              You already have an account with this email. Confirm its password to accept.
            </p>
          ) : (
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
          )}
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{existing ? 'Password' : 'Choose a password'}</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete={existing ? 'current-password' : 'new-password'}
                    {...field}
                  />
                </FormControl>
                {existing ? null : <FormDescription>{PASSWORD_HINT}</FormDescription>}
                <FormMessage />
              </FormItem>
            )}
          />
          <SubmitButton pending={accept.isPending}>Accept invitation</SubmitButton>
        </form>
      </Form>
    </AuthShell>
  );
}
