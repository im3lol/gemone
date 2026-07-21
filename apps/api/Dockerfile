# Build context is the repo root (see docker-compose.yml).
# ponytail: reliable over slim — keeps the pnpm workspace layout intact so the
# Prisma client resolves. Slim later with `pnpm deploy` if image size matters.
FROM node:22-alpine AS build
RUN npm install -g pnpm@11
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter "@offerwall/api..." --frozen-lockfile=false

COPY apps/api apps/api
RUN pnpm --filter @offerwall/api exec prisma generate \
 && pnpm --filter @offerwall/api build

FROM node:22-alpine AS runtime
RUN npm install -g pnpm@11
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=build /app /app
EXPOSE 4000
# Apply pending migrations, then boot. Safe to run on every start.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
