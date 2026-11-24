import { isRouteErrorResponse, useRouteError } from 'react-router';
import { NotFound } from './not-found';
import { ErrorState } from './error-state';

/**
 * Router-level error boundary (route `errorElement`). Unexpected render errors show a
 * friendly message with a reload action; internal details are only logged to the console.
 */
export function RouteError() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <NotFound />
      </div>
    );
  }

  console.error(error);
  return (
    <div className="mx-auto max-w-xl p-6">
      <ErrorState
        title="This page failed to load"
        message="An unexpected error occurred. Reloading usually fixes it."
        onRetry={() => window.location.reload()}
      />
    </div>
  );
}
