# syntax=docker/dockerfile:1.7
# Express API and pg-boss worker (one image, two entry points). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t mbc-impact/api .
#
# Entry points:
#   API:    node dist/server.js   (default CMD)
#   worker: node dist/worker.js   (compose "worker" service overrides the command)
#
# Migrations are NEVER run on container start. Run them as a one-off command (see deploy/README.md):
#   docker compose run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy

ARG NODE_IMAGE=node:24.22.1-alpine3.23

# ---------- base: pnpm on Node LTS ----------
FROM ${NODE_IMAGE} AS base
ENV HUSKY=0 \
    CI=true
RUN npm install -g pnpm@10.18.3 --no-fund --no-audit
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/ packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build: compile shared + api, then produce a pruned production tree ----------
FROM deps AS build
COPY apps/api/ apps/api/
# Placeholder only so prisma.config.ts can load during `prisma generate`; never a real database.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @mbc/shared build \
 && pnpm --filter @mbc/api exec prisma generate \
 && pnpm --filter @mbc/api build \
 && pnpm --filter @mbc/api --prod --legacy deploy /out/api

# ---------- runner ----------
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health > /dev/null || exit 1
CMD ["node", "dist/server.js"]
