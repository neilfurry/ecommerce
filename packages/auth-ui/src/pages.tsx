import { zodResolver } from '@hookform/resolvers/zod';
import {
  ApiError,
  useAcceptInvitation,
  useForgotPassword,
  useResetPassword,
  useSignIn,
} from '@marketplace/api-client';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
  PasswordInput,
  Spinner,
} from '@marketplace/ui';
import {
  emailAddressSchema,
  emailSignInSchema,
  isMfaChallenge,
  type MfaChallengeResponse,
  passwordSchema,
} from '@marketplace/validation';
import { AlertCircleIcon, CheckCircle2Icon, MailCheckIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { applyApiErrors } from './form-errors';
import type { ReturnState } from './guards';
import { MfaCodeForm } from './mfa';

export const PASSWORD_HINT =
  'At least 12 characters. A short sentence is easy to remember and hard to guess.';

export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircleIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? <Spinner className="text-primary-foreground" /> : null}
      {children}
    </Button>
  );
}

/** Where to go after signing in: the page that sent the user here, if it is on this site. */
export function useReturnTo(fallback = '/'): string {
  const from = (useLocation().state as ReturnState | null)?.from;
  return from && from.startsWith('/') && !from.startsWith('//') ? from : fallback;
}

// ---- Email + password sign-in -------------------------------------------------------------

export interface PasswordSignInFormProps {
  forgotPasswordPath?: string;
  onSignedIn: () => void;
}

export function PasswordSignInForm({
  forgotPasswordPath = '/forgot-password',
  onSignedIn,
}: PasswordSignInFormProps) {
  const signIn = useSignIn();
  const [formError, setFormError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<MfaChallengeResponse | null>(null);
  const form = useForm<z.infer<typeof emailSignInSchema>>({
    resolver: zodResolver(emailSignInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await signIn.mutateAsync(values);
      // Two-step verification: ask for the authenticator code before the session starts.
      if (isMfaChallenge(result)) {
        setChallenge(result);
        return;
      }
      onSignedIn();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS')
        form.resetField('password');
      setFormError(applyApiErrors(form, error));
    }
  });

  if (challenge) {
    return (
      <MfaCodeForm
        challenge={challenge}
        onSignedIn={onSignedIn}
        onCancel={() => {
          setChallenge(null);
          form.resetField('password');
        }}
      />
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="username" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <Link
                  to={forgotPasswordPath}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <FormControl>
                <PasswordInput autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitButton pending={signIn.isPending}>Sign in</SubmitButton>
      </form>
    </Form>
  );
}

/** Sign-in page of the Seller Center and the Admin Console (staff use email + password). */
export function StaffSignInPage({
  brand,
  appName,
  description = "Accounts are created by an administrator. Check your email for an invitation if you don't have a password yet.",
  footer,
}: {
  brand: ReactNode;
  appName: string;
  description?: ReactNode;
  footer?: ReactNode;
}) {
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  return (
    <AuthShell
      brand={brand}
      title={`Sign in to ${appName}`}
      description={description}
      footer={footer}
    >
      <PasswordSignInForm onSignedIn={() => void navigate(returnTo, { replace: true })} />
    </AuthShell>
  );
}

// ---- Forgot / reset password ----------------------------------------------------------------

export function ForgotPasswordPage({
  brand,
  signInPath = '/sign-in',
}: {
  brand: ReactNode;
  signInPath?: string;
}) {
  const forgot = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: emailAddressSchema })),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await forgot.mutateAsync(email);
      setSentTo(email);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <AuthShell
      brand={brand}
      title="Reset your password"
      description="Enter the email address of your account and we'll send you a link to choose a new password."
      footer={
        <Link to={signInPath} className="underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <Alert>
          <MailCheckIcon />
          <AlertTitle>Check your email</AlertTitle>
          <AlertDescription>
            If an account uses {sentTo}, a reset link is on its way. It works once and expires in 30
            minutes.
          </AlertDescription>
        </Alert>
      ) : (
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <FormAlert message={formError} />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={forgot.isPending}>Send reset link</SubmitButton>
          </form>
        </Form>
      )}
    </AuthShell>
  );
}

const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match',
  });

function NewPasswordForm({
  submitLabel,
  pending,
  onSubmit,
}: {
  submitLabel: string;
  pending: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof newPasswordSchema>>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const submit = form.handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await onSubmit(password);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" autoFocus {...field} />
              </FormControl>
              <FormDescription>{PASSWORD_HINT}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </form>
    </Form>
  );
}

function MissingToken({
  brand,
  signInPath,
  what,
}: {
  brand: ReactNode;
  signInPath: string;
  what: string;
}) {
  return (
    <AuthShell brand={brand} title="This link is incomplete">
      <p className="text-sm text-muted-foreground">
        Open the {what} link from your email again, or{' '}
        <Link to={signInPath} className="underline underline-offset-4">
          go to sign in
        </Link>
        .
      </p>
    </AuthShell>
  );
}

function Done({
  brand,
  title,
  message,
  signInPath,
}: {
  brand: ReactNode;
  title: string;
  message: string;
  signInPath: string;
}) {
  return (
    <AuthShell brand={brand} title={title}>
      <div className="flex flex-col gap-4">
        <Alert>
          <CheckCircle2Icon />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button asChild>
          <Link to={signInPath}>Sign in</Link>
        </Button>
      </div>
    </AuthShell>
  );
}

export function ResetPasswordPage({
  brand,
  signInPath = '/sign-in',
}: {
  brand: ReactNode;
  signInPath?: string;
}) {
  const [params] = useSearchParams();
  const token = params.get('token');
  const reset = useResetPassword();
  const [done, setDone] = useState(false);
  if (!token) return <MissingToken brand={brand} signInPath={signInPath} what="password reset" />;
  if (done) {
    return (
      <Done
        brand={brand}
        title="Password changed"
        message="Your password was changed and every device was signed out. Sign in with your new password."
        signInPath={signInPath}
      />
    );
  }
  return (
    <AuthShell brand={brand} title="Choose a new password">
      <NewPasswordForm
        submitLabel="Change password"
        pending={reset.isPending}
        onSubmit={async (password) => {
          await reset.mutateAsync({ token, password });
          setDone(true);
        }}
      />
    </AuthShell>
  );
}

export function AcceptInvitationPage({
  brand,
  signInPath = '/sign-in',
}: {
  brand: ReactNode;
  signInPath?: string;
}) {
  const [params] = useSearchParams();
  const token = params.get('token');
  const accept = useAcceptInvitation();
  const [done, setDone] = useState(false);
  if (!token) return <MissingToken brand={brand} signInPath={signInPath} what="invitation" />;
  if (done) {
    return (
      <Done
        brand={brand}
        title="Your account is ready"
        message="Your password is set. Sign in with your email address and the new password."
        signInPath={signInPath}
      />
    );
  }
  return (
    <AuthShell
      brand={brand}
      title="Set your password"
      description="Choose a password to activate your staff account."
    >
      <NewPasswordForm
        submitLabel="Activate account"
        pending={accept.isPending}
        onSubmit={async (password) => {
          await accept.mutateAsync({ token, password });
          setDone(true);
        }}
      />
    </AuthShell>
  );
}
