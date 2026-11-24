import { ROLE_LABELS, type UserRole, type UserStatus } from '@marketplace/shared-types';
import { Badge } from '@marketplace/ui';

const STATUS: Record<
  UserStatus,
  { label: string; variant: 'success' | 'secondary' | 'destructive' }
> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  INVITED: { label: 'Invited', variant: 'secondary' },
  SUSPENDED: { label: 'Suspended', variant: 'destructive' },
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const { label, variant } = STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function RoleBadges({ roles }: { roles: readonly UserRole[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role} variant="outline">
          {ROLE_LABELS[role]}
        </Badge>
      ))}
    </div>
  );
}
