import { toDisplayError, usePermissionCatalog } from '@marketplace/api-client';
import { ROLE_LABELS } from '@marketplace/shared-types';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  LoadingState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@marketplace/ui';
import type { PermissionList } from '@marketplace/validation';
import { Link } from 'react-router';

const GROUPS = [
  {
    scope: 'platform',
    title: 'Marketplace staff permissions',
    description: 'Held by marketplace staff roles. They apply across every seller and customer.',
  },
  {
    scope: 'seller',
    title: 'Seller team permissions',
    description:
      "Held by seller roles, or granted to a seller's employee directly by their owner or manager. They only ever apply to that seller's own business.",
  },
] as const;

function PermissionTable({ permissions }: { permissions: PermissionList['permissions'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Permission</TableHead>
          <TableHead>Held by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {permissions.map((permission) => (
          <TableRow key={permission.code}>
            <TableCell className="align-top">
              <p className="font-medium">{permission.description}</p>
              <code className="text-xs text-muted-foreground">{permission.code}</code>
            </TableCell>
            <TableCell className="align-top">
              <div className="flex flex-wrap gap-1">
                {permission.roles.length ? (
                  permission.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {ROLE_LABELS[role]}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No role</span>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PermissionsPage() {
  const catalog = usePermissionCatalog();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Permissions"
        description={
          <>
            Everything a role can be allowed to do, and which roles hold it today. Change what a
            role holds on{' '}
            <Link to="/roles" className="underline underline-offset-4">
              Roles
            </Link>
            .
          </>
        }
      />
      {catalog.isPending ? (
        <LoadingState />
      ) : catalog.isError ? (
        <ErrorState
          message={toDisplayError(catalog.error)?.message ?? 'Could not load permissions.'}
          onRetry={() => void catalog.refetch()}
        />
      ) : (
        GROUPS.map((group) => (
          <Card key={group.scope}>
            <CardHeader>
              <CardTitle>
                <h2>{group.title}</h2>
              </CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <PermissionTable
                permissions={catalog.data.permissions.filter((p) => p.scope === group.scope)}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
