# syntax=docker/dockerfile:1.7
# Next.js web app. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t mbc-impact/web .
# Multi-stage: install workspace deps -> build shared + web (standalone) -> slim runtime as non-root.

ARG NODE_IMAGE=node:24.22.1-alpine3.23

# ---------- base: pnpm on Node LTS ----------
FROM ${NODE_IMAGE} AS base
ENV HUSKY=0 \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.18.3 --no-fund --no-audit
WORKDIR /app

# ---------- deps: workspace manifests only, so this layer is cached until a lockfile changes ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
# packages/shared is built by the root postinstall hook, so its sources must be present.
COPY packages/shared/ packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY apps/web/ apps/web/
RUN pnpm --filter @mbc/shared build \
 && pnpm --filter @mbc/web build

# ---------- runner: standalone output only ----------
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    PORT=33333 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# outputFileTracingRoot is the repo root, so the standalone tree keeps the apps/web prefix.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 33333
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:33333/ > /dev/null || exit 1
CMD ["node", "apps/web/server.js"]
