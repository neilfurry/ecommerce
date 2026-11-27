import * as Sentry from '@sentry/node';

let enabled = false;

const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'paymongo-signature',
];

/**
 * Error tracking with the Sentry SDK (Sentry SaaS or a self-hosted, Sentry-compatible server
 * such as GlitchTip). Off unless SENTRY_DSN is set. Only errors are sent: no performance
 * tracing, no request bodies, cookies or auth headers, and no user IP addresses.
 */
export function initErrorReporting(options: {
  dsn: string | undefined;
  environment: string;
  release: string;
  service: string;
}): void {
  if (!options.dsn || enabled) return;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    serverName: options.service,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        for (const header of SENSITIVE_HEADERS) delete event.request.headers?.[header];
      }
      delete event.user;
      return event;
    },
  });
  enabled = true;
}

export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  if (!enabled) return;
  Sentry.captureException(error, { extra: context });
}

/** Sends queued events before the process exits. */
export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
