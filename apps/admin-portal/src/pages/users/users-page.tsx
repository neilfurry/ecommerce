import { hasPermission, toDisplayError, useAdminUsers, useSession } from '@marketplace/api-client';
import { ROLE_LABELS, USER_ROLES, type UserRole, type UserStatus } from '@marketplace/shared-types';
import {
  DataTable,
  type DataTableColumn,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@marketplace/ui';
import type { AdminUser } from '@marketplace/validation';
import { SearchIcon, UsersIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { formatDateTime } from '../../lib/format';
import { InviteStaffDialog } from './invite-staff-dialog';
import { RoleBadges, UserStatusBadge } from './user-badges';

const PAGE_SIZE = 20;
const ALL = 'all';

const COLUMNS: DataTableColumn<AdminUser>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (user) => (
      <div className="min-w-0">
        <Link to={`/users/${user.id}`} className="font-medium underline-offset-4 hover:underline">
          {user.firstName} {user.lastName}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
    ),
  },
  { id: 'roles', header: 'Roles', cell: (user) => <RoleBadges roles={user.roles} /> },
  { id: 'status', header: 'Status', cell: (user) => <UserStatusBadge status={user.status} /> },
  {
    id: 'mobile',
    header: 'Mobile',
    hideOnMobile: true,
    className: 'tabular-nums',
    cell: (user) => user.mobile ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'last-sign-in',
    header: 'Last sign-in',
    hideOnMobile: true,
    cell: (user) =>
      user.lastSignInAt ? (
        formatDateTime(user.lastSignInAt)
      ) : (
        <span className="text-muted-foreground">Never</span>
      ),
  },
];

function FilterSelect<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: T | typeof ALL;
  onChange: (value: T | typeof ALL) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as T | typeof ALL)}>
        <SelectTrigger id={id} className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function UsersPage() {
  const session = useSession();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'staff' | 'customers' | typeof ALL>(ALL);
  const [role, setRole] = useState<UserRole | typeof ALL>(ALL);
  const [status, setStatus] = useState<UserStatus | typeof ALL>(ALL);
  const deferredSearch = useDeferredValue(search.trim());
  const users = useAdminUsers({
    page,
    pageSize: PAGE_SIZE,
    search: deferredSearch || undefined,
    kind: kind === ALL ? undefined : kind,
    role: role === ALL ? undefined : role,
    status: status === ALL ? undefined : status,
  });
  const resetPage =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Staff accounts and customers. Staff are invited by email; customers sign up themselves."
        actions={hasPermission(session.data, 'users.create') ? <InviteStaffDialog /> : null}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="user-search">Search</Label>
          <div className="relative">
            <SearchIcon
              className="absolute top-2.5 left-3 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="user-search"
              type="search"
              placeholder="Name, email or mobile number"
              className="pl-9"
              value={search}
              onChange={(event) => resetPage(setSearch)(event.target.value)}
            />
          </div>
        </div>
        <FilterSelect
          id="user-kind"
          label="Type"
          value={kind}
          onChange={resetPage(setKind)}
          options={[
            { value: 'staff', label: 'Staff' },
            { value: 'customers', label: 'Customers' },
          ]}
        />
        <FilterSelect
          id="user-role"
          label="Role"
          value={role}
          onChange={resetPage(setRole)}
          options={USER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
        <FilterSelect
          id="user-status"
          label="Status"
          value={status}
          onChange={resetPage(setStatus)}
          options={[
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INVITED', label: 'Invited' },
            { value: 'SUSPENDED', label: 'Suspended' },
          ]}
        />
      </div>
      <DataTable
        label="Users"
        columns={COLUMNS}
        rows={users.data?.items}
        getRowId={(user) => user.id}
        isLoading={users.isPending}
        error={toDisplayError(users.error)}
        onRetry={() => void users.refetch()}
        empty={{
          icon: UsersIcon,
          title: 'No matching accounts',
          description: 'Try a different search or clear the filters.',
        }}
        pagination={
          users.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: users.data.totalItems,
                onPageChange: setPage,
                isFetching: users.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
