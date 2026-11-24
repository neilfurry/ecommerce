import { ApiError, toDisplayError } from '@marketplace/api-client';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

/**
 * Puts the API's field errors on the matching form fields. Returns the message to show
 * above the form for everything else (or null when every error went to a field).
 */
export function applyApiErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: unknown,
): string | null {
  if (error instanceof ApiError && error.fieldErrors.length > 0) {
    const fields = Object.keys(form.getValues());
    let unplaced = false;
    for (const fieldError of error.fieldErrors) {
      const root = fieldError.path.split('.')[0] ?? '';
      if (fields.includes(root)) {
        form.setError(fieldError.path as Path<T>, { type: 'server', message: fieldError.message });
      } else {
        unplaced = true;
      }
    }
    return unplaced ? error.message : null;
  }
  const display = toDisplayError(error);
  if (!display) return null;
  return display.requestId ? `${display.message} (ref ${display.requestId})` : display.message;
}
