# The SvelteKit BFF — ARCHITECTURE.md §6.1, §19.1.
#
# A separate image from `api`, unlike `api` and `worker` which share one. Those
# two are the same program with different entrypoints; this is a different
# program with a different dependency tree, and merging them would ship the
# Prisma engine and argon2 into the process that is deliberately not allowed to
# touch the database (§19.1, Zone 2a).

# ---------------------------------------------------------------- deps stage
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /repo

# Manifests first, so a source-only change does not invalidate the install
# layer. This is the difference between a 5-second rebuild and a 2-minute one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tsconfig/package.json ./packages/tsconfig/

RUN pnpm install --frozen-lockfile --filter @gemone/web... --filter @gemone/contracts...

# --------------------------------------------------------------- build stage
FROM node:24-alpine AS build
RUN corepack enable

# pnpm refuses to prune an existing modules directory without a TTY. This is
# what it asks for, and it is true: this is a non-interactive build.
ENV CI=true
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY . .

RUN pnpm --filter @gemone/contracts build \
 && pnpm --filter @gemone/web build

# --------------------------------------------------------------- runtime stage
FROM node:24-alpine AS runtime
WORKDIR /repo

ENV NODE_ENV=production

# `adapter-node` bundles the server and its dependencies into `build/`, so the
# runtime image needs neither node_modules nor the source. That is the reason
# this stage is a few megabytes rather than a few hundred.
COPY --from=build /repo/apps/web/build ./build

# Never run as root. The node image ships an unprivileged `node` user.
USER node

EXPOSE 3000

CMD ["node", "build/index.js"]
