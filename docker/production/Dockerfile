# syntax=docker/dockerfile:1.7
#
# Production images for the marketplace, built from the repository root:
#
#   docker build -f docker/production/Dockerfile --target api      -t marketplace/api .
#   docker build -f docker/production/Dockerfile --target worker   -t marketplace/worker .
#   docker build -f docker/production/Dockerfile --target edge     -t marketplace/edge .
#   docker build -f docker/production/Dockerfile --target tools    -t marketplace/tools .
#
# api / worker: Node.js on Debian slim, production dependencies only, non-root user.
# edge:         Caddy serving the three built frontends and proxying /api (TLS, load balancing).
# tools:        the full workspace for one-off operations: migrations, reference data, the
#               first super admin (never runs as a long-lived service).

ARG NODE_IMAGE=node:24-bookworm-slim
ARG CADDY_IMAGE=caddy:2.10-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# ---- Dependencies (cached until a manifest or the lockfile changes) -------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/storefront/package.json apps/storefront/
COPY apps/seller-portal/package.json apps/seller-portal/
COPY apps/admin-portal/package.json apps/admin-portal/
COPY packages/ui/package.json packages/ui/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/auth-ui/package.json packages/auth-ui/
COPY packages/payments/package.json packages/payments/
COPY prisma/package.json prisma/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ---- Build everything ---------------------------------------------------------------------
FROM deps AS build
COPY . .
# Public, build-time settings of the browser apps (never secrets: they ship to every browser).
ARG VITE_API_BASE_URL=/api
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=production
ARG APP_VERSION=0.0.0
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_SENTRY_DSN=${VITE_SENTRY_DSN} \
    VITE_SENTRY_ENVIRONMENT=${VITE_SENTRY_ENVIRONMENT} \
    VITE_APP_VERSION=${APP_VERSION} \
    VITE_DEV_TOOLS_ENABLED=false
RUN pnpm run build
# Self-contained production installs of the two Node services (workspace packages included).
RUN pnpm --filter @marketplace/api deploy --prod --legacy /out/api \
 && pnpm --filter @marketplace/worker deploy --prod --legacy /out/worker

# ---- Node runtime base --------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /app
ENTRYPOINT ["/usr/bin/tini", "--"]

FROM runtime AS api
ARG APP_VERSION=0.0.0
ENV APP_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /out/api /app
EXPOSE 3000 9464
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health/live || exit 1
CMD ["node", "dist/main.js"]

FROM runtime AS worker
ARG APP_VERSION=0.0.0
ENV APP_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /out/worker /app
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:9464/metrics -o /dev/null || exit 1
CMD ["node", "dist/main.js"]

# ---- Operations image (migrations, reference data, bootstrap) -------------------------------
FROM build AS tools
ENV NODE_ENV=production
WORKDIR /repo
# Migrations need Prisma's schema engine, downloaded here at build time.
RUN pnpm --filter @marketplace/database exec prisma --version
CMD ["pnpm", "db:deploy"]

# ---- Edge: Caddy with the three frontends -----------------------------------------------------
FROM ${CADDY_IMAGE} AS edge
COPY docker/production/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/storefront/dist /srv/storefront
COPY --from=build /repo/apps/seller-portal/dist /srv/seller
COPY --from=build /repo/apps/admin-portal/dist /srv/admin
EXPOSE 80 443 443/udp
