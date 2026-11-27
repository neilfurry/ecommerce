import { hasPermission, useFinanceAction, useSession } from '@marketplace/api-client';
import type { Permission } from '@marketplace/shared-types';
import { toast } from '@marketplace/ui';
import { Link } from 'react-router';
import { showError } from '../../lib/errors';

export const PAGE_SIZE = 25;
export const manilaToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
export const monthStart = () => manilaToday().slice(0, 8) + '01';

export const pageOf = (
  data: { totalItems: number } | undefined,
  page: number,
  setPage: (n: number) => void,
  fetching: boolean,
) =>
  data
    ? {
        page,
        pageSize: PAGE_SIZE,
        totalItems: data.totalItems,
        onPageChange: setPage,
        isFetching: fetching,
      }
    : undefined;

export function useCan() {
  const session = useSession();
  return (permission: Permission) => hasPermission(session.data, permission);
}

/** Runs a finance action with a success toast; errors are shown and rethrown (dialogs stay open). */
export function useFinanceRun() {
  const action = useFinanceAction();
  const run = (title: string, success: string, fn: Parameters<typeof action.mutateAsync>[0]) =>
    action
      .mutateAsync(fn)
      .then((r) => {
        toast.success(success);
        return r;
      })
      .catch((e: unknown) => {
        showError(title, e);
        throw e;
      });
  return { run, pending: action.isPending };
}

export const orderLink = (id: string, number: string) => (
  <Link to={`/seller-orders/${id}`} className="font-mono hover:underline">
    {number}
  </Link>
);
export const documentLink = (id: string, label: string) => (
  <Link to={`/finance/documents/${id}`} className="hover:underline">
    {label}
  </Link>
);
