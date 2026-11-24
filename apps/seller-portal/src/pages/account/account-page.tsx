import {
  toDisplayError,
  useResendVerificationEmail,
  useSession,
  useSignOutEverywhere,
} from '@marketplace/api-client';
import { ChangePasswordDialog, TwoStepDialog } from '@marketplace/auth-ui';
import { ROLE_LABELS } from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  LoadingState,
  PageHeader,
  toast,
} from '@marketplace/ui';
import { KeyRoundIcon, MonitorSmartphoneIcon, ShieldCheckIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm font-medium">{children}</dd>
    </div>
  );
}

export function AccountPage() {
  const session = useSession();
  const resend = useResendVerificationEmail();
  const signOutEverywhere = useSignOutEverywhere();
  const navigate = useNavigate();
  const [changing, setChanging] = useState(false);
  const [twoStep, setTwoStep] = useState(false);
  if (!session.data) return <LoadingState />;
  const user = session.data.user;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Account settings"
        description="Your own sign-in details for Seller Center."
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Profile</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-4">
            <Row label="Name">
              {user.firstName} {user.lastName}
            </Row>
            <Row label="Email">
              {user.email}
              {user.emailVerified ? (
                <Badge variant="success">Verified</Badge>
              ) : (
                <>
                  <Badge variant="warning">Not confirmed</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resend.isPending || resend.isSuccess}
                    onClick={() =>
                      resend.mutate(undefined, {
                        onSuccess: () =>
                          toast.success('Confirmation email sent', {
                            description: `Check ${user.email}.`,
                          }),
                        onError: (error) =>
                          toast.error('Could not send the email', {
                            description: toDisplayError(error)?.message,
                          }),
                      })
                    }
                  >
                    {resend.isSuccess ? 'Email sent' : 'Send confirmation email'}
                  </Button>
                </>
              )}
            </Row>
            <Row label="Mobile number">{user.mobile ?? '—'}</Row>
            <Row label="Business">{user.seller?.businessName ?? '—'}</Row>
            <Row label="Your roles">{user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</Row>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Security</h2>
          </CardTitle>
          <CardDescription>
            Two-step verification protects your business if your password is ever stolen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setChanging(true)}>
            <KeyRoundIcon /> Change password
          </Button>
          <Button variant="outline" onClick={() => setTwoStep(true)}>
            <ShieldCheckIcon /> Two-step verification {user.mfaEnabled ? '(on)' : '(off)'}
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="outline">
                <MonitorSmartphoneIcon /> Sign out of all devices
              </Button>
            }
            title="Sign out of all devices?"
            description="Every device signed in to your account, including this one, will need to sign in again."
            confirmLabel="Sign out everywhere"
            onConfirm={async () => {
              await signOutEverywhere.mutateAsync();
              void navigate('/sign-in', { replace: true });
            }}
          />
          <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
          <TwoStepDialog open={twoStep} onOpenChange={setTwoStep} />
        </CardContent>
      </Card>
    </div>
  );
}
