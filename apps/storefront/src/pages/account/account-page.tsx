import { zodResolver } from '@hookform/resolvers/zod';
import {
  toDisplayError,
  useApplyForWholesale,
  useMyWholesaleApplication,
  useResendVerificationEmail,
  useSession,
  useSignOutEverywhere,
} from '@marketplace/api-client';
import {
  applyApiErrors,
  ChangePasswordDialog,
  FormAlert,
  SubmitButton,
} from '@marketplace/auth-ui';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  LoadingState,
  PageHeader,
  Textarea,
  toast,
} from '@marketplace/ui';
import { type WholesaleBusiness, wholesaleBusinessSchema } from '@marketplace/validation';
import { BuildingIcon, ClockIcon, KeyRoundIcon, MonitorSmartphoneIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm font-medium">{children}</dd>
    </div>
  );
}

function ProfileCard() {
  const session = useSession();
  const resend = useResendVerificationEmail();
  const user = session.data!.user;
  return (
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
          <Row label="Mobile number">
            {user.mobile ?? '—'}
            {user.mobileVerified ? <Badge variant="success">Verified</Badge> : null}
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
        </dl>
      </CardContent>
    </Card>
  );
}

function WholesaleForm({
  defaults,
  submitLabel,
}: {
  defaults?: WholesaleBusiness;
  submitLabel: string;
}) {
  const apply = useApplyForWholesale();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<WholesaleBusiness>({
    resolver: zodResolver(wholesaleBusinessSchema),
    defaultValues: defaults ?? { businessName: '', tin: '', businessAddress: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apply.mutateAsync(values);
      toast.success('Application sent', {
        description: "We'll email you when it has been reviewed.",
      });
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
          name="tin"
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
          name="businessAddress"
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
        <div>
          <SubmitButton pending={apply.isPending}>{submitLabel}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

function WholesaleCard() {
  const mine = useMyWholesaleApplication();
  const application = mine.data?.application;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Wholesale buying</h2>
        </CardTitle>
        <CardDescription>
          Registered businesses get bulk prices once we have checked their details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mine.isPending ? (
          <LoadingState />
        ) : mine.isError ? (
          <ErrorState
            message={toDisplayError(mine.error)?.message ?? 'Could not load your application.'}
            onRetry={() => void mine.refetch()}
          />
        ) : !application ? (
          <WholesaleForm submitLabel="Apply for wholesale" />
        ) : application.status === 'PENDING' ? (
          <Alert>
            <ClockIcon />
            <AlertTitle>Application under review</AlertTitle>
            <AlertDescription>
              {application.businessName} (TIN {application.tin}). You can shop at retail prices
              meanwhile.
            </AlertDescription>
          </Alert>
        ) : application.status === 'APPROVED' ? (
          <Alert>
            <BuildingIcon />
            <AlertTitle>Wholesale account active</AlertTitle>
            <AlertDescription>
              {application.businessName} buys at wholesale prices.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <Alert variant="destructive">
              <AlertTitle>Application not approved</AlertTitle>
              <AlertDescription>
                {application.reviewNote ?? 'Please check your business details.'} Correct your
                details below and apply again.
              </AlertDescription>
            </Alert>
            <WholesaleForm
              submitLabel="Apply again"
              defaults={{
                businessName: application.businessName,
                tin: application.tin,
                businessAddress: application.businessAddress,
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SecurityCard() {
  const signOutEverywhere = useSignOutEverywhere();
  const navigate = useNavigate();
  const [changing, setChanging] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Security</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setChanging(true)}>
          <KeyRoundIcon /> Change password
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <MonitorSmartphoneIcon /> Sign out of all devices
            </Button>
          }
          title="Sign out of all devices?"
          description="Every phone and computer signed in to your account, including this one, will need to sign in again."
          confirmLabel="Sign out everywhere"
          onConfirm={async () => {
            await signOutEverywhere.mutateAsync();
            void navigate('/sign-in', { replace: true });
          }}
        />
        <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
      </CardContent>
    </Card>
  );
}

export function AccountPage() {
  const session = useSession();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <PageHeader
        title="My account"
        description={`Signed in as ${session.data?.user.email ?? ''}`}
      />
      <ProfileCard />
      <WholesaleCard />
      <SecurityCard />
    </div>
  );
}
