import { toDisplayError, useSession, useVerifyEmail } from '@marketplace/api-client';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AuthShell,
  Button,
  LoadingState,
} from '@marketplace/ui';
import { AlertCircleIcon, CheckCircle2Icon } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';

/** Opened from the confirmation email. Confirms once, on arrival. */
export function VerifyEmailPage({
  brand,
  accountPath = '/account',
  signInPath = '/sign-in',
}: {
  brand: ReactNode;
  accountPath?: string;
  signInPath?: string;
}) {
  const [params] = useSearchParams();
  const token = params.get('token');
  const verify = useVerifyEmail();
  const session = useSession();
  const started = useRef(false);

  useEffect(() => {
    // Links work once: guard against React's development double-invocation.
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  const next = session.data
    ? { to: accountPath, label: 'Go to my account' }
    : { to: signInPath, label: 'Sign in' };

  return (
    <AuthShell brand={brand} title="Confirm your email address">
      {!token ? (
        <p className="text-sm text-muted-foreground">
          Open the link from the confirmation email again.
        </p>
      ) : verify.isPending || verify.isIdle ? (
        <LoadingState label="Confirming…" />
      ) : verify.isSuccess ? (
        <div className="flex flex-col gap-4">
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Email address confirmed</AlertTitle>
            <AlertDescription>
              You'll receive receipts and order updates at this address.
            </AlertDescription>
          </Alert>
          <Button asChild>
            <Link to={next.to}>{next.label}</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>This link didn't work</AlertTitle>
            <AlertDescription>
              {toDisplayError(verify.error)?.message ?? 'It may have expired or been used already.'}{' '}
              You can send a new link from your account page.
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link to={next.to}>{next.label}</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
