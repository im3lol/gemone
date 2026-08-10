# ARCHITECTURE.md — Offerwall Aggregator Platform

> **Companion to:** [PROJECT.md](PROJECT.md) (scope approved, Rev 3).
> **Status:** **Approved** (Rev 2 — review adjustments applied). Implementation
> may begin at M1.
> **Audience:** whoever implements this. Every section is meant to be actionable.

This document describes **how the system is built**, not what it does. Where a
decision could reasonably have gone another way, the reasoning is stated — a
decision without a reason cannot be revisited intelligently later.

Principle references (`P1`–`P6`) point at §1 of PROJECT.md:

| | Principle | One-line meaning here |
|---|---|---|
| **P1** | Provider Independence | Business logic talks to internal interfaces only |
| **P2** | Abstracted Reward Accounting | One service owns all balance mutations |
| **P3** | Everything Configurable | Business rules live in the database, not in code |
| **P4** | Free-First Infrastructure | Open-source, cheap to run, cheap to replace |
| **P5** | Correctness Over Throughput | Money correctness beats latency |
| **P6** | Simplicity First | Abstractions must name a present-tense problem |

---

## 1. High-Level Architecture

### 1.1 System Shape

```
                    ┌─────────────────────────────────────────┐
                    │            Public Internet              │
                    └──────────┬───────────────────┬──────────┘
                               │                   │
                        users / admins      provider postbacks
                               │                   │
                    ┌──────────▼───────────────────▼──────────┐
                    │       Caddy — TLS, edge routing         │
                    └──────────┬───────────────────┬──────────┘
                               │                   │
                    ┌──────────▼─────────┐         │
                    │  web (SvelteKit)   │         │
                    │  SSR + BFF proxy   │         │
                    └──────────┬─────────┘         │
                               │ internal HTTP     │
                    ┌──────────▼───────────────────▼──────────┐
                    │              api (NestJS)               │
                    │   HTTP surface · business logic · DB    │
                    └──────┬───────────────┬──────────┬───────┘
                           │               │          │ enqueue
                    ┌──────▼─────┐  ┌──────▼─────┐    │
                    │ PostgreSQL │  │   Redis    │◄───┘
                    └──────▲─────┘  └──────▲─────┘
                           │               │ consume
                    ┌──────┴───────────────┴──────────────────┐
                    │            worker (NestJS)              │
                    │   queue consumers · scheduled jobs      │
                    └──────────────────┬──────────────────────┘
                                       │ outbound HTTPS
                                       ▼
                            offerwall provider APIs
```

### 1.2 Runtime Processes

Five containers, one VPS. Each is a process, not a service in the
microservice sense.

| Process | Responsibility | Scales by |
|---|---|---|
| `caddy` | TLS termination, HTTP routing, static asset caching | n/a |
| `web` | SvelteKit SSR + BFF proxy; holds the session cookie | replicas |
| `api` | All HTTP endpoints, business logic, database access | replicas |
| `worker` | Queue consumers and scheduled jobs. **Same image as `api`, different entrypoint** | replicas |
| `postgres` / `redis` | State | vertically, for a long time |

**Why `api` and `worker` are separate processes but one codebase.** They share
every service, model, and migration — splitting the code would duplicate the
domain for no benefit (P6). They are separate *processes* because a postback
handler must acknowledge in milliseconds while catalog syncs and reconciliation
runs take seconds to minutes. Sharing a process means a slow job's event-loop
pressure delays a postback ack, and a delayed ack means the provider retries,
and a retry is a duplicate we then have to deduplicate. Process separation is
the cheapest way to make that class of problem structurally impossible.

**Why a modular monolith and not microservices.** There is one team, one
database, and one transactional boundary that actually matters (crediting a
reward). Distributing it would replace in-process function calls with network
calls that can fail halfway — turning a database transaction into a distributed
saga to solve a scaling problem that does not exist. P6 forbids this. Module
boundaries (§4) are enforced in code so that *if* extraction is ever needed, the
seams already exist.

### 1.3 Technology Choices Not Already Fixed in PROJECT.md

| Concern | Choice | Why this and not the alternative |
|---|---|---|
| Package manager | **pnpm workspaces** | Native workspace support, disk-efficient, no extra tool. npm workspaces would also work; pnpm's strict linking catches undeclared cross-package imports, which supports §5 |
| Build orchestration | **pnpm scripts only** | Turborepo/Nx add caching value at a repo size we do not have. Revisit when CI time is a real complaint (P6) |
| Reverse proxy | **Caddy** | Automatic TLS with zero configuration. Nginx needs certbot wiring for the same result (P4, P6) |
| Queue | **BullMQ** on the existing Redis | Redis is already required for caching and rate limiting. A dedicated broker (RabbitMQ, NATS) is a second piece of infrastructure to run and back up, for guarantees we do not yet need (P4, P6) |
| HTTP client | **Native `fetch` + `undici`** | No axios dependency; timeouts and retries are configured once in the provider HTTP helper |
| Validation | **class-validator + Nest `ValidationPipe`** | Idiomatic in NestJS; validation lives on the DTO, next to the shape it validates |
| Password hashing | **argon2id** | Current best-practice default; bcrypt is acceptable but argon2 has better memory-hardness |
| Logging | **pino** | Structured JSON, low overhead, integrates with NestJS cleanly |
| Email | **SMTP via an adapter interface** | Any free-tier provider behind our own interface (P1, P4) |
| Error tracking | **GlitchTip** — *deferred, see §17.5* | Free, self-hosted, Sentry-compatible; not built for the first release |
| Uptime monitoring | **Uptime Kuma** (self-hosted) | Free, sufficient, one container |
| Testing | **Vitest / Jest + Testcontainers + Playwright** | All free and open-source; real Postgres and Redis in CI (§18) |

---

## 2. Repository & Monorepo Structure

**Decision: a single monorepo, managed with pnpm workspaces.**

### 2.0 Why a Monorepo and Not Multiple Repositories

The realistic alternative is three repositories — `api`, `web`, and a published
`contracts` package — or two, with types duplicated by hand. Both were rejected.

**The present-tense problem a monorepo solves (P6).** The API and the web app
share a vocabulary: request and response shapes, enum values, error codes. That
vocabulary changes constantly during an MVP. In a multi-repo setup, every change
to it becomes a four-step ritual — edit `contracts`, version it, publish it,
bump the dependency in two consumers — and the cost of that ritual is paid in
skipped steps. Someone eventually hand-copies a type "just this once," the two
sides drift, and the drift surfaces as a runtime error in production rather than
a compile error in CI. This is not a hypothetical future problem; it starts in
week 1 with the first DTO.

**What the monorepo buys, concretely:**

| Benefit | Multi-repo equivalent |
|---|---|
| A breaking API change and its frontend fix are **one commit, one review, one CI run** | Two PRs across two repos, merged in the right order, with a window where main is broken |
| Types are consumed from source — a mismatch is a **compile error** | Types consumed from a published version — a mismatch is a **runtime error**, discovered later |
| One `pnpm install`, one command to run everything locally | Cross-repo linking (`npm link`, `file:` deps) that behaves differently from production |
| One CI pipeline, one lint config, one TypeScript config | Three of each, drifting apart |
| Atomic refactors across the whole system | Coordinated multi-repo migrations |

**What it costs, honestly.** CI runs more than strictly necessary until path
filtering is added; repository access is all-or-nothing, which matters only when
there are contractors with partial access; and the repo grows faster. None of
these are problems at this size, and each has a cheap remedy when they become
problems.

**Why this does not contradict the modular monolith reasoning (§1.2).** They are
the same argument applied at two levels: keep things together while one team owns
all of it, and enforce boundaries *in code* so that separating them later is
mechanical rather than archaeological. Module boundaries (§4) are what make the
monorepo safe — without them, a single repository does become the tangle its
critics describe.

**Why pnpm workspaces and not a build system.** Workspaces solve dependency
linking, which is the actual problem. Turborepo and Nx solve build caching and
task orchestration across many packages — real problems at 20 packages, absent at
four (P6). The trigger to revisit is stated in §22: CI time becoming a genuine
complaint.

### 2.1 Layout

```
gemone/
├── apps/
│   ├── api/                    # NestJS — API + worker (one image, two entrypoints)
│   └── web/                    # SvelteKit — SSR UI + BFF proxy
│
├── packages/
│   ├── contracts/              # Shared request/response types, enums, error codes
│   └── tsconfig/               # Shared TypeScript base configs
│
├── docker/
│   ├── Caddyfile
│   ├── api.Dockerfile
│   └── web.Dockerfile
│
├── docs/
│   ├── PROJECT.md
│   ├── ARCHITECTURE.md
│   └── adr/                    # One file per non-obvious decision
│
├── docker-compose.yml          # Local development
├── docker-compose.prod.yml     # Production
├── pnpm-workspace.yaml
└── package.json
```

### 2.2 What `packages/contracts` Is and Is Not

**It is:** the API's public vocabulary — request DTO shapes, response shapes,
enum values (transaction types, payout statuses, error codes).

**It is not:** shared business logic, shared validation rules, or shared database
models. Those belong to `apps/api` alone.

**Why the constraint matters.** A shared package that accumulates logic becomes a
third deployable with implicit coupling to both apps, and every change to it
requires reasoning about two consumers. Restricting it to type declarations keeps
it a compile-time artifact with zero runtime footprint (P6). Prisma-generated
types stay inside `apps/api` — the database schema is not part of the API
contract, and leaking it into the web app would make every schema change a
frontend concern.

**Only two packages exist.** `packages/` is where speculative shared code
accumulates in monorepos. A third package requires naming the duplication it
eliminates (P6).

---

## 3. Folder Structure — `apps/api`

```
apps/api/src/
├── main.ts                     # API entrypoint
├── worker.ts                   # Worker entrypoint (same modules, no HTTP)
├── app.module.ts
│
├── core/                       # Infrastructure. No business rules live here.
│   ├── config/                 # ConfigurationService (P3) + env schema
│   ├── database/               # PrismaService, transaction helper
│   ├── cache/                  # Redis cache service, key builders
│   ├── queue/                  # BullMQ registration, job contracts
│   ├── logging/                # pino setup, correlation-id middleware
│   ├── errors/                 # Error taxonomy, global exception filter
│   ├── http/                   # Outbound HTTP helper: timeouts, retries
│   └── security/               # Guards, signing/HMAC helpers, rate limiting
│
├── shared/                     # Domain primitives. Depends on nothing.
│   ├── enums/                  # TransactionType, PayoutStatus, ...
│   ├── value-objects/          # Balance, Points, Money
│   └── types/
│
├── modules/                    # Business domains
│   ├── auth/
│   ├── users/
│   ├── providers/              # Adapter registry + all provider adapters
│   │   ├── registry/
│   │   ├── contracts/          # OfferProviderAdapter interface + normalized DTOs
│   │   └── adapters/
│   │       ├── mock/
│   │       ├── adgem/
│   │       ├── torox/
│   │       └── lootably/
│   ├── offers/                 # Catalog sync, normalization, dedup, ranking, wall
│   ├── clicks/                 # Click creation, sub_id signing, redirect
│   ├── conversions/            # Postback intake + processing
│   ├── rewards/                # RewardAccountingService (P2) — sole balance owner
│   ├── payouts/                # Withdrawal state machine + PayoutProvider
│   ├── fraud/                  # Rule engine, scoring
│   ├── notifications/          # Email sending behind an interface
│   └── admin/                  # Admin-facing composition layer
│
└── jobs/                       # Scheduled job definitions and queue processors
```

### 3.1 Anatomy of a Module

Every module under `modules/` follows the same internal shape. Uniformity is the
point — a developer opening an unfamiliar module should not have to learn a new
layout.

```
modules/<name>/
├── <name>.module.ts            # Nest module: declares what is exported
├── <name>.controller.ts        # HTTP surface (omit if the module has none)
├── <name>.service.ts           # Business logic
├── dto/                        # Request/response DTOs with validation decorators
├── internal/                   # Helpers private to this module
└── <name>.service.spec.ts      # Tests next to the code
```

**No repository layer.** Modules use `PrismaService` directly, restricted to
their own tables (§5). Prisma is already a data-access abstraction; wrapping it
in a repository interface adds a layer whose only justification would be swapping
the database — a hypothetical problem, which P6 rejects. The one exception is
`rewards`, where the abstraction exists for a stated present-tense reason (P2).

**No separate domain/application/infrastructure layering inside modules.** A
module is small enough that a service file *is* the application layer. Layers get
added when a module's service exceeds what one file can hold clearly, not before.

---

## 4. Module Boundaries

Each module owns its tables. **No module reads or writes another module's
tables** — it calls the owning module's exported service.

| Module | Owns (tables) | Exports | Has HTTP surface |
|---|---|---|---|
| `auth` | `refresh_tokens`, `verification_tokens` | `AuthService`, guards | Yes — public |
| `users` | `users`, `user_devices` | `UsersService` | Yes — authenticated |
| `providers` | `providers`, `provider_credentials` | `ProviderRegistry` | No |
| `offers` | `offers`, `offer_sync_runs` | `OffersService`, `CatalogSyncService` | Yes — authenticated |
| `clicks` | `clicks` | `ClicksService` | Yes — authenticated + redirect |
| `conversions` | `conversions`, `provider_postbacks` | `ConversionsService` | Yes — **public postback surface** |
| `rewards` | `reward_transactions`, `user_balances` | `RewardAccountingService` | Yes — authenticated (read-only) |
| `payouts` | `payout_requests` | `PayoutsService` | Yes — authenticated |
| `fraud` | `fraud_evaluations` | `FraudService` | No |
| `notifications` | `email_log` | `NotificationService` | No |
| `admin` | `admin_audit_log` | — | Yes — admin only |
| `core/config` | `configuration_values`, `configuration_history` | `ConfigurationService` | Via `admin` |

### 4.1 Allowed Dependency Graph

```
        auth ──► users
                   ▲
   offers ──► providers
      │            ▲
      ▼            │
   clicks          │
      ▲            │
      │            │
 conversions ──────┘
      │
      ├──► rewards
      └──► fraud (call-in only, see §4.2)

   payouts ──► rewards
   payouts ──► fraud (call-in only)
   payouts ──► users

   admin ──► (every module's exported service, read-mostly)

   every module ──► core, shared
   core ──► shared
   shared ──► nothing
```

### 4.2 Why `fraud` Depends on Nothing

The obvious design has `fraud` reading clicks and conversions to score a user,
and `conversions` calling `fraud` before crediting — an import cycle, which
NestJS resolves with `forwardRef()` and which then quietly makes both modules
untestable in isolation.

Instead, **`fraud` receives everything it needs as a plain input object.** The
caller assembles the evaluation context (user, click, conversion, recent
velocity counters) and passes it in; `fraud` reads configuration, applies rules,
and returns a score plus a recommended action. It imports no business module.

This costs the caller a few lines of assembly and buys: no cycle, a rule engine
testable with plain objects and no database, and the ability to replay historical
scoring decisions later by reconstructing the input. The velocity counters
themselves live in Redis and are read through `core/cache`, not through the
`clicks` module.

### 4.3 Why `admin` Is a Composition Layer, Not a Domain

`admin` owns exactly one table — its audit log. Everything else it does is
calling other modules' public services and shaping the result for an admin
screen. It deliberately holds **no business logic**: an admin approving a payout
executes the same `PayoutsService` transition as any other actor, with a
different authorization check and an audit entry.

**Why this matters.** The common failure is an admin panel that grows a parallel
implementation of the same rules — one path for users, another for admins — and
they drift. When they drift, the admin path is the one that is wrong, and it is
the path that moves money.

### 4.4 Enforcement

Boundaries that are only documented are boundaries that erode. Three mechanisms,
in increasing order of strictness:

1. **`eslint-plugin-boundaries`** — declares each folder's element type and the
   permitted import directions. Violations fail lint, which fails CI.
2. **A dependency-cruiser rule set** — forbids `core → modules`, forbids cycles
   anywhere, and forbids any import of `modules/providers/adapters/*` from
   outside the registry (P1).
3. **An architecture test** (`arch.spec.ts`) — asserts that no file outside
   `modules/rewards/` references the `user_balances` or `reward_transactions`
   Prisma models (P2). This is the single most important rule in the codebase,
   so it gets its own dedicated test rather than sharing a lint config.

---

## 5. Dependency Rules

The rules, stated as flat imperatives an implementer can check against:

1. **`shared` imports nothing** from the project. It holds enums, value objects,
   and types with no behavior beyond their own invariants.
2. **`core` may import `shared`. `core` must never import from `modules`.** If a
   core service needs domain knowledge, the design is wrong — invert it and pass
   the knowledge in.
3. **Modules import `core`, `shared`, and other modules' *exported services only*.**
   Never another module's controller, DTO folder, `internal/`, or Prisma models.
4. **A module's Prisma access is limited to the tables it owns** (§4 table).
   Cross-module reads go through the owning service.
5. **Nothing outside `modules/rewards` touches balance state** — not for reads,
   not for reporting, not for the admin panel (P2).
6. **Nothing outside `modules/providers/registry` imports a concrete adapter** (P1).
7. **Nothing outside `modules/providers/adapters/<name>` contains that provider's
   name.** No `if (provider === 'adgem')` anywhere in the core. This is the
   practical test for P1: grep the codebase for a provider name and every hit
   should be inside that provider's folder, its configuration row, or a fixture.
8. **Business rule values are read from `ConfigurationService`, never from `env`
   or a constant** (P3). See §5.1.
9. **Cycles are forbidden** — between modules, and between files within a module.

### 5.1 Environment Variables vs. Configuration Service

A distinction worth getting right on day one, because mixing them is how business
rules end up in `.env` files where no admin can reach them.

| | `env` (infrastructure) | `ConfigurationService` (business) |
|---|---|---|
| Holds | Database URL, Redis URL, ports, secrets, provider API credentials | Reward rates, hold periods, withdrawal limits, daily limits, fraud thresholds, currencies |
| Changed by | A deploy | An admin, at runtime |
| Audited in | Git / the server | `configuration_history` |
| Validated | At boot, against a schema; the process refuses to start if invalid | On write, before it is stored |

**The test:** if a non-developer might reasonably need to change it, and changing
it alters user-visible behavior or economics, it is configuration (P3). If
getting it wrong breaks the process rather than the business, it is environment.

Provider *credentials* are environment (they are secrets and change with a
deploy); provider *reward rates and hold periods* are configuration.

### 5.2 Feature Flags Are Not Part of the MVP

**No feature flag system will be built or adopted.** Not LaunchDarkly, not
Unleash, not a `feature_flags` table, not a flags module.

**Why.** A flag system solves problems the MVP does not have: percentage
rollouts, targeted cohorts, A/B experiments, and decoupling deploy from release
across a large team. With one developer deploying a monolith, "release" and
"deploy" are already the same event. Adopting flags now would add a second
configuration mechanism — with its own storage, caching, admin surface, and audit
trail — parallel to the one P3 already requires. Two mechanisms for "change
behavior at runtime" is exactly the duplicated machinery P6 exists to prevent.

**If a flag becomes genuinely necessary, it is a configuration value.** The
`ConfigurationService` already provides everything a basic flag needs: typed
storage, validated writes, hot reload, scoped resolution, and a full audit trail
of who flipped it and when. A boolean key such as a provider's enabled state
(§7.3) is a feature flag in every meaningful sense — the system already has flags
where it needs them; what it does not have, and will not add, is a *platform* for
them.

**The boundary that keeps this honest.** Configuration keys must name the business
need they serve (§14.3 of PROJECT.md's P3 list). A key that exists to hide
half-finished code is not configuration — it is an unfinished branch, and the
right tool is a branch. **A dedicated flag platform is revisited only when
percentage rollouts or A/B testing become real requirements** (§22), and even
then the first question is whether the configuration service can carry it.

---

## 6. Request Flow

### 6.1 Why SvelteKit Proxies the API

The browser never calls the NestJS API directly. It calls SvelteKit server
routes, which forward to the API over the internal Docker network.

**The reason is token handling.** The session lives in an `httpOnly`, `Secure`,
`SameSite=Lax` cookie the browser's JavaScript cannot read, which removes the
entire class of token-theft-via-XSS problems. The SvelteKit server exchanges that
cookie for a bearer token when calling the API. As a side effect, everything is
same-origin, so there is no CORS configuration and no preflight round-trip.

**The cost** is one extra internal hop (sub-millisecond on the same host) and a
proxy layer to maintain. Against P6 this is justified by a present-tense problem:
the alternative is storing tokens in JavaScript-reachable storage, which is a
security decision that would be expensive to reverse after launch. The proxy
itself stays thin — it forwards, it does not transform.

**Exception:** the postback surface (§9) is called by provider servers and bypasses
`web` entirely, routed by Caddy straight to `api`.

### 6.2 Authenticated Request Pipeline

A user loading their balance, end to end:

```
 1. Browser ──► Caddy                    TLS, HTTP/2, routing
 2. Caddy ──► web                        SvelteKit server route
 3. web: read session cookie             httpOnly; get access token from session store
 4. web ──► api                          Internal HTTP + Bearer + X-Request-Id
 5. api: RequestContextMiddleware         Correlation id, AsyncLocalStorage, log open
 6. api: ThrottlerGuard                   Per-user / per-IP limits from ConfigurationService
 7. api: JwtAuthGuard                     Verify signature, expiry; load user; reject if suspended
 8. api: RolesGuard                       Enum check for admin routes
 9. api: ValidationPipe                   DTO validation; unknown properties rejected
10. api: Controller                       Thin — parse, delegate, return. No logic.
11. api: Service                          Business logic; may call other modules' services
12. api: PrismaService                    Own tables only; transaction if it mutates
13. api: ResponseInterceptor              Envelope shaping, serialization
14. api: ExceptionFilter (on error)       Map to error code + safe HTTP status
15. api ──► web ──► Browser               Response, correlation id logged on close
```

**Controllers stay thin** — validation via pipes, authorization via guards, logic
in services. A controller with an `if` about business state is a controller doing
a service's job, and it is the layer least covered by tests.

**Where authorization lives.** *Authentication* and *coarse role checks* are
guards. *Resource ownership* ("is this payout yours?") is checked inside the
service, because only the service knows the resource. A guard that loads domain
objects to authorize them has become a service with the wrong name.

---

## 7. Provider Adapter Architecture

The centerpiece of P1. Everything here exists to keep provider knowledge inside
provider folders.

### 7.1 The Adapter Contract

Each adapter implements four capabilities. Described in prose, since this
document contains no code:

| Capability | Input | Output | Notes |
|---|---|---|---|
| **Fetch offers** | Targeting context (country, device, optional user segment) | Normalized offer list | Called by the catalog sync job only |
| **Build click URL** | User reference, offer reference, signed `sub_id` | An absolute redirect URL | Pure function; no I/O |
| **Verify postback** | Raw HTTP request (query, body, headers, source IP) | Valid / invalid | Each provider's signing scheme differs; this is where that difference is contained |
| **Parse postback** | Raw HTTP request | Normalized conversion | Extracts `sub_id`, provider transaction id, payout amount, currency, status, and whether it is a reversal |

Plus static metadata: the provider's slug, its postback signing scheme, and its
published source IP ranges.

### 7.2 Rules Every Adapter Obeys

1. **Stateless.** No database access, no cache access, no queue access. An
   adapter is a translator between a provider's dialect and ours.
2. **No cross-module imports.** It may import `shared` and the provider contracts.
   Nothing else.
3. **Credentials are injected**, read from environment by the registry. An adapter
   never reads `process.env` itself — otherwise credential handling is duplicated
   per provider and audited nowhere.
4. **Errors are normalized** into a small set (`ProviderUnavailable`,
   `ProviderRateLimited`, `ProviderAuthFailed`, `ProviderResponseInvalid`) so
   callers can react without knowing which provider failed.
5. **Normalization is total.** An adapter never returns a partially normalized
   offer with provider-specific leftovers. If a field cannot be mapped, the offer
   is dropped and the drop is logged with a reason.
6. **Every adapter ships with fixtures** — real captured payloads (credentials
   scrubbed) — and contract tests that run against them in CI. Fixtures are how
   provider format drift gets caught before production does.

### 7.3 The Registry

`ProviderRegistry` is the only place that knows concrete adapters exist. At boot
it reads enabled providers from the `providers` table, resolves each slug to its
adapter class, injects credentials, and exposes lookup by slug plus enumeration
of enabled providers.

**A disabled provider is inert**: it is not synced, its offers are excluded from
the wall, and its postback endpoint returns a rejection. Disabling is
configuration (P3), so cutting off a misbehaving provider takes seconds and no
deploy — which matters at 2 a.m. when one is sending malformed postbacks.

**Registration is a map from slug to adapter class**, not filesystem scanning or
decorator-based auto-discovery. An explicit map is one line per provider, is
greppable, and fails at compile time when a slug has no adapter. Auto-discovery
would be cleverer and would fail at runtime, in production, on boot (P6).

### 7.4 Adding a Provider — The Checklist

This is the operational proof of P1. If any step touches core logic, the
abstraction has failed and gets fixed rather than worked around.

1. Create `modules/providers/adapters/<slug>/`.
2. Implement the four capabilities.
3. Capture real payloads into `fixtures/`.
4. Write contract tests against those fixtures.
5. Add one line to the registry map.
6. Add credentials to environment.
7. Insert a `providers` row and configure reward rate, revenue share, hold
   period, and postback source IPs from the admin panel.

**Target: under one day, zero changes outside those files** (PROJECT.md §9,
criterion 5).

### 7.5 Catalog Normalization, Deduplication, Ranking

Owned by `offers`, not by adapters — these are business rules operating on
already-normalized data.

- **Normalization** maps provider categories onto our own fixed set, converts
  provider payout currency to points using the provider's configured reward rate
  (P3), and rejects offers missing required fields.
- **Deduplication** groups offers by a fingerprint (normalized title + advertiser
  + target application identifier). Within a group, the offer paying the user
  most survives; the rest are hidden but retained, so if the winner's provider
  goes down the runner-up can be promoted without a re-sync.
- **Ranking** orders by user-visible reward, adjusted by an admin-settable
  per-provider weight and optional manual pinning. Ranking is deliberately simple
  and configuration-driven; personalized or ML ranking is an extension point
  (§18), not an MVP feature (P6).

---

## 8. Authentication Architecture

### 8.0 Scope: Email/Password Only

**Decision: the MVP supports email and password only. No OAuth providers, no
social login, no magic links.**

**Why email/password only.**

- **OAuth is not one integration, it is a per-provider integration.** Each of
  Google, Facebook, and Apple has its own console setup, review process,
  redirect and token quirks, and — in Apple's case — an ongoing paid developer
  account, which conflicts with P4.
- **It creates account-linking work immediately.** The moment a user registers
  with a password and later signs in with Google using the same email, the system
  must decide whether that is one account or two. Getting it wrong on a platform
  holding withdrawable balances means either merging two strangers' balances or
  stranding a user's earnings behind a login they cannot reach. Getting it right
  is real work that buys nothing the MVP needs.
- **The email/password path must be built regardless.** Admins are provisioned,
  not federated, and users need password recovery. OAuth would be an *additional*
  path, not a replacement — more surface, not less.
- **The MVP has no signup-conversion evidence to act on.** Social login is a
  conversion optimization. Optimizing conversion before there is a funnel to
  measure is exactly the speculative work P6 forbids.

**What this costs.** Slightly higher signup friction, and users manage another
password. Both are acceptable at MVP scale and both are measurable later — which
is the point: the decision to add OAuth should follow signup-funnel data, not
precede it.

**The seam that keeps it cheap to add.** Authentication produces our own session
independently of how identity was established. Adding a provider later means a
new verification path that resolves to a user record and then issues the same
tokens described in §8.1 — the token model, guards, refresh rotation, and every
downstream consumer are untouched. The one piece of real design work deferred
with it is the account-linking policy, and that is correctly deferred: it should
be decided with real duplicate-email data in hand.

**Recorded as an ADR** so the reasoning survives the first "why don't we have
Google login?" conversation.

### 8.1 Token Model

| Token | Form | Lifetime | Storage |
|---|---|---|---|
| Access | Signed JWT (HS256) | ~15 minutes | Held by the `web` server session; never in browser JS |
| Refresh | Opaque random string | ~30 days | Hashed at rest in `refresh_tokens`; sent to browser only inside the `httpOnly` session cookie |

**Why the refresh token is opaque and stored, while the access token is a JWT.**
The access token is short-lived and self-verifying, so no database round-trip is
needed on every request. The refresh token must be *revocable* — on logout,
password change, or account suspension — and a stateless JWT cannot be revoked.
Storing only its hash means a database leak does not yield usable tokens.

**Why HS256 and not RS256.** One service signs and one service verifies. Asymmetric
keys solve key distribution across trust boundaries, which we do not have. Revisit
when a third party must verify our tokens (P6).

### 8.2 Refresh Rotation and Reuse Detection

Every refresh issues a new refresh token and marks the old one used. If a token
that has already been used is presented again, **the entire token family for that
user is revoked** and the event is logged as a security incident.

**Why bother.** Reuse means one of two things: a stolen token being replayed, or a
race between browser tabs. Both are handled correctly by revoking and forcing a
re-login. The cost is an occasional forced login; the benefit is that a stolen
refresh token has a bounded useful life — and on a platform holding withdrawable
balances, account takeover is the attack that actually pays.

### 8.3 Credentials and Account Lifecycle

- **Passwords:** argon2id, per-password salt, parameters in environment so they
  can be raised as hardware improves.
- **Verification / reset tokens:** single-use, hashed at rest, short expiry;
  reset requests return the same response whether or not the email exists, to
  avoid account enumeration.
- **Login throttling:** per-account and per-IP, backed by Redis, thresholds
  configurable (P3).
- **Suspension:** checked in the auth guard on every request, not only at login.
  A suspended user's existing access token stops working within its remaining
  lifetime, not after 30 days.

### 8.4 The Admin Surface

Admins move money, so the admin surface is treated as a distinct trust zone
(§15), not as a role flag on the same door.

- **No self-registration.** Admin accounts are provisioned by a seed script or by
  an existing admin.
- Admin routes sit under a separate path prefix with their own guard, their own
  rate limits, and their own throttling thresholds.
- **Every admin action writes an audit entry** before the response is returned.
- **TOTP is supported by the architecture but optional for the MVP** — see below.

#### TOTP — Architecturally Supported, Not Required Before Launch

**Decision: the design accommodates TOTP; implementing it is not a prerequisite
for the first production release.**

What "architecturally supported" means concretely — these are the parts that must
exist from M1, because retrofitting them is what makes second factors expensive:

1. **Login is a two-step flow internally, even when only one step is used.**
   Credential verification and session issuance are separate operations, with the
   result of the first feeding the second. A second factor slots in between them
   without restructuring the login endpoint or its callers.
2. **The user record reserves the fields** a TOTP implementation needs (secret,
   enabled-at, recovery codes), unused until then. Adding nullable columns later
   is cheap; changing a login flow that three clients depend on is not.
3. **The admin guard resolves an authorization *level*, not a boolean role.**
   Requiring "admin, second factor satisfied" for sensitive routes later is a
   change inside the guard, not at every admin route.

**Why optional rather than mandatory (revising the previous draft).** The
asymmetry argument for TOTP is real — a phished admin password without a second
factor is a total loss of platform balances — but it argues for *the capability*,
not for blocking launch on it. Two things make deferral acceptable at MVP scale:
admin accounts are provisioned rather than self-registered, so the attack surface
is a known, tiny set of accounts; and payouts are manually reviewed and paid
externally, so a compromised admin session cannot move money without a human also
executing a bank transfer.

**Compensating controls while TOTP is absent** — these are not optional:

- A strong admin password policy, enforced at provisioning
- Aggressive login throttling on the admin path, stricter than the user path
- **An IP allowlist on admin routes**, which is a configuration value (P3) and
  minutes of work. With a small admin team this alone blocks credential-stuffing
  and most phishing follow-through
- Every admin action audited, and alerting on unusual admin activity

**The trigger to implement it:** the first additional admin account beyond the
founding operator, or the first automated payout provider (§11.4) — whichever
comes first. At that point a compromised session can move money without a human
in the loop, and the asymmetry argument stops being about capability and starts
being about exposure. **This trigger is recorded in §23 as an explicit decision
point, not left to memory.**

---

## 9. Reward Flow

### 9.1 The Service Boundary (P2)

`RewardAccountingService` is the sole owner of balance state. Its operations:
credit, debit, reverse, lock, release lock, settle lock, read balance, read
history. Nothing else in the system mutates a balance, and §4.4 enforces it with
a dedicated test.

### 9.2 Balance Shape

A balance is three buckets, never one number:

| Bucket | Meaning | Becomes |
|---|---|---|
| `pending` | Credited but inside the hold period | `available`, when the hold elapses |
| `available` | Withdrawable now | `locked`, on a withdrawal request |
| `locked` | Reserved by an in-flight payout | Consumed on settle, or returned to `available` on rejection |

**Why buckets and not a single number with derived views.** Every operation in
the system cares about a specific bucket — withdrawal locks only `available`,
chargebacks prefer `pending`, users see all three. Collapsing them to one number
means every caller re-derives the split, and one caller getting it wrong pays out
held money.

### 9.3 Reward Lifecycle

```
  conversion approved
          │
          ▼
   credit()  ──► pending      ── hold period elapses (maturation job) ──►  available
          │                                                                   │
          │ chargeback                                                        │ withdrawal
          ▼                                                                   ▼
      reverse()                                                            lock()
   (pending first, then available,                                            │
    then allow negative)                                            ┌─────────┴─────────┐
                                                                    ▼                   ▼
                                                              settle() [PAID]   releaseLock() [REJECTED]
                                                                    │                   │
                                                                consumed          back to available
```

### 9.4 Hold Period Resolution

Resolution order is **provider → global default**, read from
`ConfigurationService` at credit time (P3).

**The resolved value is stored on the reward transaction, not looked up later.**
This is what makes "changes apply to newly credited conversions only" (PROJECT.md
§4.7) structurally true rather than a rule someone has to remember: the maturation
job reads the stored maturity timestamp and never re-resolves configuration. An
admin changing a hold period cannot retroactively re-hold points a user has
already been told are available.

### 9.5 Concurrency Control

Every mutation runs inside a single database transaction that:

1. Locks the user's balance row (`SELECT ... FOR UPDATE`).
2. Validates the operation against current buckets.
3. Writes the `reward_transactions` row.
4. Updates the balance row.

**Pessimistic locking, not optimistic.** Contention on a single user's balance is
rare, so lock waits are negligible; but a lost update here is money, and
optimistic concurrency means handling a retry path correctly at every call site.
One `FOR UPDATE` in one service is simpler and harder to get wrong (P5, P6).
This is the mitigation for R4 in PROJECT.md — the acknowledged cost of choosing a
mutable balance model under P2.

**Chargebacks may drive a balance negative.** Reversal takes from `pending` first,
then `available`, and if both are exhausted the balance goes negative rather than
being clamped. A clamped balance is a silently lost debt.

### 9.6 Why the History Table Exists Even Though Balance Is Authoritative

Every mutation writes a `reward_transactions` row carrying amount, type, source
reference, actor, timestamp, reason, and the resolved hold period. Under the
simple balance model this table is not the source of truth — the balance row is.
It exists for three reasons: it is the user-facing statement, it is what
reconciliation (§13) checks the balance against, and it is exactly the input an
append-only ledger implementation would replay if P2's migration is ever
exercised. Recording it from day one is what keeps that option real rather than
theoretical (PROJECT.md R5).

---

## 10. Postback Flow

The highest-risk surface in the system. Treated as hostile input throughout.

### 10.1 Synchronous Phase — Fast and Dumb

The HTTP handler does the minimum required to safely acknowledge:

```
 1. Caddy routes /postback/:provider ──► api directly (bypasses web)
 2. Resolve provider by slug; reject if unknown or disabled
 3. IP allowlist check against configured provider ranges
 4. Adapter verifies signature
 5. Adapter parses into a normalized conversion
 6. INSERT raw payload into provider_postbacks
      ── unique (provider_id, external_transaction_id) ──
      ── on conflict: mark duplicate, return 200, stop here
 7. Enqueue a processing job carrying the postback row id
 8. Return 200
```

Target: single-digit milliseconds. **No business logic, no balance access, no
provider callbacks.**

**Why the idempotency guarantee is a database constraint and not a lookup.**
A check-then-insert is a race: two concurrent retries both check, both find
nothing, both insert. The unique index makes the second insert fail no matter how
the requests interleave. Idempotency enforced anywhere above the database is
idempotency that fails under exactly the retry storm it was built for.

**Why the raw payload is stored before processing.** If processing has a bug, the
evidence still exists and the job can be replayed after the fix. A postback that
was rejected in memory is a conversion the user completed and can never be paid
for.

### 10.2 Response Codes — Chosen Around Provider Retry Behavior

| Situation | Status | Why |
|---|---|---|
| Accepted | 200 | Normal |
| Duplicate | **200** | It was already processed. A 4xx would make some providers retry or open a support ticket |
| Unmatched `sub_id` | **200** | Accepted into quarantine. Retrying will not make an unknown click known; a human resolves it |
| Bad signature / IP not allowed | 401 / 403 | Genuinely rejected, and it must be visible in provider dashboards |
| Malformed payload | 400 | Retrying identical malformed input is pointless |
| Our failure (DB down) | 500 | The **only** case where we want a retry |

**The governing principle:** return 5xx only when a retry could plausibly succeed.
Every other 5xx manufactures duplicates we then have to deduplicate.

### 10.3 Asynchronous Phase — Slow and Careful

The worker processes each postback:

```
 1. Load the raw postback row; skip if already processed (job-level idempotency)
 2. Resolve sub_id ──► click
      └─ not found, or outside the attribution window ──► QUARANTINED, stop
 3. Load user; if banned ──► FLAGGED for review, no credit
 4. Assemble the fraud evaluation context; call FraudService
 5. Convert provider payout to points using the provider's configured rate (P3)
 6. In one database transaction:
      · create the conversion row
      · call RewardAccountingService.credit()  ──► lands in `pending`
      · mark the postback processed
 7. If the fraud action was HOLD, flag the conversion for review — it stays in
    `pending` past its maturity date until an admin clears it
 8. Emit a notification event (best-effort; failure never fails the job)
```

Reversals follow the same path but call `reverse()` and reference the original
conversion. A reversal for a conversion we never saw is quarantined, not ignored.

**Why fraud scoring happens before crediting but does not block it.** Points are
credited and held rather than refused. A false positive that refuses a legitimate
conversion produces an angry user and a support ticket with no recoverable
record; a false positive that holds one produces a delay an admin can clear. Both
are wrong, but only one is recoverable (PROJECT.md §4.7).

**Why steps 5 and 6 are ordered this way.** Rate conversion reads configuration
*before* the transaction opens, so a slow configuration read never extends the
window during which the balance row is locked.

---

## 11. Withdrawal Flow

### 11.1 State Machine

```
   [user submits]
         │
         ▼
   PENDING_REVIEW ──────► REJECTED      (release lock, points return to available)
         │
         │ admin approves
         ▼
      APPROVED ──────────► FAILED       (release lock — external payment failed)
         │
         │ admin records external reference
         ▼
        PAID              (settle lock — points consumed)
```

Transitions are explicit and total: every state names its permitted next states,
and anything else is rejected. `PAID` and `REJECTED` are terminal.

### 11.2 Submission

1. Validate the requested amount against configured minimum, maximum, per-method
   limits, and the daily request cap (all P3).
2. Validate the payment destination for the chosen method.
3. Call `RewardAccountingService.lock()` — **only `available` points are
   lockable**; `pending` and already-`locked` points are not.
4. Create the payout request in `PENDING_REVIEW` inside the same transaction as
   the lock.

**Why locking at submission rather than at approval.** Between submission and
review there is a queue an admin works through by hand. Without a lock, a user
can submit, spend the same points elsewhere, and have both succeed. Locking makes
double-spending impossible without requiring the admin to be fast.

### 11.3 Review and Settlement

The admin sees the account's fraud score, conversion history, chargeback rate,
account age, and any shared-device or shared-IP signals alongside the request.

- **Approve** → `APPROVED`. The admin then pays externally and records the
  reference, moving it to `PAID` and settling the lock.
- **Reject** → `REJECTED` with a mandatory reason; the lock is released.
- **Failed external payment** → `FAILED`; the lock is released and the user is
  notified.

Approval and settlement are **two steps, not one**, because the external payment
happens between them. Collapsing them would mean marking money paid before it
was, and a crash in between would leave the system claiming a payment nobody sent.

### 11.4 The Payout Provider Seam (P1)

Payout execution sits behind a `PayoutProvider` interface with exactly one MVP
implementation: `ManualPayoutProvider`, whose "execution" is recording what a
human did. One interface, one implementation, no factory (P6). Its present-tense
justification is that without it, automating payouts later means editing the
state machine — the part that is hardest to change safely once real money has
flowed through it.

---

## 12. Background Jobs

### 12.1 The Job Inventory

| Job | Trigger | Queue | On failure |
|---|---|---|---|
| `catalog-sync` | Cron, per provider, interval configurable | `catalog` | Retry with backoff; keep serving cached catalog; mark provider degraded after N failures |
| `postback-process` | Event, on postback receipt | `postbacks` | Retry ×5 exponential; then dead-letter for admin review |
| `reward-maturation` | Cron, hourly | `rewards` | Retry; alert if it fails twice consecutively |
| `reconciliation` | Cron, nightly | `maintenance` | Alert immediately — this job failing hides the drift it exists to detect |
| `provider-health-check` | Cron, every few minutes | `maintenance` | Log only |
| `send-email` | Event | `notifications` | Retry ×3; log and drop — never fails its parent operation |
| `cleanup-expired` | Cron, daily | `maintenance` | Retry next run |

### 12.2 Rules Every Job Obeys

1. **Idempotent.** Every job may run twice — a retry after a timeout that
   actually succeeded is normal. Jobs check their own completion state first.
2. **Bounded.** Batch jobs process a page at a time and re-enqueue. An unbounded
   job over a growing table works in month one and takes the worker down in
   month six.
3. **Own transaction per unit of work**, not one transaction per batch. A batch
   transaction holds locks for its whole duration and loses all progress on any
   single failure.
4. **Logged with a correlation id**, same as HTTP requests, so a conversion can
   be traced from postback through processing to maturation in one query.
5. **Failure is visible.** A silently failing scheduled job is the classic way for
   maturation to stop and nobody to notice until users complain their points
   never became withdrawable.

### 12.3 Scheduling

Cron schedules are BullMQ **repeatable jobs**, not in-process timers.

**Why.** In-process timers fire once per process, so running two `worker`
replicas would run every scheduled job twice — including maturation and
reconciliation. Repeatable jobs are registered in Redis and dispatched once
regardless of replica count. This is not premature scaling: it is avoiding a
correctness bug that appears the first time a second worker starts (P5).

---

## 13. Queue Architecture

### 13.1 Queues

Five queues, separated by failure characteristics rather than by domain:

| Queue | Concurrency | Why it is separate |
|---|---|---|
| `postbacks` | High | Latency-sensitive and highest volume. Never blocked by anything else |
| `catalog` | Low (1–2 per provider) | Long-running, provider-rate-limited outbound HTTP |
| `rewards` | Low | Touches balances; contention benefits from serialization |
| `maintenance` | 1 | Nightly heavy jobs. Serialized deliberately |
| `notifications` | Medium | Best-effort; failures must never propagate |

**Why not one queue.** A single queue means a burst of catalog syncs starves
postback processing — conversions stop being credited because the offer catalog
is refreshing. Separation by failure characteristic is the smallest split that
prevents this; splitting further per domain would add queues nobody monitors (P6).

### 13.2 Job Contracts and Retries

- **Job payloads carry identifiers, never entity snapshots.** A job holding a copy
  of a conversion will act on stale data when it retries five minutes later.
- **Explicit `jobId`** derived from the work's natural key, so enqueueing the same
  work twice is a no-op rather than a duplicate.
- **Retries:** exponential backoff, capped. Non-retryable failures (bad data,
  missing entity) fail immediately without burning retries.
- **Dead-letter handling:** BullMQ's failed set *is* the dead-letter queue,
  surfaced in the admin panel with a retry action. Failures nobody can see are
  failures nobody fixes.
- **No unbounded job data.** Payloads are small; anything large is written to the
  database and referenced by id.

---

## 14. Caching Strategy

### 14.1 What Is Cached

| Data | Store | TTL | Invalidation |
|---|---|---|---|
| Provider offer catalog | Redis | Per-provider, configurable | Overwritten by each sync |
| Assembled offer wall (per geo + device) | Redis | Short (minutes) | TTL only |
| Business configuration | In-process, per replica | Until invalidated | Redis pub/sub on write |
| Geo-IP lookups | Redis | Long (days) | TTL only |
| Rate-limit counters | Redis | Window length | Automatic |
| Fraud velocity counters | Redis | Window length | Automatic |

### 14.2 What Is Never Cached

**Reward balances. Payout states. Authorization decisions beyond token lifetime.
Anything a user could act on financially.**

A stale balance shown to a user is a support ticket; a stale balance used in a
withdrawal check is a payout of money that was already spent. Balance reads go to
the database, every time. If balance reads ever become a measured bottleneck, the
fix is a database index or a read replica — not a cache with an invalidation
problem in front of money (P5).

### 14.3 Configuration Caching

Configuration is read on nearly every business operation, so a database round-trip
per read is genuinely wasteful. It is cached **in-process** per replica and
invalidated by a Redis pub/sub message published on every write, so an admin's
change propagates to all replicas within milliseconds.

**Why in-process rather than in Redis.** Configuration is small, read constantly,
and written rarely — the ideal in-memory cache. Putting it in Redis would replace
a database round-trip with a Redis round-trip and solve nothing. The pub/sub
channel is what makes the local copy safe with multiple replicas.

### 14.4 Conventions

- **Key format:** `ow:<schema-version>:<domain>:<identifier>`. The schema version
  makes a breaking cache-shape change a one-character deploy rather than a
  flush-and-hope.
- **Cache failures degrade, never fail.** A Redis outage means slower responses
  from the database, not errors — except for rate limiting, which fails *closed*
  (§15.4).
- **Cached values are typed on read**, not trusted. A stale shape from a previous
  deploy is treated as a miss.

---

## 15. Error Handling Strategy

### 15.1 Taxonomy

Three families. Everything thrown in the codebase belongs to one:

| Family | Meaning | HTTP | Retryable | Logged at |
|---|---|---|---|---|
| **ValidationError** | Caller sent something invalid | 400 / 422 | No | `debug` |
| **DomainError** | Valid request, rules forbid it (insufficient balance, invalid transition, limit exceeded) | 409 / 403 / 422 | No | `info` |
| **InfrastructureError** | Something we depend on failed | 500 / 503 | Usually | `error` |

**Why DomainError is distinguished from ValidationError.** They map to different
HTTP semantics, different log levels, and different user messaging. Collapsing
them means either logging expected business outcomes as errors — which trains
everyone to ignore the error log — or returning 400 for "insufficient balance",
which tells the client to fix its request when there is nothing to fix.

### 15.2 Error Codes

Every error carries a **stable string code** (`REWARD_INSUFFICIENT_BALANCE`,
`PAYOUT_INVALID_TRANSITION`, `PROVIDER_UNAVAILABLE`) declared in
`packages/contracts`. Codes are part of the API contract; HTTP statuses and
messages are not. The frontend switches on codes, so message wording and
localization change freely without breaking clients.

### 15.3 Response Shape

Errors return the code, a safe human-readable message, the correlation id, and —
for validation errors only — per-field details. **Never** a stack trace, an
internal identifier, a SQL fragment, or a provider's raw response. The full
detail goes to the log, joined to the response by correlation id.

### 15.4 Boundary-Specific Rules

- **Postback endpoint:** §10.2 governs. Status codes are chosen for provider retry
  behavior, not for REST purity.
- **Provider calls:** every outbound call has a timeout. Failures are normalized
  by the adapter (§7.2) and never propagate a provider's shape into our logic. A
  provider failing during catalog sync degrades that provider; it never fails the
  wall.
- **Jobs:** failures are classified retryable or not, explicitly, at the throw
  site. Retrying a non-retryable failure five times just delays the alert.
- **Rate limiting fails closed.** If Redis is unavailable, requests are rejected
  rather than allowed unlimited. Every other cache dependency degrades open; this
  one is a control, and an unavailable control is not a reason to stop
  controlling.

### 15.5 Global Handling

A single Nest exception filter maps the taxonomy to responses. Unrecognized
exceptions become 500 with a generic message and are logged at `error` with the
full stack and correlation id, then reported to GlitchTip. There is exactly one
place where an unexpected exception becomes an HTTP response.

---

## 16. Logging Strategy

### 16.1 Structure

Structured JSON via pino to stdout, collected by Docker. Every log line carries:
timestamp, level, correlation id, user id (when authenticated), module, event
name, and duration for completed operations.

**Why stdout and not files.** The container runtime handles collection and
rotation. Writing files inside a container means managing rotation, disk, and
permissions to solve a problem the platform already solved (P4, P6).

**Rotation is configured, not assumed.** Docker's default `json-file` driver has
no size limit, so "the runtime handles rotation" is only true once something
says so. `docker-compose.prod.yml` sets it on every service through one anchor:

| Setting | Value |
|---|---|
| `driver` | `json-file` |
| `max-size` | `10m` |
| `max-file` | `3` |

That caps each service at 30 MB and the whole stack under ~270 MB, on a VPS
where every container shares one disk with Postgres — and Postgres stops
accepting writes when that disk fills. The API logs a line per request, so
without a limit the log grows fastest exactly when the site is busiest.

**It is a disk guarantee, not a retention guarantee.** Rotation is by size, so
the window is however long 30 MB takes to produce: hours under load, months
when idle. Keeping lines longer means shipping them off this host, which is a
service this MVP does not have — the same shape as the backup gap in §20.3.

Applied to every service without exception, including `migrate`, which exits.
A limit that only covers the services somebody judged noisy is one careless
addition away from being the one that fills the disk, so `check-prod-images.sh`
asserts it for every service in the rendered file rather than for a list.

### 16.2 Correlation

One correlation id per request or job, generated at the edge, propagated through
`AsyncLocalStorage`, included on every line, and returned in the response header.
**Jobs inherit the correlation id of the request that enqueued them**, so a
postback can be traced from HTTP receipt through worker processing to reward
credit with a single query. This is the difference between a five-minute
investigation and an afternoon of guessing.

### 16.3 Levels

| Level | Used for |
|---|---|
| `error` | Unexpected failures needing human attention. Every one is actionable |
| `warn` | Degraded but handled: provider unavailable, cache miss storm, fraud hold |
| `info` | Business events: conversion credited, payout approved, configuration changed |
| `debug` | Development detail; off in production |

**`error` is reserved for the actionable.** A log level that fires on expected
outcomes gets muted, and once muted it is worthless for the outcomes it was meant
to catch.

### 16.4 Redaction

Never logged, in any form: passwords, tokens (access, refresh, verification,
reset), provider API credentials, TOTP secrets, full payment destination details.
Redaction is configured in pino at startup as a deny-list of paths, so it applies
even when a future developer logs a whole object without thinking.

**Logged deliberately:** IP addresses and device fingerprints. They are fraud
signals and operationally necessary. They are classified as personal data, given
a retention limit, and covered by the privacy policy.

### 16.5 Application Logs vs. the Audit Trail

**Distinct systems, deliberately.** Logs are operational, high-volume, and expire.
The audit trail (`admin_audit_log`, `configuration_history`, plus
`reward_transactions` as its financial equivalent) lives in the database, is
immutable, is queryable from the admin panel, and does not expire.

**Why not just search the logs.** Logs rotate, and "who approved this payout and
why" is a question that gets asked months later, often about a dispute. Anything
that must be answerable then belongs in a table, not in a log stream.

---

## 17. Observability

Deliberately lightweight. The MVP needs to answer three questions — *is it up?*,
*what happened to this specific conversion?*, and *did something break?* — and
nothing more. A metrics stack that answers questions nobody is asking is
infrastructure to run, back up, and ignore (P4, P6).

### 17.1 What Ships in the MVP

| Pillar | Status | Implementation |
|---|---|---|
| **Structured logging** | **In MVP** | pino JSON to stdout, correlation ids — §16 |
| **Health endpoints** | **In MVP** | `/health`, `/health/ready` — §17.2 |
| **Uptime monitoring** | **Not built** | Intended: something outside the box polling `/health`. Nothing does today — see below |
| **Business alerts** | **Not built** | The conditions are listed in §17.3 and are logged at `error`; nothing delivers them (D71) |
| **Metrics** | **Future** | §17.4 — the seam is described, nothing is built |
| **Error reporting** | **Future** | §17.5 — GlitchTip, one container when wanted |
| **Distributed tracing** | **Not planned** | One API process and one worker. Correlation ids already answer what tracing would |

**Why logs plus health checks are enough at this stage.** With a single API
process, structured logs with correlation ids answer nearly every operational
question that matters, and they answer them *specifically* — for one conversion,
one user, one postback. Metrics answer aggregate questions ("what is p99 latency
across all endpoints?") that only become actionable once there is enough traffic
for an aggregate to mean something, and once someone is available to look at a
dashboard. Neither is true in week 6.

### 17.2 Health Endpoints

Two endpoints on `api`, deliberately distinct:

| Endpoint | Answers | Checks | Consumed by |
|---|---|---|---|
| `/health` | *Is the process alive?* | Nothing external. Returns immediately | Docker health check, uptime monitor |
| `/health/ready` | *Can it serve traffic?* | Postgres reachable, Redis reachable | Deploy gate (§20.2), load balancer |

**The worker has no HTTP surface and therefore neither endpoint.** Giving it a
port to answer on would make it a second web-facing process to secure, for one
boolean. Its liveness is a heartbeat instead: it writes a key to Redis every
fifteen seconds with a sixty-second TTL, and `worker-health.js` — run by the
container runtime, building no Nest context — exits non-zero once that key has
expired. Writing the key proves both that the event loop is turning and that
Redis is reachable from that process, which is the failure that matters: a
worker that is "running" but no longer consuming credits nobody and says
nothing.

**`web` is checked by fetching a page it can render alone.** The container
requests `GET /login` on the loopback and requires a 200. That route has no
server `load` — only a form action — so the request runs the hook, the layout
and the render without calling the API: a check that fetched a page loading from
the API would restart a healthy `web` every time the API hiccuped, which is the
readiness/liveness confusion described below. A static asset would not do
either, because `adapter-node` serves those before the request reaches
SvelteKit, so one would still return 200 from a server whose SSR handler was
wedged. No new endpoint and no new port: it is an existing page on the port the
container already listens on.

**A health check with no consumer is decoration.** Docker's `restart` policy
reacts to a process exiting, never to a health check failing, so an `unhealthy`
container stays up forever on its own. The `autoheal` container (§20.1) is what
closes that loop: it polls for containers that are both labelled
`gemone.autoheal` and unhealthy, and restarts those. Alerting is not built; the
restart is.

**Where autoheal gets that access.** Not from the Docker socket: the socket is
held by `socket-proxy`, which publishes a unix socket carrying exactly the two
requests autoheal makes — list the unhealthy labelled containers, restart one
by id — and denying everything else, including the container-creation call that
turns Docker API access into host root. There is no port; the socket travels in
a volume. T71 records what that protects and what it does not.

**Why they are separate.** A liveness check that touches the database restarts a
healthy process whenever the database hiccups — turning a brief dependency blip
into a restart loop that makes the outage worse. Liveness answers "should this
process be killed"; readiness answers "should traffic be sent here". Conflating
them is one of the most common self-inflicted outages in containerized systems.

**Health endpoints never leak detail.** They return status only — no version, no
dependency names, no error text. They are on a public port; the diagnostic detail
belongs in logs.

**The worker's readiness includes its queue connection**, because a worker that
cannot reach Redis is silently processing nothing — the failure mode described in
§12.2, rule 5.

### 17.3 Alerts

An alert nobody acts on is noise that trains everyone to ignore the channel. The
MVP alerts on a short list, each of which has a defined response in the runbook:

| Alert | Why it is worth waking someone |
|---|---|
| Reconciliation reports drift | Balances and history disagree — a money bug in progress (PROJECT.md R4/R5) |
| Reconciliation job failed | The detector for the above is itself down |
| Postbacks dead-lettered | Conversions completed and not credited |
| Provider marked degraded | Offers stale, or postbacks not arriving |
| Error rate spike | Something broke |
| Health check failing | It is down |
| Disk above threshold | Postgres stops writing when the disk fills |

Delivery is email or a chat webhook. No paging platform (P4).

### 17.4 Metrics — Future, With the Seam Named

**Not built now.** When metrics are wanted, the intended path is Prometheus
scraping a `/metrics` endpoint, with Grafana for dashboards — both free and
self-hostable (P4), two more containers on the same host.

**What exists today that makes this an addition rather than a redesign:** every
business event is already an explicit, named log event at a single code location
(§16.3). Emitting a counter or histogram alongside those events is a line at each
site, not a hunt for where things happen. The events that will matter first are
already the ones logged at `info`: conversions credited, postbacks received and
by outcome, payouts by state transition, provider sync duration and failures,
queue depth and job duration.

**The trigger:** when a question about aggregate behavior over time cannot be
answered from logs in a reasonable amount of time. Not before.

### 17.5 Error Reporting — Future, One Container

**Not built for the first release.** The global exception filter (§15.5) is
already the single place where an unexpected exception is handled, so error
reporting is one call at one location.

**Intended implementation:** self-hosted **GlitchTip**, which speaks the Sentry
protocol, so the standard Sentry SDK works against it and moving to hosted Sentry
later — or away from it — is a DSN change (P4).

**Until then**, unexpected exceptions are logged at `error` with full stack and
correlation id, and the error-rate alert in §17.3 covers the "did something
break" question. What is missing without it is grouping and deduplication — which
matters once error volume exceeds what one person can read.

**The trigger:** the first time an error is noticed by a user before it is
noticed in the logs.

---

## 18. Testing Strategy

### 18.1 Philosophy

**Tests exist to make change safe, not to produce a coverage number.** A test that
must be edited every time an implementation detail changes is a tax on
refactoring, and P6 makes refactorability an explicit goal — so tests that fight
it are actively harmful.

Three rules govern what gets tested:

1. **Test behavior at module boundaries, not internals.** A module's exported
   service is the contract; its private helpers are not. Tests written against
   `internal/` freeze decisions that should stay cheap to reverse.
2. **Test proportionally to what failure costs.** Money paths get exhaustive
   testing; a settings screen gets a smoke test. Uniform coverage targets spend
   the most effort where it matters least, because trivial code is easiest to
   test.
3. **Every production bug gets a failing test before it gets a fix.** This is how
   the suite grows in the places that actually break, rather than the places that
   were easy to test.

**No coverage percentage target.** A number invites tests written to raise the
number — asserting that getters return what was set. What is required instead is
that the areas listed in §18.5 are covered, and that requirement is checked in
review, by a human, against a short list.

### 18.2 Unit Tests

**Scope:** one service or one pure function, with its collaborators substituted.
No database, no Redis, no network. Milliseconds each.

**What genuinely needs unit tests:**

| Target | Why |
|---|---|
| **Fraud rule engine** | Pure logic over an input object (§4.2). Every rule and threshold combination is cheap to test here and expensive to test anywhere else |
| **Reward calculations** | Provider payout → points conversion, rounding, currency handling. Rounding bugs are money bugs |
| **Hold period resolution** | The `provider → global` chain, including the "already-credited points keep their original terms" rule (§9.4) |
| **Payout state machine** | Every permitted transition, and — more importantly — every forbidden one |
| **Adapter normalization** | Provider payload → normalized shape, against fixtures (§7.2). This is the contract test that catches provider format drift |
| **Value objects** | `Balance` bucket arithmetic, `Money` rounding |
| **`sub_id` signing** | Sign/verify round-trip, tamper rejection |

**What should not get unit tests:** controllers (they delegate — an integration
test covers them properly), DTO validation decorators (that is testing
class-validator), Prisma queries with a mocked Prisma client (this asserts the
mock's behavior, not the database's, and passes while the real query is wrong),
and anything whose test would be a restatement of its implementation.

**Mocking rule:** mock what you own the interface to — `RewardAccountingService`,
`ProviderRegistry`, `ConfigurationService`. Do not mock Prisma or Redis; if a
test needs them, it is an integration test and should be honest about it.

### 18.3 Integration Tests

**Scope:** a real Postgres and a real Redis, in containers, with the module wired
as it runs in production. HTTP in, database state out.

**Why these carry the most weight in this system.** The parts most likely to be
wrong are the parts where code meets the database: transaction boundaries, row
locking, unique constraints, and idempotency. None of those can be tested with a
mock, because the mock cannot violate a constraint, cannot deadlock, and cannot
lose an update. **This is the tier that would actually have caught every
money-losing bug this architecture worries about.**

**What must have integration tests:**

| Area | Specifically |
|---|---|
| **Postback idempotency** | Concurrent identical postbacks credit exactly once — the unique constraint doing its job under a real race (§10.1) |
| **Reward mutations under concurrency** | Parallel credits, locks, and reversals against one balance. Asserts no lost updates through `FOR UPDATE` (§9.5) |
| **Full withdrawal lifecycle** | Submit → lock → approve → settle, and submit → lock → reject → release, verifying balance buckets at each step |
| **Chargeback ordering** | Reversal takes from `pending` first, then `available`, then goes negative (§9.5) |
| **Maturation** | `pending` → `available` at the right time, and *not* before |
| **Reconciliation** | Detects deliberately injected drift. **A reconciliation job that has never been shown to fail is not known to work** |
| **Auth flows** | Refresh rotation, reuse detection revoking a token family, suspension taking effect on the next request |
| **Configuration** | A write propagates to a reader, and history is recorded |
| **Module boundaries** | The architecture tests from §4.4 run in this tier |

**Database strategy:** a real Postgres container, migrations applied once, each
test in a transaction that rolls back. Fast, isolated, and it exercises the same
schema and constraints as production. No in-memory substitute — SQLite would not
share Postgres's locking or constraint semantics, which is precisely what these
tests exist to verify.

**Provider calls are never real.** `MockProvider` and recorded fixtures stand in.
Tests must not depend on a third party's uptime, rate limits, or sandbox data.

### 18.4 End-to-End Tests

**Scope:** a browser driving the deployed stack. **Playwright** — free,
open-source, and it runs headless in CI (P4).

**Deliberately few.** E2E tests are the slowest to run, the most brittle, and the
most expensive to diagnose when they fail. Their value is confirming the pieces
are wired together, and a handful of paths proves that as well as fifty do.

**The MVP's complete E2E list:**

1. Register → verify email → log in → land on the offer wall
2. Browse the wall, filter, click an offer, and land on the redirect (the outbound
   URL is stubbed at the network layer)
3. Simulated conversion → points appear as `pending` → after maturation, they
   appear as `available`
4. Request a withdrawal → it appears in the admin queue → admin approves and
   records a reference → the user sees `PAID`
5. Admin changes a configuration value → the new value is in force without a
   restart

That is the list. **Path 4 is the one that must never be allowed to break** — it
is the whole product in one test.

**What is deliberately not E2E-tested:** error states, validation messages, edge
cases, and anything with a cheaper test at a lower tier. Pushing coverage into
E2E is how a suite becomes slow enough that people stop running it.

### 18.5 What "Enough" Means

The suite is sufficient when it can honestly assert:

- A duplicate postback cannot double-credit, proven under real concurrency
- A user cannot withdraw more than their `available` balance, by any interleaving
- A rejected payout returns exactly the points it locked
- A chargeback is representable even when it drives the balance negative
- Reconciliation detects drift that was deliberately introduced
- Adding a provider requires no change to any existing test outside its own folder

**The last one is the interesting one.** If adding a provider forces edits to
existing tests, the tests have encoded provider knowledge in the core — which
means the core has it too, and P1 has been violated somewhere the lint rules did
not catch.

### 18.6 CI

Every pull request runs, in order, failing fast: lint and boundary rules (§4.4) →
typecheck → unit tests → integration tests against real containers → build. E2E
runs on merge to main, not per-PR, because its runtime does not justify the
per-commit signal.

**Nothing merges on a red pipeline**, including for "obviously safe" changes. The
exception that gets made once becomes the norm, and the pipeline stops meaning
anything.

---

## 19. Security Boundaries

### 19.1 Trust Zones

```
 ZONE 0 — Public internet ....................... trusted with nothing
     │
     ▼
 ZONE 1 — Caddy ................................. TLS, headers, routing
     │
     ├──► ZONE 2a — web (SvelteKit) ............. holds session cookies; no DB access
     │        │
     │        ▼
     ├──► ZONE 2b — api ......................... authenticates, authorizes, validates
     │        │                                   the only zone that reaches state
     │        ▼
     │    ZONE 3 — postgres / redis ............. no public ports; internal network only
     │
     └──► ZONE 2c — postback endpoints .......... public, unauthenticated by design,
                                                  protected by IP allowlist + signature
```

**`web` never touches the database.** If the SvelteKit process is compromised, the
attacker gets a proxy that can make authenticated API calls as sessions it holds
— bad, but bounded by the API's own authorization. Giving `web` database access
would make the same compromise total.

### 19.2 The Postback Surface

Unauthenticated by necessity — providers cannot hold our credentials. Defended in
depth, per §10.1: IP allowlist, then signature verification, then strict parsing,
then a database-enforced idempotency constraint. Each layer assumes the previous
one failed.

`sub_id` is **signed and opaque**. It never contains a raw user id, so it cannot
be enumerated or forged into a credit for an arbitrary account.

### 19.3 Input and Output

- Every endpoint validates a DTO; unknown properties are rejected, not ignored.
- Prisma is parameterized throughout; raw SQL (used only in reconciliation
  aggregates) is parameterized explicitly.
- Responses are shaped by explicit serializers. Entities are never returned
  directly — that is how password hashes and internal flags leak.
- Redirect targets are built by adapters from configuration, never from
  user-supplied URLs.

### 19.4 Secrets

Environment variables, injected from a file readable only by the deploy user,
never committed. Rotatable without code changes. Provider credentials are read
once by the registry at boot and never logged (§16.4).

### 19.5 Rate Limiting

Three layers, deliberately overlapping: coarse per-IP at Caddy, per-user and
per-endpoint at the API (limits configurable, P3), and per-user click limits as a
fraud control in the `clicks` module.

**Why three.** They defend different things: Caddy against volumetric abuse, the
API against a single authenticated account hammering an endpoint, and the click
limit against economically damaging behavior that is well within normal HTTP
rates. One layer cannot serve all three purposes.

**What is built.** The API layer and the click limits. At the API there are two
distinct controls, and the distinction is the point:

| Control | Counts | Keyed by | Released on success |
|---|---|---|---|
| `LoginThrottleService` (§8.3) | failed authentications | account **and** address | yes — a correct password ends the guessing |
| `PublicThrottleService` | requests | address **and** endpoint | no — successful use is what the abuse looks like |

The second covers `register`, `verify-email`, `forgot-password` and
`reset-password`, which were unauthenticated and unbounded. It is
keyed on the caller's address and **never on an account**: `forgot-password`
answers 204 for every address precisely so a registered one and an unregistered
one are indistinguishable, and a per-account counter would fill up only for
addresses that exist — an enumeration oracle wearing a rate limit's clothes.

Both fail closed (§15.4), and both are configurable (P3).

`refresh` is covered by neither, on purpose: only `web` calls it (§6.1), so
every request carries the same address and a per-IP ceiling would bound the
platform rather than an abuser. Its credential is a 256-bit opaque token
checked against the database and rotated on every use (§8.2).

**Every per-IP control depends on one chain, and it has one trusted link.**

```
 browser ──► caddy ──────────────────────────► api      (/postback/*, /health*)
                │  sets X-Forwarded-For = the address it observed
                └─► web ──────────────────────► api      (everything else)
                       forwards that same address, unchanged
```

Caddy is the only participant that *knows* the client: it holds the connection.
It therefore **replaces** `X-Forwarded-For` with `{remote_host}` rather than
appending to it, and deletes `X-Real-IP` and `Forwarded` outright — a caller's
own values never travel further than the boundary, so no reader behind it has
to reason about how many entries were prepended by whom.

`web` reaches the API over the internal network, so unless it forwards that
address the API attributes every proxied request to the `web` container and each
per-IP counter becomes one global counter. It takes the value from
`getClientAddress()` — the adapter's resolution of the header Caddy set — and
never from a header it reads itself. `apiAuthed` takes the request context
rather than just its cookies, so the session and the address cannot be
separated.

The API trusts exactly one hop (`TRUST_PROXY_HOPS=1`) and both routes present
exactly one, which is what lets a single setting be correct for a request that
came through `web` and one that came straight from Caddy.

**What breaks when this is wrong** is worth stating, because it is not a rate
limit becoming slightly loose: the whole platform collapses into one address.
`clicks.max_per_ip_per_hour` becomes a global ceiling, and
`fraud.rules.shared_ip_accounts` — eight accounts on one address, `HOLD` — holds
every conversion in the system once the ninth account converts.

**Caddy's layer is not built.** Caddy has no rate limiting of its own without a
plugin, and the Caddyfile carries none today. The API layer bounds the endpoints
that spend money or create rows; volumetric abuse in front of it is still
unhandled.

---

## 20. Deployment Overview

### 20.1 Topology

One VPS. Docker Compose. Eleven containers: `caddy`, `web`, `api`, `worker`,
`postgres`, `redis`, a one-shot `migrate`, a nightly `backup` with the
`backup-remote` that ships its dumps off the host (§20.3), and two
that exist only to keep the others running: `autoheal`, which restarts the
containers whose health checks fail because nothing else in Compose does
(§17.2), and `socket-proxy`, which is the only container holding the Docker
socket and allows autoheal exactly the two calls it needs (T71).

**Why not Kubernetes, not managed services, not multi-region.** The MVP serves
low traffic with one developer. Managed Postgres alone would exceed the entire
VPS budget, and Kubernetes would add an orchestration layer whose problems are
larger than the ones it solves at this size (P4, P6). Everything here is standard
Docker, so moving to managed infrastructure later is a compose-file change, not a
rewrite.

### 20.2 Deploy Sequence

```
 1. CI builds and tags images on merge to main
 2. Pull images on the host
 3. Run `migrate` to completion  ── on failure, stop; nothing else changed
 4. Recreate `api`, `worker`, `web`
 5. Health checks must pass
 6. On failure: re-deploy the previous tag
```

**Migrations run as a separate one-shot container, not on API startup.** With
multiple replicas, startup migrations race each other. A one-shot container runs
exactly once, and its failure blocks the deploy instead of leaving half the fleet
on a new schema. Migrations must be **backward-compatible with the currently
running version** — expand first, contract in a later deploy — so a rollback does
not require a schema rollback.

#### The images

CI publishes three on every merge to `main`, all tagged with the commit SHA:

| Image | Built from | Used by |
|---|---|---|
| `api` | `docker/api.Dockerfile`, `runtime` | `api` **and** `worker` — one image, two commands (§1.2) |
| `migrate` | `docker/api.Dockerfile`, `migrate` | the one-shot `migrate` service |
| `web` | `docker/web.Dockerfile`, `runtime` | `web` |

`migrate` is a second image from the same Dockerfile because the Prisma CLI is a
dev dependency and the runtime image installs with `--prod`. Building it from
the same source at the same commit is what makes "the migrations that ship with
this deploy" a fact rather than a convention.

**No `latest`, no branch tags.** A tag whose contents change is not something
you can roll back to.

#### Deploying a SHA

Two variables, in the host's env file or on the command line:

```sh
export GEMONE_IMAGE_REPOSITORY=ghcr.io/<owner>/<repo>
export GEMONE_IMAGE_TAG=<the commit SHA>

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

`up` runs `migrate` to completion first and starts nothing else if it fails
(`service_completed_successfully`), which is steps 3 and 4 of the sequence above.
An image that does not exist fails the deploy — the stack cannot fall back to
building, because nothing in the production file builds.

#### Rolling back

The same command with the previous SHA:

```sh
GEMONE_IMAGE_TAG=<previous SHA> docker compose -f docker-compose.prod.yml up -d
```

`api`, `worker` and `migrate` all read that one variable, so a deployment cannot
end up running one commit's API against another commit's migrations. Rolling
back the *schema* is deliberately not part of this — migrations are
backward-compatible by rule, so the previous image runs against the newer schema.

To ask what is actually running rather than what the env file claims:

```sh
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$(docker compose -f docker-compose.prod.yml ps -q api)"
```

`docker/check-prod-images.sh` asserts these properties in CI on every pull
request: nothing builds, no moving tags, and `api`, `worker`, `migrate` and `web`
all on one tag.

### 20.3 Backups

- `pg_dump` nightly, encrypted, shipped **off the VPS** — a backup on the same
  host is not a backup. Built; the destination is a deployment decision (T72).
- Retention: daily for a month, weekly for a quarter.
- **A restore is performed and timed before launch, and quarterly after.** An
  untested backup is a hypothesis.

**What is built.** The `backup` container (`docker/backup.sh`) runs `pg_dump`
at 02:00 UTC and once at startup, into a volume of its own — separate from
`postgres_data`, because a dump inside the database's own volume is lost to the
accident that removes it. Each dump is written aside and moved into place, so an
interrupted one never looks complete, and its table of contents is read back
immediately: an archive that cannot be listed is deleted rather than kept as a
recovery plan that fails on the day it is needed. Sunday's dump is hard-linked
into `weekly/`, which turns §20.3's two retention windows into two `find`
commands. The health check asks whether a *recent dump exists* rather than
whether the process is running, because a sleep loop that has stopped backing up
is still running; `autoheal` restarts it, and the restart takes a backup
immediately.

**Restoring** is `docker/restore.sh`, a script rather than a page of prose,
because §20.3's requirement is that a restore is *performed* and a procedure
nobody has executed is a hypothesis. It restores beside the live database by
default and refuses a target that already exists; `--replace` drops and
recreates. A dump is listed before anything is dropped, so an unreadable archive
cannot cost you the database you still had.

**Off the host** is the `backup-remote` container (`docker/backup-remote.sh`),
which is what makes the dumps survive losing the VPS rather than only losing the
data. It watches the same volume and, for each dump it has not yet shipped:
encrypts it, uploads it to S3-compatible object storage, **reads it back through
the same decryption and compares the SHA-256 to the local file**, and only then
writes a receipt. Encryption is client-side, so the provider stores ciphertext
it cannot read; filenames stay in the clear, because at 3am an operator has to
be able to see which night a file is from.

| Setting | |
|---|---|
| `BACKUP_S3_ENDPOINT` | Any S3-compatible endpoint. Must be `https://` |
| `BACKUP_S3_BUCKET` · `BACKUP_S3_PREFIX` · `BACKUP_S3_REGION` | Where objects land |
| `BACKUP_S3_ACCESS_KEY_ID` · `BACKUP_S3_SECRET_ACCESS_KEY` | Needs `PutObject`, `GetObject`, `ListBucket`, `DeleteObject` — not `CreateBucket` |
| `BACKUP_ENCRYPTION_PASSPHRASE` | ≥32 characters. **Losing it loses every off-host backup** |

All required, with no defaults: an off-host backup that is optional is an
off-host backup that is missing. No provider is named anywhere — the choice is
a deployment decision, not an architectural one.

**`BACKUP_S3_REGION` is not cosmetic.** SigV4 signs the region into every
request's credential scope, so a value that disagrees with the endpoint is
rejected wholesale — `AuthorizationHeaderMalformed: the region is wrong`. It
defaults to `us-east-1`, which is right for AWS and wrong everywhere else:
providers that put the region in their hostname want that same string.
Backblaze B2's `https://s3.us-east-005.backblazeb2.com` means
`BACKUP_S3_REGION=us-east-005`. The value is logged at startup for exactly this
reason.

**On providers that keep versions,** retention needs one thing set outside this
stack. `DeleteObject` on a versioned bucket — Backblaze B2's default — hides the
current version rather than removing the data, so the sweep works (the objects
stop being listed and stop being restorable) while the bytes stay and stay
billed. A bucket lifecycle rule that keeps only the last version, or expires
non-current versions, is what makes retention actually reclaim storage.

**"Uploaded" means round-tripped, and health reads receipts.** The health check
asks whether a *receipt* is recent, not whether a dump is, so a stack whose
uploads are failing while its local dumps keep succeeding reports unhealthy —
which is the true statement about it. `backup-remote.sh` deletes no local dump
under any circumstance: a remote outage must not be able to become local data
loss.

`docker/backup-remote-drill.sh` runs the whole path: upload, object present,
download, byte-identical, restores into a database, retention sweeps the aged
object and leaves the current one, and a failed upload leaves the verified
local dump untouched with no receipt written. It runs against a disposable
local server by default, or against a real endpoint when `DRILL_S3_ENDPOINT`,
`DRILL_S3_BUCKET`, `DRILL_S3_REGION` and the two key variables are exported.
It writes only under a `drill/` prefix, so it cannot touch what production
writes under `gemone/`.

**This has been done for real**, against an external S3-compatible bucket: 26
assertions, including a restore from an object fetched back out of the
provider, with balances unchanged — and with a key that cannot list the
account's buckets. That is the requirement above ("a restore is performed and
timed before launch") met for the copy that survives losing the host, which is
the one the requirement is about.
- Redis is not backed up: it holds cache, counters, and queue state, all
  reconstructible. Queue loss means re-running scheduled jobs and replaying
  unprocessed postbacks from `provider_postbacks` — which is precisely why the
  raw payloads are stored (§10.1).

### 20.4 Environments

Two: **local** (Docker Compose, `MockProvider`, seeded data) and **production**.

No staging environment in the MVP. With one developer, a staging environment
mostly adds a second thing to keep in sync (P6). What replaces it: `MockProvider`
plus recorded fixtures make provider behavior reproducible locally, and CI runs
the full test suite against a real Postgres and Redis. Revisit when a second
developer joins or when a provider integration cannot be reproduced locally.

### 20.5 Operational Baseline

- **Health endpoints are specified in §17 and built** — `/health` gates Docker
  restarts, `/health/ready` gates the deploy (§20.2) and traffic routing.
  `autoheal` acts on failing checks, which is what makes them more than
  decoration (§17.2).
- **Nothing watches from outside the box.** The intent is one small container —
  Uptime Kuma or equivalent — polling the health endpoints from off this VPS
  (P4), because every check described above runs *on* the machine whose failure
  it is supposed to report. A host that is down reports nothing at all. Not
  built: it needs a place to run and a channel to notify, both of which are
  decisions rather than code.
- **`docs/RUNBOOK.md`** covers deploy, rollback, backup and restore (local and
  off-host), health and incident triage, the socket proxy, the configuration
  failures the stack enforces, logs, and credential rotation. It documents only
  procedures that exist and have been executed, and marks the rest — external
  monitoring, alerting, replaying quarantined postbacks (T21), disabling a
  provider (T35) — as not implemented rather than describing them.

---

## 21. Future Extension Points

Per P6, none of these are built now. Each is listed with **the seam that already
exists**, so the future work is an addition rather than a refactor. If an item
here would require redesign rather than extension, that is a gap in this
architecture worth fixing now.

| Extension | Existing seam | What it would take |
|---|---|---|
| **Append-only ledger** (P2) | `RewardAccountingService` + `reward_transactions` recorded from day one | New implementation behind the same interface; backfill by replaying history; reconciliation verifies the migration. **No business logic changes** |
| **Automated payouts** | `PayoutProvider` interface | New implementation; add an `EXECUTING` state; the state machine's shape is unchanged |
| **Publisher role and SDK** | Module boundaries + normalized offer model | New `publishers` module; publisher dimension on clicks and conversions; revenue split at credit time. The largest item here, and the one to re-validate this architecture against before starting |
| **Gift card redemption** | `PayoutProvider` | Another implementation plus a catalog module |
| **New offer provider** | `OfferProviderAdapter` + registry | §7.4 checklist. Under one day |
| **Multi-currency** | `Money` value object; currency already in configuration | Conversion at credit time; display-layer changes |
| **Localization / RTL** | User-facing strings externalized from day one | Translation files plus RTL styling |
| **Mobile app** | API is already the sole business surface; `web` is one client | Native clients call the API directly; the token model needs a mobile-appropriate refresh flow |
| **Horizontal scaling** | Stateless `api` and `worker`; state in Postgres and Redis; repeatable jobs are replica-safe | Add replicas behind Caddy. No code changes expected |
| **Read replicas** | All balance reads already funnel through one service | Route read-only queries; balance reads stay on the primary (§14.2) |
| **Personalized offer ranking** | Ranking is isolated in `offers` and configuration-driven | Replace the ranking function; the wall assembly pipeline is unchanged |
| **Event bus / webhooks for partners** | Business events are already distinct log/notification points | Introduce a real outbox table. **Deliberately not built now** — an outbox is meaningful only when something consumes it |
| **Metrics and dashboards** | Business events are named log events at single code locations (§17.4) | Add a `/metrics` endpoint; Prometheus + Grafana containers |
| **Error reporting** | One global exception filter (§15.5, §17.5) | One SDK call; GlitchTip container |
| **Admin TOTP** | Two-step login flow, reserved user fields, level-based guard (§8.4) | Implement the second step. No change to the login endpoint or its callers |
| **OAuth / social login** | Session issuance is independent of how identity is established (§8.0) | New verification path resolving to a user record; **account-linking policy must be decided first** |

---

## 22. Deliberately Not Built

The explicit application of P6 to this architecture. Each of these is a
recognized pattern that would be defensible in a larger system and is wrong here,
with the trigger that would change the answer.

| Not built | Why not | Revisit when |
|---|---|---|
| Microservices | One team, one database, one transaction boundary that matters | Independent scaling or independent deploy cadence becomes a real constraint |
| CQRS / event sourcing | Reads and writes have the same shape and volume; event sourcing would prejudge P2's open question | Reporting load conflicts with transactional load |
| Repository layer over Prisma | Prisma is already the abstraction; the layer would exist to swap databases, which nobody plans to do | Never, most likely |
| GraphQL | One first-party client with known screens. REST plus shared types gives type safety without a schema layer | Multiple clients with divergent data needs |
| Dedicated message broker | Redis and BullMQ cover the guarantees we need; a broker is a second stateful system to run and back up | Cross-service messaging, or delivery guarantees BullMQ cannot provide |
| Turborepo / Nx | Two apps and two packages. Build times are not a complaint | CI time becomes a real complaint |
| Kubernetes | One VPS. Compose is the smaller thing that works | Multiple hosts genuinely need orchestration |
| **Feature flag system** | The configuration service already provides typed, audited, hot-reloaded runtime toggles. A second such mechanism is duplicated machinery — **§5.2** | Percentage rollouts or A/B testing become real requirements, *and* the configuration service cannot carry them |
| Staging environment | One developer; MockProvider plus fixtures reproduce provider behavior locally | A second developer, or a provider that cannot be reproduced locally |
| Generic plugin/hook system | We have exactly one extension axis — providers — and it has a dedicated interface | A second, genuinely different extension axis appears |
| Distributed tracing | One API process, one worker. Correlation ids answer what tracing would (§17.1) | Work spans more than two processes |
| Multiple repositories | Shared API vocabulary changes constantly; cross-repo publishing turns compile errors into runtime errors (§2.0) | Independent ownership or divergent release cadence |

---

## 23. Open Questions for Implementation

Deliberately unresolved here, because resolving them requires information the
implementation will produce. Each has a decision point and a default.

1. **Points-per-unit-revenue base rate.** Configuration (P3), so it is a launch
   decision, not an architectural one. **Default:** conservative; easier to raise
   than to cut (PROJECT.md R9).
2. **Attribution window length.** 30 days is the industry norm and the starting
   configuration value. Real provider behavior may justify per-provider values —
   the resolution chain already supports it.
3. **Geo-IP data source.** A free database (MaxMind GeoLite2 or similar) behind
   our own interface (P1, P4). Which one is an implementation detail.
4. **Whether `web` needs its own session store.** Starting position: signed
   cookies holding the token pair, no server-side store. If cookie size or
   server-side revocation becomes a problem, Redis-backed sessions are a
   contained change inside `web`.
5. **Fraud rule set at launch.** The rules are listed in PROJECT.md §4.7; their
   thresholds and actions are configuration. The starting values should come from
   the first two weeks of real conversion data, not from a guess made now.

### 23.1 Scheduled Decision Points

Not open questions — decisions already made, with the condition that reopens
them. Recorded here so they are triggered by an event rather than remembered.

| Decision | Current answer | Reopens when |
|---|---|---|
| **Admin TOTP** (§8.4) | Supported by the design, not implemented | A second admin account is created, **or** an automated payout provider is introduced — whichever comes first |
| **Append-only ledger** (P2) | Simple balance model behind the service interface | Reconciliation reports unexplained drift, or after the first month of production data — whichever comes first (PROJECT.md R5) |
| **OAuth login** (§8.0) | Email/password only | Signup-funnel data shows friction is costing real registrations |
| **Metrics stack** (§17.4) | Not built | An aggregate question cannot be answered from logs in reasonable time |
| **Error reporting** (§17.5) | Not built | An error reaches a user before it is noticed in the logs |
| **Staging environment** (§20.4) | Not built | A second developer joins, or a provider cannot be reproduced locally |

---

## 24. Approval

- [x] **Approved.** Adjustments requested at review — monorepo rationale (§2.0),
      testing strategy (§18), observability (§17), feature flags excluded (§5.2),
      email/password-only authentication (§8.0), and TOTP made optional (§8.4) —
      have been applied.

Implementation begins now. The first milestone (M1 in PROJECT.md §7) builds §3's
skeleton, the configuration service, and authentication — in that order, because
everything downstream depends on the configuration service existing before the
first business rule is written.
