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

/** Opens a downloaded file (fetched with the session) in a new tab, or saves it. */
export function openBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const viewable = blob.type === 'application/pdf' || blob.type.startsWith('image/');
  if (viewable && window.open(url, '_blank', 'noopener')) {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
