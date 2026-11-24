import { toDisplayError } from '@marketplace/api-client';
import { toast } from '@marketplace/ui';

/** Toast for a failed action, with the request reference support can look up. */
export function showError(title: string, error: unknown) {
  const display = toDisplayError(error);
  toast.error(title, {
    description: display?.requestId
      ? `${display.message} (ref ${display.requestId})`
      : display?.message,
  });
}
