import { hasPermission, toDisplayError, useSession } from '@marketplace/api-client';
import type { Permission } from '@marketplace/shared-types';
import { EmptyState, ErrorState, LoadingState } from '@marketplace/ui';
import { LockIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

/** Where to return after signing in, carried in router state. */
export interface ReturnState {
  from?: string;
}

/** Renders children (or the nested routes) only for a signed-in user; otherwise goes to sign-in. */
export function RequireSession({
  signInPath = '/sign-in',
  children,
}: {
  signInPath?: string;
  children?: ReactNode;
}) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) {
    return <LoadingState label="Checking your session…" className="min-h-[50svh]" />;
  }
  if (session.isError) {
    const display = toDisplayError(session.error);
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          message={display?.message ?? 'Could not check your session.'}
          requestId={display?.requestId}
          onRetry={() => void session.refetch()}
          isRetrying={session.isFetching}
        />
      </div>
    );
  }
  if (!session.data) {
    const state: ReturnState = { from: `${location.pathname}${location.search}` };
    return <Navigate to={signInPath} replace state={state} />;
  }
  return <>{children ?? <Outlet />}</>;
}

/** Sign-in and sign-up pages send a user who is already signed in onwards. */
export function RedirectIfSignedIn({ to = '/', children }: { to?: string; children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <LoadingState className="min-h-svh" />;
  if (session.data) {
    const from = (location.state as ReturnState | null)?.from;
    return <Navigate to={from && from.startsWith('/') ? from : to} replace />;
  }
  return <>{children}</>;
}

/**
 * Shows a page only to users holding the permission. The API enforces the same rule; this
 * only avoids showing controls that would be refused.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const session = useSession();
  if (!hasPermission(session.data, permission)) {
    return (
      <EmptyState
        icon={LockIcon}
        title="You don't have access to this page"
        description="Ask a super admin to give your role the permission it needs."
      />
    );
  }
  return <>{children}</>;
}
