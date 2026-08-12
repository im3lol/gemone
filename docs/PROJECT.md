# PROJECT.md — Offerwall Aggregator Platform

> **Status:** Scope approved (Rev 2). Rev 3 adds P6 and applies it; scope
> unchanged.
> **Next artifact:** `ARCHITECTURE.md`. No implementation starts before it.

---

## 1. Vision

Build an **offerwall aggregation platform** that lets end users complete offers
(surveys, app installs, sign-ups, tasks) sourced from multiple third-party
offerwall networks, earn points for verified completions, and redeem those
points for cash-equivalent rewards.

The platform is **not** an ad network. It owns no inventory. Its value is:

1. **Aggregation** — one unified wall combining several provider catalogs,
   deduplicated, geo/device-filtered, and ranked by expected user value.
2. **Trustworthy reward accounting** — every point a user earns is traceable to
   a signed provider postback, and every point spent is traceable to a payout
   decision.
3. **Provider independence** — providers are commodities. Adding, replacing, or
   dropping a network must be a configuration and adapter concern, never a
   rewrite of business logic.

The long-term goal is to become the reward layer that other products
(publishers) can embed. The MVP deliberately proves the economics and the
integrity of the reward system **before** taking on publishers.

### Core Architectural Principles

These six principles govern the entire project. Every design decision in this
document defers to them, and any future decision that conflicts with one of them
is wrong by default.

**P6 is the constraint on the others.** P1–P4 authorize abstraction; P6 sets the
bar each abstraction must clear. Where they appear to conflict, §1.1 resolves it.

---

#### P1 — Provider Independence

> **Business logic must never depend directly on third-party providers.
> The core application communicates only with internal interfaces.
> External providers are implementation details.**

The core domain knows nothing about any specific provider. Provider-specific
knowledge lives exclusively inside adapters implementing a fixed interface. The
core deals only in normalized concepts: `Offer`, `Conversion`, `Reward`,
`Payout`.

This applies beyond offerwall networks — it holds for every external service the
platform ever touches: payment processors, email delivery, geo-IP lookup, fraud
APIs, storage. Each sits behind an internal interface owned by us.

---

#### P2 — Abstracted Reward Accounting

> **Reward accounting is abstracted behind a service interface. The initial
> implementation may use a simple balance model, while the architecture must
> allow migration to an append-only ledger in the future without changing
> business logic.**

No business rule anywhere in the codebase reads or writes a balance directly.
All reward mutations go through `RewardAccountingService`. The storage strategy
behind that interface is an implementation detail that can be replaced once the
business rules are fully understood.

The purpose is to avoid locking into a specific accounting implementation before
the domain is understood. See §4.5 for the interface contract and the
constraints that keep the migration path open.

---

#### P3 — Everything Configurable

> **Every business rule must be configurable. No values are hardcoded.**

This explicitly includes, and is not limited to:

- Reward rates (points per unit of provider revenue)
- Hold periods — globally and per provider
- Supported providers — enabled, disabled, and added without deployment
- Withdrawal limits (minimum, maximum, per-method)
- Daily limits (earnings, clicks, withdrawal requests)
- Fraud thresholds (every rule's trigger value and resulting action)
- Currencies and conversion rates

Configuration is stored in the database, editable from the admin panel, versioned
with an audit trail, and hot-reloaded — changing a business rule must never
require a deployment. Code may define a *default*; it may never define the
*value in force*.

---

#### P4 — Free-First Infrastructure

> **Prefer free and open-source technologies whenever possible.**

Every infrastructure decision prioritizes:

- Free tier availability
- Open-source solutions
- Easy replacement of third-party services
- Low operational cost during the MVP stage

A paid dependency is acceptable only when no viable free alternative exists, the
cost is justified in writing, and — per P1 — it sits behind an internal interface
so it can be swapped without touching business logic. No paid SaaS dependency is
introduced during the MVP.

---

#### P5 — Correctness Over Throughput

> **A reward the user did not earn, or a reward the user earned and did not
> receive, is a product failure. Latency is not.**

Where the two conflict, the MVP chooses the auditable path.

---

#### P6 — Simplicity First

> **Do not over-engineer the MVP. Every abstraction must solve a real problem,
> not a hypothetical future problem.**

- Follow **YAGNI** — *You Aren't Gonna Need It* — while keeping clear extension
  points for future growth
- Avoid unnecessary layers, patterns, and complexity
- The architecture must be modular, easy to understand, and easy to refactor
- When choosing between **a simple solution that satisfies today's requirements**
  and **a complex solution prepared for uncertain future needs**, always choose
  the simpler one
- Future scalability comes from clean interfaces and modular design, **not
  premature complexity**

**The test every abstraction must pass:** name the problem it solves *today*. Not
the problem it might solve, not the problem a similar system had — the concrete
problem present in this codebase now. An abstraction that cannot name one is
deleted, however elegant.

A clean interface is cheap; a speculative layer behind it is not. Prefer one
well-named interface with a direct implementation over an interface, an abstract
base, a factory, and a strategy registry — the first is a seam you can extend
later, the rest is a guess you have to maintain until it is proven wrong.

**Refactorability is the real goal.** The MVP will be wrong about something. The
architecture's job is not to anticipate which thing — it is to make being wrong
cheap to fix. Modular boundaries and small, honest implementations do that;
elaborate configurable machinery does the opposite, because complexity that
anticipated the wrong future is harder to remove than code that never tried.

---

### 1.1 Resolving Tension Between the Principles

P6 constrains P1–P4, and pretending otherwise would leave the contradiction for
implementation to discover. Each of the abstractions this document mandates has
been tested against P6 and survives for a stated present-tense reason:

| Abstraction | Present-tense problem it solves | Verdict |
|---|---|---|
| `OfferProviderAdapter` (P1) | 3–4 providers ship in the MVP with genuinely different payload shapes and signature schemes. Without the seam, provider logic spreads through the core in week 2. | **Justified** — the second provider proves it, not a future one |
| `RewardAccountingService` (P2) | The accounting model is undecided *now*, and calls to it appear in week 3. One seam is cheaper than rewriting every call site later. | **Justified** — but only the seam. The implementation behind it is the simplest thing that works |
| Configuration service (P3) | Reward rates and hold periods must change from live data within days of launch. This is a week-6 need, not a someday need. | **Justified** — scoped to the values in P3, not a general-purpose rules engine |
| `PayoutProvider` (P1) | One implementation exists today. The seam costs one interface file; without it, automating payouts later touches the payout state machine. | **Justified, minimally** — one interface, one implementation, no factory |

**How the tension resolves in practice:**

- **P1/P2 authorize a seam, not a framework.** An interface with one honest
  implementation satisfies them. Additional layers behind that interface must
  justify themselves against P6 separately.
- **P3 is bounded by its own list.** It names the values that must be
  configurable. Making *other* things configurable "for consistency" is exactly
  the speculative complexity P6 forbids — a configuration key nobody has ever
  changed is a liability, not flexibility.
- **P6 never overrides P5.** Simplicity is not a reason to skip a database
  transaction, an idempotency constraint, or the reconciliation job. Correctness
  is a present-tense requirement, not a future one.
- **When P6 conflicts with P1–P4, P6 wins on *depth*; P1–P4 win on *placement*.**
  Put the seam where those principles say. Keep what sits behind it as thin as
  today's requirements allow.

---

## 2. MVP Scope

**Timebox:** 4–6 weeks. Scope is fixed to that window; anything that does not
fit is listed in *Out of Scope* rather than silently deferred.

### 2.1 What the MVP Delivers

| # | Capability | Definition of Done |
|---|-----------|-------------------|
| 1 | User accounts | Email + password registration, email verification, login, password reset, session management |
| 2 | Offer aggregation | 3–4 provider adapters fetching and normalizing offer catalogs into one unified feed |
| 3 | Offer wall UI | Filterable, sortable list of offers targeted by user geo + device |
| 4 | Offer click tracking | Signed click records linking `user → offer → provider` before redirect |
| 5 | Postback ingestion | Signed, idempotent, replay-safe endpoint per provider that credits points |
| 6 | Reward accounting | All balance mutations behind `RewardAccountingService`; no business rule touches storage directly (P2) |
| 7 | Chargeback handling | Providers can reverse a conversion; a compensating reward transaction is recorded |
| 8 | Withdrawal requests | User requests a payout above a configurable minimum; funds are locked on request |
| 9 | Manual review & payment | Admin reviews each request, approves/rejects, pays out **off-platform**, and marks it settled with a reference |
| 10 | Baseline anti-fraud | Rule-based scoring at conversion time, all thresholds configurable; suspicious accounts flagged and held for review |
| 11 | Admin panel | User inspection, conversion audit trail, payout queue, provider health, business-rule configuration, manual adjustment (with mandatory reason) |
| 12 | Configuration service | Typed, database-backed, hot-reloadable configuration with audit trail — the enforcement mechanism for P3 |
| 13 | Observability | Structured logs, provider postback audit trail, health checks, error tracking |

### 2.2 Providers Targeted for MVP

Three to four of: **AdGem**, **Torox**, **Lootably**, **OfferToro**.

The precise set will be finalized by whichever accounts get approved first —
which is exactly why the adapter boundary exists. **The build does not block on
provider approval:** development proceeds against a `MockProvider` adapter plus
recorded fixtures of real payloads.

### 2.3 Technology Stack

| Layer | Choice | Rationale (see §8 for detail) |
|-------|--------|------------------------------|
| Backend | **NestJS** (TypeScript) | Module boundaries and DI make the adapter pattern natural to enforce |
| Database | **PostgreSQL** | Transactional integrity is non-negotiable when money is involved |
| ORM | **Prisma** | Type-safe queries and versioned migrations |
| Cache / Queue | **Redis** + **BullMQ** | Catalog caching, rate limiting, and async postback processing |
| Frontend | **SvelteKit** (TypeScript) | Small bundle, SSR for the public wall, one language across the stack |
| Auth | Self-hosted JWT (access + refresh, rotating) | No vendor lock-in, no per-MAU cost |
| Deploy | Docker Compose on a single VPS | Cheapest thing that is genuinely reproducible |
| CI | GitHub Actions | Free tier is sufficient |

Every component is free and open-source, satisfying **P4**. No paid SaaS
dependency is introduced in the MVP, and each externally-provided capability
(email delivery, geo-IP lookup, error tracking) sits behind an internal interface
per **P1**, so a free tier being withdrawn is a one-adapter problem rather than a
migration.

### 2.4 Explicit MVP Non-Goals

The MVP is **not** trying to maximize revenue, traffic, or provider count. It is
trying to prove four things:

1. Postbacks can be ingested correctly, exactly once, with a verifiable trail.
2. Reward balances never drift — every balance is explainable from its recorded
   reward transactions.
3. A payout can go out the door without an admin needing database access.
4. Business rules can be changed from the admin panel without a deployment.

---

## 3. User Roles

### 3.1 Guest
- Browse a limited preview of the offer wall
- Register / log in
- Cannot click offers or earn points

### 3.2 User (Earner) — *primary role*
- Manage profile and account settings
- Browse and filter the aggregated offer wall
- Click offers (generating a tracked, attributed click)
- View earnings history, per-offer status, and current balance
- View a full reward transaction history (credits, reversals, holds, payouts)
- Submit a support/missing-credit ticket for a specific click
- Request a withdrawal once the minimum threshold is met

### 3.3 Admin — *operator role*
- Inspect any user: profile, devices, IPs, clicks, conversions, reward history
- Review the payout queue; approve, reject (with reason), or hold
- Mark an approved payout as settled with an external payment reference
- Resolve missing-credit tickets and issue manual adjustments (reason mandatory)
- Flag, suspend, or ban accounts
- Enable/disable providers and configure their reward rates, revenue share, and
  hold periods
- **Edit every business rule listed in P3** — reward rates, hold periods,
  withdrawal limits, daily limits, fraud thresholds, currencies — without a
  deployment
- Monitor provider health: postback volume, error rate, last-seen timestamp

### 3.4 System (Automated Actor)
Not a login, but modeled explicitly because it mutates reward balances:
- Scheduled catalog synchronization jobs
- Postback processing workers
- Fraud scoring engine
- Reconciliation job comparing provider-reported vs. locally-recorded revenue

> **Role model note:** MVP ships with exactly these roles as a fixed domain enum.
> Roles are domain structure, not a business rule, so P3 does not apply to them —
> what each role is *permitted to configure* is itself configurable, but the set
> of roles is not. Granular permissions and a `Publisher` role are deliberately
> out of scope, and the schema will not make them painful to add.

---

## 4. Core Features

### 4.1 Provider Adapter Layer *(the architectural centerpiece)*

Every provider implements one interface:

```
OfferProviderAdapter
  ├── fetchOffers(targeting)        → NormalizedOffer[]
  ├── buildClickUrl(user, offer)    → tracked redirect URL
  ├── verifyPostback(request)       → signature valid? (per-provider scheme)
  └── parsePostback(request)        → NormalizedConversion
```

**Rules that hold for the life of the project:**
- The core imports the **interface**, never a concrete adapter.
- Adapters are registered in a registry keyed by provider slug and resolved at
  runtime from database configuration.
- Adding a provider = one new adapter file + one config row. **Zero changes to
  core business logic.** This is enforced by code review and by an architecture
  test in CI.
- Every adapter ships with contract tests running against recorded fixtures of
  that provider's real payloads.

### 4.2 Offer Catalog & Unified Wall
- Scheduled sync per provider, cached in Redis with a per-provider TTL
- Normalization into a single `Offer` shape: title, description, requirements,
  payout, category, device, geo, provider
- Filtering by user geo (IP-derived) and device (user-agent)
- Cross-provider deduplication by campaign fingerprint (name + advertiser +
  target URL) — when the same offer appears on two networks, show the one that
  pays the user more
- Ranking by effective user reward, with a manual pinning override for admins
- **Graceful degradation:** if a provider's API is down, the wall renders from
  the last good cache and logs a health event. One dead provider never takes the
  wall down.

### 4.3 Click Tracking & Attribution
- Every click writes a `Click` row *before* redirecting
- A signed, opaque `sub_id` (our internal click identifier) is passed to the
  provider — never the raw user ID
- Captured at click time: IP, user-agent, device fingerprint, timestamp, referrer
- Rate limiting per user and per IP
- Clicks expire after a configurable attribution window (default 30 days)

### 4.4 Postback Ingestion *(the highest-risk surface)*

A dedicated endpoint per provider, treated as untrusted input:

1. **IP allowlist** — reject sources outside the provider's published ranges
2. **Signature verification** — delegated to the adapter (each provider differs)
3. **Idempotency** — unique constraint on `(provider, provider_transaction_id)`;
   duplicate postbacks return `200 OK` without double-crediting
4. **Attribution** — resolve `sub_id` to a `Click`; unmatched postbacks are
   quarantined for admin review, never silently dropped
5. **Fraud scoring** — before crediting
6. **Reward credit** — via `RewardAccountingService`, inside a single database
   transaction
7. **Raw payload archived verbatim** — for disputes and for replay during
   incident recovery

Processing is enqueued to a worker. The HTTP handler's only job is to validate,
persist the raw payload, and acknowledge fast — providers retry aggressively on
timeouts, and a slow handler manufactures duplicates.

### 4.5 Reward Accounting *(P2)*

Reward accounting is defined by an **interface**, not by a storage strategy. The
MVP ships a simple balance implementation; the architecture keeps the door open
to an append-only ledger without touching a single business rule.

```
RewardAccountingService
  ├── credit(userId, amount, source, metadata)      → RewardTransaction
  ├── debit(userId, amount, reason, metadata)       → RewardTransaction
  ├── reverse(transactionRef, reason)               → RewardTransaction
  ├── lock(userId, amount, payoutRef)               → RewardTransaction
  ├── releaseLock(payoutRef, reason)                → RewardTransaction
  ├── getBalance(userId)                            → Balance
  └── getHistory(userId, filter)                    → RewardTransaction[]
```

**Contract rules — these are what preserve the migration path:**

- **No business rule reads or writes a balance directly.** Conversion crediting,
  chargebacks, payouts, fraud holds, and admin adjustments all call this
  interface and nothing else. Direct database access to balance tables outside
  the service implementation is an architecture violation, enforced in CI.
- **Balance is a value object, not a number.** It exposes `available`, `pending`
  (inside the hold period), and `locked` (reserved for an in-flight payout).
  Callers never assume a single scalar.
- **Every mutation returns a `RewardTransaction`** carrying amount, type, source
  reference, actor, timestamp, and reason. Callers depend on this record, not on
  how it is stored.
- **Every mutation is recorded, even under the simple balance model.** The
  initial implementation maintains a `RewardTransaction` history table alongside
  the balance. Balance is authoritative for now; history is the audit trail — and
  it is what a future ledger implementation replays to become authoritative
  instead.
- **Transaction types are a closed enum** owned by the domain:
  `CONVERSION_CREDIT`, `CHARGEBACK_DEBIT`, `PAYOUT_LOCK`, `PAYOUT_SETTLE`,
  `PAYOUT_REFUND`, `MANUAL_ADJUSTMENT`, `BONUS`.
- **All mutations execute inside a database transaction** with an isolation level
  and locking strategy appropriate to the active implementation.
- **A reconciliation job runs nightly** asserting that each user's balance is
  explainable from their recorded transactions, and alerts on any drift. This
  job is written against the interface and survives the implementation change —
  it is also the mechanism that will *verify* the migration when it happens.
- **Negative balances are permitted** (chargeback arriving after a payout) and
  surfaced to admins rather than clamped to zero. Hiding them destroys the audit
  trail.

> **Why this is deliberately unresolved:** committing to an append-only ledger
> now would freeze an accounting model before the business rules that shape it —
> hold semantics, partial reversals, bonus expiry — are fully understood. The
> interface lets the model be decided by evidence rather than by a guess made in
> week 1. The cost of that option is the discipline above; the cost of guessing
> wrong is a migration through every call site.

### 4.6 Rewards, Withdrawal & Manual Payout

The MVP uses **manual review + manual payment**. No payment gateway integration.

Flow:
1. User requests a withdrawal and supplies payment details for their chosen
   method. The minimum amount, maximum amount, per-method limits, and daily
   request cap are **all configuration values** (P3)
2. Points are **immediately locked** via `RewardAccountingService.lock()` — this
   prevents double-spending while the request sits in the queue. Only
   `available` points are lockable; `pending` (still inside the hold period) and
   already-`locked` points are not
3. Request enters the admin queue with status `PENDING_REVIEW`
4. Admin reviews the account: fraud score, conversion history, chargeback rate,
   account age
5. **Approve** → status `APPROVED`; admin pays out externally (bank transfer,
   PayPal, crypto — outside the system), then records the external reference and
   marks it `PAID`, settling the lock
6. **Reject** → status `REJECTED` with a mandatory reason; the lock is released
   and the points return to the user's available balance
7. The user sees every status transition in their history

Payout **methods** are configuration, not code — adding a payment method an admin
can settle manually requires no deployment.

> **Why manual:** payment-gateway integration is weeks of work and carries KYC,
> AML, and chargeback exposure. At MVP volume an admin can process the queue by
> hand in minutes a day. Per P1, payout execution sits behind its own interface
> whose only MVP implementation is `ManualPayoutProvider` — an automated provider
> slots in later without touching reward accounting or the payout state machine.

### 4.7 Anti-Fraud Baseline

Rule-based scoring at conversion time (no ML in the MVP):
- Velocity: conversions per user / per IP / per device per time window
- Multi-accounting signals: shared device fingerprint or IP across accounts
- VPN / proxy / datacenter IP detection
- Geo mismatch between click IP and postback-reported country
- Impossible timing: conversion faster than the offer could plausibly be completed
- Chargeback rate per user
- Disposable email domain blocklist

Scores are advisory: high-risk conversions are credited but **held** (not
withdrawable) pending admin review, rather than rejected outright. Rejecting
legitimate users is more expensive than a short hold.

Per **P3**, every rule's threshold *and* its resulting action (score-only, hold,
require-review, block) is configuration. Rules can be enabled, disabled, and
retuned from the admin panel without a deployment — which matters because fraud
patterns change faster than release cycles.

#### Hold Period

> **The hold period is configurable globally and per provider through the admin
> configuration. It is never hardcoded.**

Held points sit in the `pending` bucket of the user's balance until the period
elapses, then become `available` and therefore withdrawable.

- A **global default** applies to any provider without an explicit override
- **Per-provider overrides** take precedence — networks differ substantially in
  how long they take to reverse a conversion, so a single value across all of
  them is either needlessly punitive for reliable providers or dangerously short
  for volatile ones
- Changes apply to **newly credited conversions only**; already-credited points
  keep the period in force when they were earned. Retroactively extending a hold
  on points a user was told were available is a trust failure, and the
  implementation must make it impossible rather than merely discouraged
- Every change is written to the configuration audit trail with actor and reason

Resolution order: **provider → global default**.

> **P6 note:** an earlier revision also specified per-offer-category overrides.
> No provider has been observed to need one, so it is removed — the two-level
> chain above satisfies the requirement today. The resolution chain is ordered
> and extensible, so adding a third level is a small change *if a real provider
> ever demands it*. This is the difference between an extension point and
> speculative complexity.

Setting the hold to zero is permitted and is a legitimate configuration for a
provider that never reverses — but it is a business decision an admin makes
deliberately, not a default the code assumes.

### 4.8 Admin Panel
- Dashboard: conversions, revenue, payouts, active users, provider health
- User detail view with full audit trail
- Payout queue with review actions
- Conversion explorer with raw postback payload inspection
- Quarantined/unmatched postback queue
- Provider configuration: enable/disable, credentials, reward rate, revenue
  share, hold period
- **Business rule configuration screen** covering every value listed in P3
- Manual balance adjustment with mandatory reason (itself an audited action)

### 4.9 Configuration Service *(P3)*

The mechanism that makes "everything configurable" real rather than aspirational.

- **Database-backed**, typed, and validated on write — a malformed reward rate is
  rejected at the admin panel, not discovered in production
- **Hot-reloaded** through a cached configuration provider; changing a business
  rule never requires a deployment or a restart
- **Scoped resolution** with a consistent precedence chain — the hold period's
  `provider → global` pattern is the general shape, not a special case
- **Versioned with a full audit trail**: who changed what, from what value to
  what value, when, and why. Configuration changes move money, so they are
  audited exactly as strictly as manual balance adjustments
- **Code may define defaults; code may never define the value in force.** A
  literal in a business rule is a bug, and CI checks for the obvious cases
- **Effective-value inspection**: admins can see the value currently in force for
  any scope and where it was inherited from — configuration nobody can read
  confidently is configuration nobody will change safely

> **P6 boundary:** this is a typed key-value store with two-level scoping and an
> audit trail. It is **not** a rules engine, a feature-flag platform, or a DSL.
> The keys it holds are exactly the values enumerated in P3; adding a key
> requires naming the business need it serves. P3 demands that today's business
> rules be tunable — it does not demand a system capable of expressing rules
> nobody has written yet.

### 4.10 Cross-Cutting
- Structured JSON logging with request correlation IDs
- Every admin action written to an immutable audit log
- Rate limiting on all public endpoints
- Secrets via environment variables — never committed
- English-only UI in the MVP, but all user-facing strings externalized from day
  one so localization is a translation file, not a refactor

---

## 5. Out of Scope

Deliberately excluded from the MVP. Each is a real feature, not a dismissal —
they are sequenced after the core is proven.

### Deferred to v2
- **Append-only ledger implementation** — the migration behind
  `RewardAccountingService` (P2), decided on production evidence rather than now
- **Publisher role and embeddable SDK/iFrame** — the whole B2B side: publisher
  accounts, revenue sharing, per-publisher walls, publisher-facing postbacks
- **Automated payouts** — PayPal Payouts, Tremendous, Reloadly, crypto rails
- **Gift card catalog** — inventory, redemption codes, provider integration
- **Referral program**
- **Mobile applications** (native iOS/Android)
- **Localization / RTL** — Arabic UI and multi-currency display
- **Advanced fraud detection** — ML scoring, behavioral biometrics, third-party
  fraud APIs
- **Direct advertiser onboarding** — self-serve campaign creation and funding
- **Gamification** — levels, streaks, daily bonuses, leaderboards
- **Public reporting API for partners**
- **Social login** (Google/Facebook OAuth)
- **Real-time notifications** (WebSocket/push)
- **A/B testing framework for wall ranking**
- **Multi-region deployment and CDN**
- **KYC/AML verification flows**
- **Tax document generation** (1099 / equivalents)

### Permanently Out of Scope
- Building an ad network or acquiring direct advertiser demand
- Operating as a money transmitter or holding custodial user funds
- Any feature requiring a paid third-party SaaS dependency during the MVP

---

## 6. Risks

Ordered by expected impact. Each carries a concrete mitigation, because a risk
register without mitigations is a list of excuses.

### R1 — Provider Account Rejection · *Critical · Likely*
Offerwall networks reject new publishers with no traffic history. Without at
least two live providers, there is no product.
**Mitigation:** apply to 6+ networks in week 1, in parallel, before writing
integration code. Build against `MockProvider` and recorded fixtures so
development never blocks on approval. Prepare a credible traffic-source story
in advance. **This is the single biggest schedule risk and it is external —
treat provider applications as a week-1 blocking task, not paperwork.**

### R2 — Fraud & Chargebacks · *Critical · Likely*
Offerwalls are a magnet for fraud. Providers reverse conversions after the fact;
if points were already paid out in cash, the loss is real and unrecoverable.
**Mitigation:** a hold period before points become withdrawable, configured
globally and per provider (§4.7) and tuned from real reversal data rather than
fixed in code; mandatory manual review of every payout in the MVP; velocity and
multi-accounting rules from day one; reward accounting that represents negative
balances honestly instead of clamping them.

### R3 — Postback Reliability · *High · Likely*
Missed, duplicated, out-of-order, or replayed postbacks corrupt reward balances
and destroy user trust faster than any other failure mode.
**Mitigation:** idempotency keys with database-level unique constraints; raw
payload archival enabling full replay; unmatched-postback quarantine queue;
signature verification per provider; a reconciliation job comparing provider
dashboards against local records.

### R4 — Reward Accounting Integrity · *Critical · Possible*
A race condition in balance updates means paying out points that were never
earned. Financial bugs are found by attackers before they are found by tests.
**This risk is higher under the simple balance model than under an append-only
ledger, and that is a deliberate, stated trade-off of P2** — a mutable balance
row is exactly the thing concurrent credits, locks, and reversals contend over.
**Mitigation:** all mutations confined to `RewardAccountingService` — one
implementation to get right rather than call sites scattered across the codebase;
every mutation inside a database transaction with row-level locking and an
isolation level chosen for this contention; property-based tests asserting the
balance invariant under concurrency; a full `RewardTransaction` history recorded
from day one even though the balance is authoritative; nightly reconciliation
comparing balance against that history, with alerting on drift.

### R5 — Deferred Accounting Decision Never Gets Made · *Medium · Possible*
P2 buys an option, and options expire unexercised. The realistic failure is not a
bad migration — it is that the simple balance model quietly becomes permanent,
the discipline erodes, and direct balance access creeps into business rules until
the migration path is gone.
**Mitigation:** CI enforcement of the "no direct balance access" rule, not
convention; the `RewardTransaction` history recorded from day one is what a
ledger implementation would replay, so the migration input exists whether or not
it is used; the decision is scheduled for explicit review after the first month
of production data, with the reconciliation job's drift rate as the deciding
evidence. **If reconciliation reports any unexplained drift in production, that
is the signal to migrate — not a bug to patch.**

### R6 — Scope Creep Past the 6-Week Window · *High · Likely*
The publisher SDK, automated payouts, and gift cards are all individually
tempting and collectively fatal to the timeline.
**Mitigation:** the *Out of Scope* list above is contractual. Adding anything to
the MVP requires removing something of equal size.

### R7 — Provider API Instability · *Medium · Likely*
Third-party APIs change formats without notice, rate-limit aggressively, and go
down.
**Mitigation:** adapter isolation contains the blast radius to one file; contract
tests catch format drift; cached catalogs with graceful degradation; per-provider
health monitoring and alerting.

### R8 — Payment & Regulatory Exposure · *High · Possible*
Paying users cash across borders touches money-transmission, tax, and
sanctions-screening rules that vary by jurisdiction.
**Mitigation:** manual payouts in the MVP keep volume low and every transaction
human-reviewed; conservative geo restrictions at launch; obtain legal review
before automating payouts or scaling volume. **This risk grows with success and
must be revisited before v2, not after.**

### R9 — Unit Economics Don't Work · *High · Possible*
If the reward rate is set too generously, growth increases losses. Too stingy,
and users churn before their first payout.
**Mitigation:** per P3, reward rates are per-provider configuration adjustable
without deployment — this risk is precisely why P3 exists, since the correct rate
is discovered from live data and cannot be known in advance; track
revenue-per-conversion vs. points-issued from the first day; a conservative
launch rate is easier to raise than to cut.

### R10 — Single Developer / Bus Factor · *Medium · Certain*
**Mitigation:** decisions recorded in this document and in ADRs; infrastructure
defined as code; no undocumented manual production steps.

---

## 7. Milestones

Six weekly milestones. Each ends with something demonstrable — no milestone is
"internal work only." M1–M5 constitute the MVP; M6 is the launch buffer.

### M0 — Week 0 (parallel, starts immediately)
**Unblocking external dependencies**
- Submit applications to 6+ offerwall providers
- Register domain, provision VPS, configure DNS
- Draft Terms of Service and Privacy Policy

*Exit criterion:* applications submitted. **Nothing downstream waits on their
responses.**

---

### M1 — Week 1: Foundation
- Repository, Docker Compose environment, CI pipeline
- NestJS + Prisma + PostgreSQL + Redis wired and running
- Complete database schema and initial migrations
- **Configuration service** (P3): typed, database-backed, hot-reloaded, audited,
  with scoped resolution — built in week 1 because every later milestone depends
  on it, and retrofitting configurability is how hardcoded values survive
- Authentication: register, verify email, login, refresh, reset password
- SvelteKit shell with auth flows and protected routes
- Structured logging, health checks, error handling baseline

*Demo:* a user can register, verify their email, log in, and see an empty
dashboard; an admin changes a configuration value and it takes effect without a
restart.

---

### M2 — Week 2: Adapter Architecture & Offer Wall
- `OfferProviderAdapter` interface and provider registry
- `MockProvider` adapter with realistic fixtures
- First real provider adapter (whichever approves first)
- Catalog sync jobs with Redis caching
- Normalization, geo/device targeting, deduplication, ranking
- Offer wall UI: list, filter, sort, offer detail

*Demo:* a real, filtered, aggregated offer wall renders from at least two
providers (one real, one mock).

*Architectural gate:* adding the second provider must require **zero changes**
outside its adapter file and configuration. If it doesn't, the abstraction is
wrong and gets fixed here — not later.

---

### M3 — Week 3: Clicks, Postbacks & Reward Accounting
- Click tracking, signed `sub_id` generation, redirect flow
- Per-provider postback endpoints: IP allowlist, signature verification,
  idempotency, raw payload archival
- Async postback processing workers (BullMQ)
- `RewardAccountingService` interface + simple balance implementation, with the
  `RewardTransaction` history recorded from the first credit
- CI architecture test forbidding direct balance access outside the service
- Chargeback/reversal handling
- Unmatched-postback quarantine queue
- Reconciliation job asserting balances are explainable from recorded history
- User-facing earnings history and reward statement

*Demo:* a real conversion on a live provider credits the correct user with the
correct points, and a replayed duplicate postback credits nothing.

*This is the highest-risk milestone. If the schedule slips, it slips here — and
this is the wrong place to cut corners.*

---

### M4 — Week 4: Payouts & Anti-Fraud
- Withdrawal request flow with point locking, all limits configurable
- Payout state machine: `PENDING_REVIEW → APPROVED → PAID` / `REJECTED`
- `PayoutProvider` interface with `ManualPayoutProvider` as its only
  implementation (P1)
- Refund path returning points on rejection
- Rule-based fraud scoring engine — thresholds *and* actions configurable
- Hold period with global default, per-provider and per-category overrides, and
  the resolution chain from §4.7
- Flag/suspend/ban account actions
- User payout history

*Demo:* a user requests a payout, an admin reviews and approves it, records an
external payment reference, and the balance reflects the settlement correctly;
changing a provider's hold period from the admin panel changes when newly
credited points become withdrawable, while already-credited points keep their
original terms.

---

### M5 — Week 5: Admin Panel & Hardening
- Full admin panel: dashboard, user inspection, payout queue, conversion
  explorer, quarantine queue, provider configuration
- **Business rule configuration screen** covering every value in P3, with
  effective-value inspection and change history
- Immutable admin audit log
- Manual balance adjustment with mandatory reason
- Second and third real provider adapters integrated
- Rate limiting, security headers, input validation sweep
- Load testing on the postback endpoint
- Backup and restore procedure, tested by actually restoring

*Demo:* an admin operates the entire platform and changes every business rule in
P3 without touching the database and without a deployment.

---

### M6 — Week 6: Launch Preparation *(buffer)*
- Production deployment, monitoring, alerting
- Closed beta with a small invited user group
- Fix what beta finds
- Documentation: runbook, incident response, provider onboarding guide
- Legal pages published

*Exit criterion:* the platform is live, a real user has completed a real offer,
and a real payout has been sent.

> **Buffer policy:** M6 is a genuine buffer, not padding to be spent in advance.
> If M1–M5 slip, M6 absorbs it and beta shrinks. If they don't slip, M6 buys a
> longer beta. It is not a place to add features.

---

## 8. Key Architectural Decisions

Recorded here in summary; each is expanded in `docs/DECISIONS.md`, which is
where the running decision log actually lives.

**Why NestJS** — the adapter architecture is the project's central constraint,
and NestJS's module system and dependency injection make that boundary
structurally enforceable rather than merely conventional. A provider adapter is
a module; the core injects an interface token. Violating the boundary requires
visibly working around the framework, which makes it catchable in review.

**Why PostgreSQL** — this system moves money. It needs real transactions, real
isolation levels, and real constraints. Unique constraints on postback
idempotency keys are enforced by the database, not by application code that can
race with itself. It also serves both reward accounting implementations equally
well, so the P2 decision never becomes a database migration. Free and
open-source, satisfying P4. There is no alternative worth discussing.

**Why Prisma** — type-safe queries prevent a whole class of accounting bugs at
compile time, and versioned migrations make schema changes reviewable. Where
Prisma is too limiting (complex reconciliation aggregates, explicit row locking),
raw SQL is used deliberately rather than fought with.

**Why Redis + BullMQ** — postback handlers must acknowledge in milliseconds
because providers retry on timeout, and a retry is a duplicate. Redis-backed
queues decouple acknowledgment from processing. Redis also serves catalog
caching and rate limiting, so one dependency covers three needs.

**Why SvelteKit** — SSR benefits the public wall, bundles stay small on the
low-end mobile devices that dominate offerwall traffic, and TypeScript across
the whole stack means shared types between API and UI.

**Why reward accounting is an interface rather than a committed model (P2)** —
the honest reason is that the business rules that determine the right accounting
model are not yet known. Hold semantics, partial reversals, bonus expiry, and
multi-currency all shape it, and none are settled. Committing now means either
building a ledger for rules that turn out not to need one, or building a balance
model that has to be unpicked from every call site later. Concentrating all
mutations behind one service defers the decision at a known, bounded cost: the
discipline in §4.5 plus a somewhat higher concurrency risk in the interim (R4).
The migration input — a full `RewardTransaction` history — is recorded from day
one whether or not the option is exercised. The decision is scheduled, not
avoided (R5).

**Why configuration is a week-1 deliverable (P3)** — configurability is not a
feature that can be added later. Every hardcoded value becomes a call site that
must be found and rewritten, and the ones that get missed are exactly the ones
nobody remembered were business rules. Building the configuration service before
the first business rule exists means there is never a moment where hardcoding is
the path of least resistance. The commercially decisive values — reward rate and
hold period — must be tunable in minutes from live data, because getting them
wrong is the fastest way to lose money (R9) and the fastest way to lose users.

**Why manual payouts in the MVP** — gateway integration is weeks of work plus
KYC/AML exposure, for a problem that does not exist at MVP volume. Manual review
also puts a human in front of every early payout, which is the fastest way to
discover what fraud actually looks like on this platform before automating
anything. Per P1 it sits behind a `PayoutProvider` interface, so automating it
later is an added implementation, not a refactor.

**Why self-hosted auth** — no per-MAU pricing, no vendor lock-in (P4), and the
requirements (email/password, verification, reset) are well-understood. Uses
established libraries; nothing cryptographic is hand-rolled.

**Why free-first is an architectural rule and not just a budget (P4)** — free
tiers get withdrawn, repriced, and discontinued, and the projects that survive
that are the ones that put every external dependency behind an interface before
they needed to. P4 and P1 are the same discipline applied to cost and to
coupling: what can be replaced cheaply cannot hold the project hostage.

**Why simplicity is a principle rather than a preference (P6)** — this document
mandates four abstractions, and a document that mandates abstractions without
also mandating restraint reliably produces a system where every one of them grew
a framework underneath it. P6 exists to make each abstraction *pay rent*: the
seam is justified by a named present-tense problem (§1.1), and everything behind
the seam starts as the simplest implementation that works. The failure mode P6
guards against is specific and common — the codebase becomes hard to change in
exactly the ways it was over-designed to make easy, because the flexibility was
built for a future that arrived in a different shape. Complexity added for a
guessed future is harder to remove than code that never guessed.

---

## 9. Success Criteria for the MVP

The MVP is successful if, at the end of week 6:

1. At least 2 real providers are live and delivering conversions
2. A real user has earned points from a real conversion and been paid
3. Every user's balance is explainable from their recorded reward transactions,
   verified nightly with zero unexplained drift
4. Zero double-credits from duplicate postbacks, verified by replay testing
5. Adding a fourth provider takes under one day and touches no core logic **(P1)**
6. Every business rule in P3 is changeable from the admin panel without a
   deployment, and a grep for hardcoded reward rates, hold periods, and limits
   returns nothing **(P3)**
7. No business rule reads or writes a balance outside `RewardAccountingService`,
   enforced by CI — the migration path in P2 is still open at the end of the MVP
8. An admin can run daily operations without database access
9. Total monthly infrastructure cost is dominated by the VPS alone, with no paid
   SaaS dependency **(P4)**
10. Every abstraction in the codebase can name the present-tense problem it
    solves; every interface with exactly one implementation is one whose seam is
    justified in §1.1 **(P6)**
11. A new developer can trace a conversion from postback to withdrawable balance
    by reading the code, without a diagram **(P6)**

Growth, revenue, and user count are explicitly **not** MVP success criteria.
Correctness, optionality, and comprehensibility are.

---

## 10. Approval

This document defines the agreed scope.

- [x] **Scope approved at Rev 2.** Rev 3 adds P6 and applies it to the document's
      own content; it changes no scope, milestone, or deliverable.

Implementation still does not begin here — `ARCHITECTURE.md` comes next, and is
subject to the same approval gate.

**Change control:** after approval, any addition to MVP scope must remove
something of comparable size. Changes are recorded in this file's revision
history, not agreed verbally.

**Principle precedence:** the six principles in §1 outrank every other statement
in this document. If a later section, an ADR, or an implementation decision
conflicts with P1–P6, the principle wins and the conflicting text is the thing
that gets corrected. Where the principles appear to conflict with each other,
§1.1 governs.

### Revision History

**Rev 1** — Initial draft. *Superseded.*

**Rev 2** — *Superseded.*

- Reward accounting changed from a committed append-only ledger to an abstracted
  service interface (**P2**)
- Hold period made configurable globally and per provider; no fixed default in
  code
- **P3** (everything configurable), **P1** (provider independence), and **P4**
  (free-first) added as explicit project-wide principles
- Configuration service promoted to an M1 deliverable
- Risk register updated: R4 restated around the P2 trade-off, R5 added for the
  deferred accounting decision, subsequent risks renumbered

**Rev 3** — *Current — approved scope, pending ARCHITECTURE.md.*

- **P6 (Simplicity First)** added, constraining the abstractions authorized by
  P1–P4
- **§1.1** added: each mandated abstraction tested against P6 with its
  present-tense justification, and the rules for resolving principle conflicts
- P6 applied to this document's own content: per-offer-category hold overrides
  removed as speculative, leaving an extensible `provider → global` chain
- Configuration service explicitly bounded — a typed key-value store, not a rules
  engine
- Success criteria 10 and 11 added for simplicity and comprehensibility
- Scope approved by the user at Rev 2; Rev 3 changes principles only, not scope
