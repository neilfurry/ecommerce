import {
  hasPermission,
  toDisplayError,
  useRoles,
  useSession,
  useUpdateRolePermissions,
} from '@marketplace/api-client';
import type { Permission } from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ErrorState,
  Label,
  LoadingState,
  PageHeader,
  Spinner,
  toast,
} from '@marketplace/ui';
import type { RoleDto, RoleList } from '@marketplace/validation';
import { LockIcon } from 'lucide-react';
import { useState } from 'react';
import { showError } from '../../lib/errors';

function RoleCard({
  role,
  catalog,
  editable,
}: {
  role: RoleDto;
  catalog: RoleList['permissions'];
  editable: boolean;
}) {
  const update = useUpdateRolePermissions();
  const [selected, setSelected] = useState<Permission[]>(role.permissions);
  const dirty =
    selected.length !== role.permissions.length ||
    selected.some((p) => !role.permissions.includes(p));
  const canEdit = editable && !role.locked;

  const save = async () => {
    try {
      await update.mutateAsync({ code: role.code, permissions: selected });
      toast.success(`${role.name} updated`, {
        description: 'Signed-in users get the change on their next request.',
      });
    } catch (error) {
      showError(`Could not update ${role.name}`, error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <h2>{role.name}</h2>
          {role.locked ? (
            <Badge variant="secondary">
              <LockIcon aria-hidden="true" /> Always every permission
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {role.description} · {role.userCount} {role.userCount === 1 ? 'account' : 'accounts'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="grid gap-2 sm:grid-cols-2" disabled={!canEdit || update.isPending}>
          <legend className="sr-only">Permissions of {role.name}</legend>
          {catalog.map((permission) => {
            const id = `${role.code}-${permission.code}`;
            const checked = role.locked || selected.includes(permission.code);
            return (
              <div key={permission.code} className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={!canEdit || update.isPending}
                  onCheckedChange={(next) =>
                    setSelected((current) =>
                      next === true
                        ? [...current, permission.code]
                        : current.filter((p) => p !== permission.code),
                    )
                  }
                  className="mt-0.5"
                />
                <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
                  <span>{permission.description}</span>
                  <code className="text-xs text-muted-foreground">{permission.code}</code>
                </Label>
              </div>
            );
          })}
        </fieldset>
        {canEdit ? (
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={!dirty || update.isPending}>
              {update.isPending ? <Spinner className="text-primary-foreground" /> : null}
              Save {role.name}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelected(role.permissions)}
              disabled={!dirty || update.isPending}
            >
              Undo changes
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RolesPage() {
  const session = useSession();
  const roles = useRoles();
  const editable = hasPermission(session.data, 'roles.update');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Roles & permissions"
        description={
          editable
            ? 'Choose what each role may do. Changes apply to everyone with the role on their next request and are recorded in the audit log.'
            : 'What each role may do. Only a super admin can change permissions.'
        }
      />
      {roles.isPending ? (
        <LoadingState />
      ) : roles.isError ? (
        <ErrorState
          message={toDisplayError(roles.error)?.message ?? 'Could not load roles.'}
          requestId={toDisplayError(roles.error)?.requestId}
          onRetry={() => void roles.refetch()}
        />
      ) : (
        <div className="space-y-4">
          {roles.data.roles.map((role) => (
            // Keyed by the saved permissions so a successful save resets the card's draft.
            <RoleCard
              key={`${role.code}:${role.permissions.join(',')}`}
              role={role}
              catalog={roles.data.permissions}
              editable={editable}
            />
          ))}
        </div>
      )}
    </div>
  );
}
