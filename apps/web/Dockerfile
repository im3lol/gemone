# Build context is the repo root (see docker-compose.yml).
FROM node:22-alpine AS build
RUN npm install -g pnpm@11
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter "@offerwall/web..." --frozen-lockfile=false

COPY apps/web apps/web
RUN pnpm --filter @offerwall/web build

# Next.js standalone output — a minimal self-contained server.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
