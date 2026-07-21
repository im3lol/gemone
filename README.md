# GemOne — all offerwalls in one web app

Monorepo (pnpm workspaces).

```
apps/
  web/   Next.js 16 + React 19 + Tailwind v4  (landing, auth, user dashboard, admin)
  api/   NestJS 11 + Prisma + Postgres         (@offerwall/api)
design/  Reference designs (.dc.html) + screenshots
```

## Prerequisites
Node ≥ 20, pnpm, Docker (for Postgres).

## Run it (first time)

```bash
pnpm install
docker compose up -d                                   # Postgres on :5433

cd apps/api
cp .env.example .env                                   # already present for local dev
pnpm exec prisma migrate dev                           # create schema
pnpm exec ts-node prisma/seed.ts                       # seed demo user
pnpm start:dev                                         # API on :4000

# in another terminal
cd apps/web
pnpm dev                                               # web on :3000
```

Open http://localhost:3000.

**Demo login:** `ashley@gemone.dev` / `password123` — or sign up a fresh account (gets a 50-point welcome bonus).

## What works today (milestone 1: auth + dashboard)
- Signup / login with **argon2** hashing + **JWT** access/refresh, stored in httpOnly cookies.
- `/dashboard` is auth-gated (proxy + server-side check) and shows **real data** from Postgres:
  balance, today's earnings, pending, completed offers, level/XP, recent activity.
- Rate-limited auth endpoints (in-memory throttle).

## Not built yet (next milestones — see IMPLEMENTATION_PLAN)
Offerwall integration + postbacks, wallet/ledger reconciliation, withdrawals, fraud, admin data.
The landing page's offer cards / daily-bonus / achievements and the whole `/admin` screen are still
static mock UI.
