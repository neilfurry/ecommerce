import { hasPermission, useFulfilmentAction, useSession } from '@marketplace/api-client';
import type { Permission } from '@marketplace/shared-types';
import { toast } from '@marketplace/ui';
import { showError } from '../../lib/errors';

export function useCan() {
  const session = useSession();
  return (permission: Permission) => hasPermission(session.data, permission);
}

/** Runs an action with a success toast; errors are shown and rethrown (dialogs stay open). */
export function useRun() {
  const action = useFulfilmentAction();
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
