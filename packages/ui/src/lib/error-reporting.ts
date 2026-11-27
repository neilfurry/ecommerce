/**
 * Browser error tracking with the Sentry SDK (Sentry or a Sentry-compatible server such as
 * GlitchTip), loaded only when the app was built with VITE_SENTRY_DSN, so builds without it
 * download nothing extra. Sends unhandled errors only: no session replay, no performance
 * tracing, no user identity, and URLs are stripped of query strings (they can carry one-time
 * tokens from emails).
 */
export function initBrowserErrorReporting(options: {
  app: 'storefront' | 'seller' | 'admin';
  dsn: string | undefined;
  environment: string | undefined;
  release: string | undefined;
}): void {
  const { app, dsn } = options;
  if (!dsn) return;
  void import('@sentry/browser').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: options.environment ?? 'production',
      release: options.release,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      initialScope: { tags: { app } },
      beforeSend(event) {
        if (event.request?.url) event.request.url = event.request.url.split('?')[0];
        delete event.request?.cookies;
        delete event.user;
        return event;
      },
      beforeBreadcrumb(crumb) {
        // Fetch/XHR breadcrumbs keep the path only.
        if (crumb.data && typeof crumb.data.url === 'string') {
          crumb.data.url = crumb.data.url.split('?')[0];
        }
        return crumb;
      },
    });
  });
}
