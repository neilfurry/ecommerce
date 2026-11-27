import { createServer, type Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics of the API process. Served on a separate, internal-only port
 * (METRICS_PORT) so the public load balancer never exposes them.
 */
export const registry = new Registry();
registry.setDefaultLabels({ service: 'api' });
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'API request duration by route template and status code',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const webhookRejections = new Counter({
  name: 'marketplace_webhook_rejections_total',
  help: 'Payment or courier webhooks refused because of a bad or missing signature',
  labelNames: ['provider'] as const,
  registers: [registry],
});

export const unhandledErrors = new Counter({
  name: 'marketplace_api_unhandled_errors_total',
  help: 'Requests that ended in an unexpected 5xx error',
  registers: [registry],
});

/**
 * Records every request under its route template (/api/v1/orders/:id, never the real id), so
 * label cardinality stays bounded. Requests that matched no route are grouped as "unmatched".
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const routePath = (req.route as { path?: string } | undefined)?.path;
    const route = routePath ? `${req.baseUrl}${routePath}` : 'unmatched';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}

/** Serves GET /metrics on the given port; returns the server so shutdown can close it. */
export function startMetricsServer(port: number, metrics: Registry = registry): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    metrics
      .metrics()
      .then((body) => res.writeHead(200, { 'Content-Type': metrics.contentType }).end(body))
      .catch(() => res.writeHead(500).end());
  });
  server.listen(port);
  return server;
}
