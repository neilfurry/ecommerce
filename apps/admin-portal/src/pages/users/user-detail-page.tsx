import { zodResolver } from '@hookform/resolvers/zod';
import {
  hasPermission,
  toDisplayError,
  useAdminUser,
  useReactivateUser,
  useResendInvitation,
  useResetUserMfa,
  useRevokeUserSessions,
  useSession,
  useSuspendUser,
  useUpdateUser,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  CUSTOMER_ROLES,
  grantableRoles,
  PLATFORM_STAFF_ROLES,
  type UserRole,
} from '@marketplace/shared-types';
import {
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ErrorState,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  LoadingState,
  PageHeader,
  toast,
} from '@marketplace/ui';
import {
  type AdminUserDetail,
  type UpdateUserRequest,
  updateUserSchema,
} from '@marketplace/validation';
import {
  BanIcon,
  LogOutIcon,
  MailIcon,
  PencilIcon,
  RotateCcwIcon,
  ShieldOffIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { SellerStatusBadge } from '../../components/seller-status';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { RoleCheckboxes } from './role-checkboxes';
import { RoleBadges, UserStatusBadge } from './user-badges';

const isCustomerRole = (role: UserRole) => (CUSTOMER_ROLES as readonly UserRole[]).includes(role);

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

function SellerLink({ seller }: { seller: NonNullable<AdminUserDetail['seller']> }) {
  const session = useSession();
  return hasPermission(session.data, 'sellers.read') ? (
    <Link to={`/sellers/${seller.id}`} className="underline-offset-4 hover:underline">
      {seller.businessName}
    </Link>
  ) : (
    <>{seller.businessName}</>
  );
}

function EditUserDialog({ user, grantable }: { user: AdminUserDetail; grantable: UserRole[] }) {
  const update = useUpdateUser();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const customerRoles = user.roles.filter(isCustomerRole);
  const staffOptions = [
    ...new Set([...PLATFORM_STAFF_ROLES, ...user.roles.filter((r) => !isCustomerRole(r))]),
  ];
  const form = useForm<UpdateUserRequest>({
    resolver: zodResolver(updateUserSchema),
    values: { firstName: user.firstName, lastName: user.lastName, roles: user.roles },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await update.mutateAsync({ userId: user.id, body: values });
      toast.success('Account updated');
      setOpen(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <PencilIcon /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>
            Role changes apply on the user's next request; they don't need to sign in again.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FormAlert message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="roles"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Staff roles</FormLabel>
                  <RoleCheckboxes
                    value={field.value.filter((r) => !isCustomerRole(r))}
                    onChange={(staff) => field.onChange([...customerRoles, ...staff])}
                    options={staffOptions}
                    grantable={grantable}
                    invalid={!!fieldState.error}
                  />
                  {customerRoles.length > 0 ? (
                    <FormDescription>
                      Customer roles change only through sign-up and wholesale approval.
                    </FormDescription>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={update.isPending}>Save changes</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function UserActions({ user }: { user: AdminUserDetail }) {
  const session = useSession();
  const suspend = useSuspendUser();
  const reactivate = useReactivateUser();
  const revoke = useRevokeUserSessions();
  const resend = useResendInvitation();
  const resetMfa = useResetUserMfa();
  const myRoles = session.data?.user.roles ?? [];
  const grantable = grantableRoles(myRoles);
  const isSelf = session.data?.user.id === user.id;
  // Platform staff can be managed only by someone who could grant all of their platform roles.
  const canManage = user.roles
    .filter((r) => (PLATFORM_STAFF_ROLES as readonly UserRole[]).includes(r))
    .every((r) => grantable.includes(r));
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    hasPermission(session.data, permission) && canManage;

  const run = (label: string, action: () => Promise<unknown>, success: string) => async () => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      showError(label, error);
      throw error;
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {can('users.update') ? <EditUserDialog user={user} grantable={grantable} /> : null}
      {can('users.create') && user.status === 'INVITED' ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <MailIcon /> Resend invitation
            </Button>
          }
          title="Resend the invitation?"
          description={`A new link goes to ${user.email}. Earlier links stop working.`}
          confirmLabel="Resend"
          onConfirm={run(
            'Could not resend the invitation',
            () => resend.mutateAsync(user.id),
            'Invitation sent',
          )}
        />
      ) : null}
      {can('users.sessions.revoke') && user.activeSessions > 0 ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <LogOutIcon /> Sign out everywhere
            </Button>
          }
          title="Sign this account out of every device?"
          description="They stay able to sign in again. Use this after a lost phone or a shared computer."
          confirmLabel="Sign out"
          onConfirm={run(
            'Could not sign the account out',
            () => revoke.mutateAsync(user.id),
            'Signed out of every device',
          )}
        />
      ) : null}
      {can('users.update') && user.mfaEnabled && !isSelf ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <ShieldOffIcon /> Reset two-step verification
            </Button>
          }
          title="Reset two-step verification?"
          description="Only after confirming the person's identity, for example when they lost their phone and recovery codes. They are signed out everywhere and can turn it on again after signing in."
          confirmLabel="Reset"
          destructive
          onConfirm={run(
            'Could not reset two-step verification',
            () => resetMfa.mutateAsync(user.id),
            'Two-step verification turned off',
          )}
        />
      ) : null}
      {can('users.suspend') && !isSelf ? (
        user.status === 'SUSPENDED' ? (
          <ConfirmDialog
            trigger={
              <Button variant="outline">
                <RotateCcwIcon /> Reactivate
              </Button>
            }
            title="Reactivate this account?"
            description="They can sign in again. Any sign-in lock-out is cleared."
            confirmLabel="Reactivate"
            onConfirm={run(
              'Could not reactivate the account',
              () => reactivate.mutateAsync(user.id),
              'Account reactivated',
            )}
          />
        ) : (
          <ConfirmDialog
            trigger={
              <Button variant="destructive">
                <BanIcon /> Suspend
              </Button>
            }
            title="Suspend this account?"
            description="They are signed out of every device at once and cannot sign in until reactivated. Their records are kept."
            confirmLabel="Suspend"
            destructive
            onConfirm={run(
              'Could not suspend the account',
              () => suspend.mutateAsync(user.id),
              'Account suspended',
            )}
          />
        )
      ) : null}
    </div>
  );
}

export function UserDetailPage() {
  const { userId } = useParams();
  const user = useAdminUser(userId);
  const name = user.data ? `${user.data.firstName} ${user.data.lastName}` : 'Account';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Breadcrumbs items={[{ label: 'Users', to: '/users' }, { label: name }]} />
      {user.isPending ? (
        <LoadingState />
      ) : user.isError ? (
        <ErrorState
          message={toDisplayError(user.error)?.message ?? 'Could not load the account.'}
          requestId={toDisplayError(user.error)?.requestId}
          onRetry={() => void user.refetch()}
        />
      ) : (
        <>
          <PageHeader
            title={name}
            description={user.data.email}
            actions={<UserActions user={user.data} />}
          />
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Account</h2>
              </CardTitle>
              <CardDescription>Created {formatDateTime(user.data.createdAt)}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-6 sm:grid-cols-2">
                <Detail label="Status">
                  <UserStatusBadge status={user.data.status} />
                  {user.data.lockedUntil ? (
                    <span className="ml-2 text-xs text-destructive">
                      Locked until {formatDateTime(user.data.lockedUntil)} after failed sign-ins
                    </span>
                  ) : null}
                </Detail>
                <Detail label="Roles">
                  <RoleBadges roles={user.data.roles} />
                </Detail>
                <Detail label="Email">
                  {user.data.email} {user.data.emailVerified ? '(verified)' : '(not verified)'}
                </Detail>
                <Detail label="Mobile">
                  {user.data.mobile
                    ? `${user.data.mobile} ${user.data.mobileVerified ? '(verified)' : '(not verified)'}`
                    : '—'}
                </Detail>
                <Detail label="Last sign-in">
                  {user.data.lastSignInAt ? formatDateTime(user.data.lastSignInAt) : 'Never'}
                </Detail>
                <Detail label="Signed-in devices">{user.data.activeSessions}</Detail>
                <Detail label="Two-step verification">{user.data.mfaEnabled ? 'On' : 'Off'}</Detail>
                {user.data.seller ? (
                  <Detail label="Seller">
                    <span className="flex flex-wrap items-center gap-2">
                      <SellerLink seller={user.data.seller} />
                      <SellerStatusBadge status={user.data.seller.status} />
                      <span className="text-xs text-muted-foreground">
                        {user.data.seller.isOwner ? 'Owner' : 'Employee'}
                        {user.data.seller.memberStatus === 'SUSPENDED'
                          ? ' · suspended by the seller'
                          : ''}
                      </span>
                    </span>
                  </Detail>
                ) : null}
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
