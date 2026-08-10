# One image, two roles — ARCHITECTURE.md §1.2.
#
# `api` and `worker` are the same build with different entrypoints. Splitting
# them into two images would duplicate every layer to change one CMD.

# ---------------------------------------------------------------- deps stage
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /repo

# Manifests first, so a source-only change does not invalidate the install
# layer. This is the difference between a 5-second rebuild and a 2-minute one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tsconfig/package.json ./packages/tsconfig/

RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------- build stage
FROM node:24-alpine AS build
RUN corepack enable

# pnpm refuses to prune an existing modules directory without a TTY. This is
# what it asks for, and it is true: this is a non-interactive build.
ENV CI=true
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY . .

RUN pnpm --filter @gemone/contracts build \
 && pnpm --filter @gemone/api build

# ------------------------------------------------------------- migrate stage
# Applies migrations and exits. It branches from `build` because the Prisma CLI
# is a dev dependency and is therefore gone from anything installed with
# `--prod`. Same layers as the build above, so this costs no extra download.
#
# `migrate deploy` is idempotent: it applies what is missing and does nothing
# when the schema is current. It never generates a migration, so a container
# cannot invent a schema change nobody reviewed.
FROM build AS migrate
CMD ["pnpm", "--filter", "@gemone/api", "db:deploy"]

# ---------------------------------------------------------------- prune stage
FROM build AS pruned
RUN pnpm install --frozen-lockfile --prod

# --------------------------------------------------------------- runtime stage
FROM node:24-alpine AS runtime
WORKDIR /repo

ENV NODE_ENV=production
ENV LOG_PRETTY=false

COPY --from=pruned /repo/node_modules ./node_modules
COPY --from=pruned /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=pruned /repo/apps/api/dist ./apps/api/dist
COPY --from=pruned /repo/apps/api/package.json ./apps/api/
COPY --from=pruned /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=pruned /repo/packages/contracts/package.json ./packages/contracts/

# Never run as root. The node image ships an unprivileged `node` user.
USER node

EXPOSE 3000

# Overridden to dist/worker.js for the worker container.
CMD ["node", "apps/api/dist/main.js"]
