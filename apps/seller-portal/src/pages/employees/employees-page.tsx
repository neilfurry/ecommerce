import { zodResolver } from '@hookform/resolvers/zod';
import {
  hasPermission,
  toDisplayError,
  useInviteSellerMember,
  useSellerInvitationAction,
  useSellerMemberAction,
  useSellerTeam,
  useSession,
  useUpdateSellerMember,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  PERMISSIONS,
  ROLE_LABELS,
  type Permission,
  type UserRole,
} from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  PageHeader,
  toast,
} from '@marketplace/ui';
import {
  type InviteSellerMemberRequest,
  inviteSellerMemberSchema,
  type SellerInvitationDto,
  type SellerMemberDto,
  type SellerTeam,
} from '@marketplace/validation';
import { MailIcon, UserPlusIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { type Control, type FieldValues, type Path, useForm } from 'react-hook-form';
import { formatDateTime } from '../../lib/format';
import { showError } from '../../lib/errors';

function CheckboxGroup<T extends FieldValues>({
  control,
  name,
  legend,
  options,
}: {
  control: Control<T>;
  name: Path<T>;
  legend: string;
  options: { value: string; label: string; description?: string }[];
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = (field.value as string[] | undefined) ?? [];
        return (
          <FormItem>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{legend}</legend>
              {options.map((option) => {
                const id = `${String(name)}-${option.value}`;
                return (
                  <div key={option.value} className="flex items-start gap-2">
                    <Checkbox
                      id={id}
                      checked={value.includes(option.value)}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked === true
                            ? [...value, option.value]
                            : value.filter((v) => v !== option.value),
                        )
                      }
                    />
                    <div className="grid gap-0.5">
                      <Label htmlFor={id} className="font-normal">
                        {option.label}
                      </Label>
                      {option.description ? (
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </fieldset>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

function accessOptions(team: SellerTeam) {
  return {
    roles: team.assignableRoles.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    permissions: team.assignablePermissions.map((p) => ({
      value: p,
      label: p,
      description: PERMISSIONS[p],
    })),
  };
}

function InviteDialog({ team }: { team: SellerTeam }) {
  const [open, setOpen] = useState(false);
  const invite = useInviteSellerMember();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<InviteSellerMemberRequest>({
    resolver: zodResolver(inviteSellerMemberSchema),
    defaultValues: { email: '', roles: [], permissions: [] },
  });
  const options = accessOptions(team);
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await invite.mutateAsync(values);
      toast.success(`Invitation sent to ${values.email}`);
      form.reset();
      setOpen(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon /> Invite employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite an employee</DialogTitle>
          <DialogDescription>
            They get an email link that is valid for 7 days. They can only work on your business.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormAlert message={formError} />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <CheckboxGroup
              control={form.control}
              name="roles"
              legend="Roles"
              options={options.roles}
            />
            {options.permissions.length ? (
              <CheckboxGroup
                control={form.control}
                name="permissions"
                legend="Extra permissions (optional)"
                options={options.permissions}
              />
            ) : null}
            <SubmitButton pending={invite.isPending}>Send invitation</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({ member, team }: { member: SellerMemberDto; team: SellerTeam }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateSellerMember();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<{ roles: UserRole[]; permissions: Permission[] }>({
    values: { roles: member.roles, permissions: member.extraPermissions },
  });
  const options = accessOptions(team);
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    if (!values.roles.length) {
      form.setError('roles', { message: 'Choose at least one role' });
      return;
    }
    try {
      await update.mutateAsync({
        memberId: member.id,
        body: values as Parameters<typeof update.mutateAsync>[0]['body'],
      });
      toast.success('Access updated');
      setOpen(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit access
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Access for {member.name}</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormAlert message={formError} />
            <CheckboxGroup
              control={form.control}
              name="roles"
              legend="Roles"
              options={options.roles}
            />
            {options.permissions.length ? (
              <CheckboxGroup
                control={form.control}
                name="permissions"
                legend="Extra permissions"
                options={options.permissions}
              />
            ) : null}
            <SubmitButton pending={update.isPending}>Save access</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function MemberActions({
  member,
  team,
  selfId,
}: {
  member: SellerMemberDto;
  team: SellerTeam;
  selfId: string;
}) {
  const action = useSellerMemberAction();
  if (member.isOwner || member.userId === selfId) return null;
  // Only people whose every role the signed-in user could assign are manageable.
  if (!member.roles.every((r) => team.assignableRoles.includes(r))) return null;
  const run = (kind: 'suspend' | 'reactivate' | 'remove', done: string) => async () => {
    try {
      await action.mutateAsync({ memberId: member.id, action: kind });
      toast.success(done);
    } catch (error) {
      showError('That did not work', error);
      throw error;
    }
  };
  const suspended = member.status === 'SUSPENDED';
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <EditMemberDialog member={member} team={team} />
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm">
            {suspended ? 'Reactivate' : 'Suspend'}
          </Button>
        }
        title={suspended ? `Reactivate ${member.name}?` : `Suspend ${member.name}?`}
        description={
          suspended
            ? 'They can sign in to Seller Center again.'
            : 'They are signed out and cannot sign in until reactivated.'
        }
        confirmLabel={suspended ? 'Reactivate' : 'Suspend'}
        destructive={!suspended}
        onConfirm={run(
          suspended ? 'reactivate' : 'suspend',
          suspended ? 'Reactivated' : 'Suspended',
        )}
      />
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm">
            Remove
          </Button>
        }
        title={`Remove ${member.name}?`}
        description="They lose access to your business. Their marketplace account stays."
        confirmLabel="Remove"
        destructive
        onConfirm={run('remove', 'Removed from your team')}
      />
    </div>
  );
}

function InvitationActions({ invitation }: { invitation: SellerInvitationDto }) {
  const action = useSellerInvitationAction();
  const run = (kind: 'resend' | 'revoke') => async () => {
    try {
      await action.mutateAsync({ invitationId: invitation.id, action: kind });
      toast.success(kind === 'resend' ? 'Invitation sent again' : 'Invitation cancelled');
    } catch (error) {
      showError('That did not work', error);
      throw error;
    }
  };
  return (
    <div className="flex justify-end gap-2">
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm">
            Resend
          </Button>
        }
        title="Send the invitation again?"
        description="A new link is emailed and the old one stops working."
        confirmLabel="Resend"
        onConfirm={run('resend')}
      />
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
        }
        title="Cancel this invitation?"
        description={`${invitation.email} will not be able to join with it.`}
        confirmLabel="Cancel invitation"
        destructive
        onConfirm={run('revoke')}
      />
    </div>
  );
}

const roleList = (roles: UserRole[]) => roles.map((r) => ROLE_LABELS[r]).join(', ');

export function EmployeesPage() {
  const session = useSession();
  const team = useSellerTeam();
  const canManage = hasPermission(session.data, 'seller.members.manage');
  const selfId = session.data?.user.id ?? '';
  const error = team.isError ? toDisplayError(team.error) : null;

  const memberColumns: DataTableColumn<SellerMemberDto>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (m) => (
        <div>
          <div className="font-medium">
            {m.name}{' '}
            {m.userId === selfId ? <span className="text-muted-foreground">(you)</span> : null}
          </div>
          <div className="text-xs text-muted-foreground">{m.email}</div>
        </div>
      ),
    },
    { id: 'roles', header: 'Roles', cell: (m) => (m.isOwner ? 'Owner' : roleList(m.roles)) },
    {
      id: 'status',
      header: 'Status',
      cell: (m) => (
        <Badge variant={m.status === 'ACTIVE' ? 'secondary' : 'destructive'}>
          {m.status === 'ACTIVE' ? 'Active' : 'Suspended'}
        </Badge>
      ),
    },
    {
      id: 'lastSignIn',
      header: 'Last sign-in',
      hideOnMobile: true,
      cell: (m) => (m.lastSignInAt ? formatDateTime(m.lastSignInAt) : 'Never'),
    },
    ...(canManage && team.data
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (m: SellerMemberDto) => (
              <MemberActions member={m} team={team.data} selfId={selfId} />
            ),
          },
        ]
      : []),
  ];

  const invitationColumns: DataTableColumn<SellerInvitationDto>[] = [
    { id: 'email', header: 'Email', cell: (i) => i.email },
    { id: 'roles', header: 'Roles', cell: (i) => roleList(i.roles) },
    {
      id: 'expires',
      header: 'Expires',
      cell: (i) =>
        i.expired ? <Badge variant="destructive">Expired</Badge> : formatDateTime(i.expiresAt),
    },
    { id: 'by', header: 'Invited by', hideOnMobile: true, cell: (i) => i.invitedBy },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (i: SellerInvitationDto) => <InvitationActions invitation={i} />,
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Employees"
        description="People who can work in Seller Center for your business."
        actions={canManage && team.data ? <InviteDialog team={team.data} /> : null}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Team</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            label="Team members"
            columns={memberColumns}
            rows={team.data?.members}
            getRowId={(m) => m.id}
            isLoading={team.isPending}
            error={error}
            onRetry={() => void team.refetch()}
            empty={{ icon: UsersIcon, title: 'No team members yet' }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Pending invitations</h2>
          </CardTitle>
          <CardDescription>Invitations that have not been accepted yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            label="Pending invitations"
            columns={invitationColumns}
            rows={team.data?.invitations}
            getRowId={(i) => i.id}
            isLoading={team.isPending}
            error={error}
            empty={{ icon: MailIcon, title: 'No pending invitations' }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
