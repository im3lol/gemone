# TODO — Deferred Work

> **Purpose:** improvements identified during implementation that were **not
> needed to make the feature at hand correct**. Recording them here is what
> lets implementation stay scoped without losing what was learned.
>
> **The rule this file exists for:** if something prevents a bug in the feature
> being built, fix it now. If it is a general or future improvement, record it
> here with the reason and keep going.
>
> Every entry names its **trigger** — the concrete event that makes it worth
> doing. An item with no trigger is a wish, and a list of wishes is one nobody
> reads. Deleting an entry is as legitimate as doing it, provided the reason is
> written down.

Status: `open` · `unblocked` (the thing it waited for now exists) · `blocked`

---

## Configuration (P3)

### T1 — Move `PASSWORD_POLICY` into the ConfigurationService
**Status:** unblocked · **Owner module:** `auth` · **Raised:** Feature 3

`auth.constants.ts` holds `minLength` and `maxLength` as literals. P3 permits
code to define a *default*; it does not permit code to define the value in
force, and today these are the value in force. They were written before
`ConfigurationService` existed (ARCHITECTURE.md §24 sequences M1 in that
order), which was the correct trade at the time and is no longer.

Gathered in one file and read from exactly one place, so migrating is
mechanical rather than a hunt — that is the mitigation, not an excuse.

**Trigger:** the next feature that touches `auth`, or M2 at the latest.

### T2 — Login throttling (ARCHITECTURE.md §8.3)
**Status:** DONE · **Owner module:** `auth` · **Raised:** Feature 3 · **Closed:** Feature 17

Two counters, per account and per address, in Redis, with thresholds and windows
as configuration keys (P3). The account bucket is keyed by a hash of the
normalized email rather than by a user id, so an unregistered address throttles
exactly like a registered one — keyed by id it would never throttle at all, and
the lockout itself would answer the question the shared error code and the decoy
verification exist to hide. Increments, resets and the deliberately surviving IP
counter are D73.

**The review of this feature found that the other half of that sentence was not
true** — the decoy hash `AuthService.login` verifies against for an unknown
address was not a valid argon2 string, so it cost nothing and the endpoint
answered ~8ms for an unknown address against ~36ms for a known one. Present
since Feature 3, and closing T2 on top of it would have left this entry claiming
a property the system did not have. Fixed and covered by tests in D74.

**`core/cache` was not a dependency, and saying so was this entry's mistake** —
the same mistake T3 made. The counters need a Redis connection, which the
application has had since Feature 2; they do not need a cache abstraction, and
they positively should not share one, because a cache degrades open (§14.4)
while this control fails closed (§15.4).

**One limitation it introduces is recorded as T60**, not hidden: failing closed
means a Redis outage stops every login, including the one belonging to whoever
would fix it.

---

## Multi-replica correctness

### T3 — Redis pub/sub cache invalidation (ARCHITECTURE.md §14.3)
**Status:** DONE · **Raised:** Features 4 and 5 · **Closed:** Feature 14

`core/events` owns one channel, `ow:1:invalidation`. `ConfigurationService` and
`ProvidersService` each register a handler on it and broadcast after a write;
both keep a local-only method for the boot sequence, the subscriber, and the
read-repair paths (D62).

**The blocker in the status line above was wrong**, and unblocking it meant
saying so rather than building `core/cache` — nothing here caches anything, and
§14.1's cache still has no consumer (D58).

**Reproduced as fixed, live**, against the same scenario this entry recorded:

```text
worker prices the catalog at 30%          →  73 pts
PUT /admin/configuration/offers.reward_share_percent → 60   (api process)
worker re-prices, no restart              →  147 pts
```

Three things the entry did not anticipate, each now a decision:

- **The channel is best-effort.** No persistence, no backlog, no
  acknowledgement. A reconnect therefore drops every cached copy, because a
  subscriber that was away cannot tell "nothing changed" from "everything did"
  (D61). The existing periodic re-reads stay for the same reason.
- **A publish must not fail the write** (D59). Verified by stopping Redis: the
  admin write answered 200 in 67ms with the failure logged.
- **An unreadable message invalidates everything** (D60), which is what makes a
  rolling deploy safe.

Also closed by it: T14, whose trigger named this feature.

**Superseded reasoning below.**

Two in-process caches invalidate locally only:

- `ConfigurationService` — an admin's change applies on the writing replica
  and at next boot elsewhere.
- `ProviderRegistry` — same, for enabling and disabling a provider.

With one replica both are **correct**. With more than one, §7.3's promise that
"cutting off a misbehaving provider takes seconds and no deploy" is true on one
replica only, which is the kind of half-true that gets discovered during the
incident it was supposed to help with.

The seams are already public and single-method — `ConfigurationService.invalidate()`
and `ProviderRegistry.load()`. A subscriber calls them; nothing else changes.

**Escalated in Feature 13 — the original trigger was wrong.**

It read "the second `api` or `worker` replica. Not before." There has been a
second process since Feature 2: `api` and `worker` are two processes from one
image, and they are what `docker-compose.yml` starts. The entry was written as
though the split did not count.

Until Feature 13 this was nearly harmless, because changing a value required a
developer with a database connection — and a developer changing configuration
restarts things. The admin surface removed exactly that. **Reproduced live:**

```text
PUT /admin/configuration/offers.reward_share_percent  →  50
GET  (api process)                                    →  50
catalog re-sync (worker process)                      →  priced at 85
```

The admin panel confirms a change the worker is not applying, and the worker is
where conversions are priced and credited. Nothing warns anybody; the only
symptom is two numbers that should match and do not.

**Scope note:** Feature 13 was explicitly scoped to "live reload where already
supported", so this was demonstrated rather than fixed. It is now the largest
open correctness gap in the system.

**Trigger:** before any public deployment, with T2. Not "the second replica" —
the second process already exists.

---

## Shared primitives

### T4 — `shared/value-objects/Money`
**Status:** open · **Raised:** Feature 5

Minor-unit conversion currently lives inside the mock adapter, with a
documented two-decimal assumption and an explicit rejection of currencies that
do not fit it (JPY is refused rather than silently wrong by a factor of 100).

One caller does not justify a shared value object (P6). Two adapters
reimplementing decimal-string parsing does justify it — and the second
implementation is where the rounding bug will be.

**Trigger:** the second adapter that parses provider payouts, or the first
zero-decimal currency.

### T5 — CIDR matching for postback source IPs
**Status:** DONE · **Raised:** Feature 5 · **Closed:** Feature 8

The trigger fired exactly as written — the postback intake surface arrived and
needed the matching half. `ipMatchesRange` / `ipMatchesAnyRange` were added
next to the validator, still hand-written and still without a dependency.

One thing the note did not anticipate, found while writing it: a Node server
on a dual-stack socket reports an IPv4 client as `::ffff:203.0.113.10`, so the
matcher has to unwrap the IPv4-mapped form or every postback from a provider
publishing ordinary IPv4 CIDRs is refused — on some deployments and not
others.

---

## Testing and enforcement

### T6 — Roll integration tests back in a transaction (ARCHITECTURE.md §18.3)
**Status:** open · **Raised:** Feature 4

The suite runs `fileParallelism: false` because parallel files truncate each
other's tables. §18.3 describes the better answer — each test inside a
transaction that rolls back — which requires the application to accept a
caller-supplied transaction throughout. Several services already do.

Serial execution is the simpler thing that is correct today (P6).

**Trigger:** the suite becoming slow enough that someone complains. It is
currently ~20 seconds.

### T7 — dependency-cruiser rule set (ARCHITECTURE.md §4.4, mechanism 2)
**Status:** open · **Raised:** Feature 5

Of §4.4's three enforcement mechanisms, two exist: `eslint-plugin-boundaries`
and `provider-independence.spec.ts`. The provider rules (§5 rules 6 and 7) are
covered twice over by those, so the third mechanism would currently add
overlap rather than coverage.

Its distinct value is cycle detection across the whole graph, which neither of
the others does.

**Trigger:** the first import cycle, or a boundary that neither existing
mechanism can express.

### T8 — `arch.spec.ts` for the reward tables (ARCHITECTURE.md §4.4, mechanism 3)
**Status:** blocked on `rewards` · **Raised:** Feature 5

"Nothing outside `modules/rewards` references `user_balances` or
`reward_transactions`" is called the single most important rule in the
codebase. It cannot be asserted before the tables exist.

`provider-independence.spec.ts` is the working template for it.

**Trigger:** the `rewards` module.

### T11 — Automate the queue-delivery leg of the catalog jobs
**Status:** open · **Raised:** Feature 6

`worker-jobs.spec.ts` proves that the tick enqueues the right job and that the
processor turns that job into a synced catalog. What it does not prove in CI is
that BullMQ *delivers* a job it accepted.

Every attempt to test that in-process failed intermittently, and none of the
failures were in the code: a worker started by the module keeps running between
tests, so it races each test's cleanup; `pause()` works but `resume()` does not
reliably restart its fetch loop; and a retry from an earlier test becomes ready
in the middle of an unrelated one. An intermittently failing test is worse than
no test — it trains everyone to re-run the suite.

Verified against the real two-process deployment instead, where the catalog
populated from a scheduled tick with no manual trigger.

**What it would take:** a worker the *test* constructs and closes, rather than
one the module started — `autorun: false` on the processor, or a plain BullMQ
`Worker` bound to the same handler.

**Trigger:** the second queue consumer, when the pattern has to be repeatable.

### T12 — Deduplication and ranking of the offer catalog
**Status:** open · **Raised:** Feature 6

ARCHITECTURE.md §7.5 assigns three things to the catalog: normalization,
deduplication and ranking. This feature built the first.

**Deduplication** groups offers by a fingerprint of normalized title,
advertiser and target application, keeps the one paying the user most, and
retains the losers so a runner-up can be promoted when a provider goes down.
It is not built because it was not in the feature's scope, and because the
fingerprint needs `advertiser` and `targetApplicationId` — fields the adapter
contract does not carry, so building it would mean amending a contract that
was approved one feature ago.

**Ranking** orders the wall by user-visible reward, adjusted by an
admin-settable per-provider weight and manual pinning. DATABASE.md §3.2 lists
the columns for it. They are deliberately absent rather than present and
unpopulated: a column nothing writes is one the next feature has to backfill,
and an empty column looks like a bug.

**The trigger fired in Feature 15 and was deliberately not taken.** The wall
exists; both are still deferred, and the reasons sharpened rather than
disappeared.

**Ranking** is now buildable and was scoped out on purpose. The wall orders by
`rewardPoints` with `externalId` as a tiebreaker, which is the ordering a user
would choose anyway — highest paying first. What ranking adds is *our* thumb on
the scale: a per-provider weight and manual pinning. That is a commercial
control, and shipping it before there is a second real provider means tuning a
weight between one network and itself.

**Deduplication** is still blocked on the same thing it was blocked on in
Feature 6, and Feature 15 did not change it: the fingerprint needs `advertiser`
and `targetApplicationId`, which `OfferProviderAdapter` does not carry. Adding
them amends a contract approved in Feature 5 and touches every adapter — which
is a decision of its own, not a detail of the wall.

**What Feature 15 did change:** the wall is now the thing that would *show*
either of them, so both are testable end to end the moment they land, and
neither requires guessing what the surface will look like.

**Trigger:** the second real provider adapter — the first moment a weight
between two networks means anything, and the first moment two catalogs can
contain the same campaign. Deduplication additionally needs the contract
amendment decided first.

### T13 — Retention for `offer_sync_runs`
**Status:** open · **Raised:** Feature 6

DATABASE.md §7 gives the table bounded retention; nothing prunes it yet. One
row per provider per sync interval is roughly 24 rows per provider per day —
slow enough that it is not a present-tense problem (P6), and unbounded is still
unbounded.

**Trigger:** the `cleanup-expired` job (§12.1), which is where this belongs.

### T14 — A guard against a stale registry reload overwriting a fresh one
**Status:** DONE · **Raised:** Feature 6 · **Closed:** Feature 14

The trigger fired exactly as written — T3 landed, and a remote invalidation now
arrives at a moment nothing chose, so a reload can begin in the middle of
another one.

`ProvidersService` chains reloads instead of versioning snapshots (D63). That is
a stronger guarantee than this entry asked for: two reloads cannot overlap at
all, so there is never a pair of snapshots in flight to order wrongly, and there
is no version for a future writer to forget to stamp.

One thing the entry did not anticipate: the chain has to survive a *rejected*
reload, or one transient database error freezes the registry for the life of the
process. There is a test for that specifically.

**Superseded reasoning below.**

`ProviderRegistry.load()` swaps in whatever rows it was handed. Two concurrent
reloads whose queries returned different snapshots can therefore finish in the
wrong order, leaving the registry briefly describing an older state.

Self-healing today: the scheduled path reloads before every decision, so the
window closes at the next tick. A version or timestamp on the snapshot would
close it outright.

### T15 — Redis velocity counters for the click limit
**Status:** open · **Raised:** Feature 7

The per-user and per-IP click limits count rows over a one-hour window. Exact,
simple, and correct today (D21) — but it is two indexed counts on the click
path, and `clicks` is the table that grows fastest.

**Trigger fired and deliberately not taken (Feature 12).** `fraud` now needs
the same velocity numbers at conversion time, and counts them in Postgres for
the reasons D49 gives — chiefly that a lost or expired Redis counter
under-counts silently, and the failure looks exactly like a clean account. The
"one shared counter" argument is still correct and is now the argument for
building it once, properly, rather than twice under time pressure.

There are now **three** call sites that would share it: the per-user click
limit, the per-IP click limit, and the two fraud velocity rules.

**Trigger:** the counts becoming a measured cost on either path.

### T16 — Rotating `CLICK_SIGNING_SECRET` invalidates outstanding clicks
**Status:** open · **Raised:** Feature 7

Every live `sub_id` is signed with the current key, and attribution windows run
for thirty days. Rotating the key makes every outstanding click unverifiable,
so conversions still in flight for them would be quarantined as forged.

Not a bug — it is what signing means — but it is an operational constraint that
is invisible until someone rotates a secret on a routine schedule.

**What it would take:** accept a list of keys, sign with the first and verify
against any, so a rotation overlaps by one attribution window.

**Trigger:** the first planned secret rotation, or any incident requiring one.

### T17 — Geo and device eligibility at click time
**Status:** blocked on geo-IP · **Raised:** Feature 7

Offers carry country and device targeting; clicks do not check either (D23).
There is no geo-IP source, and enforcing on `users.registration_country` would
refuse a legitimate traveller.

The click's IP is already recorded, so this becomes available the moment a
lookup does — and `fraud`'s geo-mismatch rule (PROJECT.md §4.7) needs the same
source, so they should arrive together.

**Trigger:** a geo-IP provider behind the cache §14.1 reserves for it.

### T18 — `user_devices` and device correlation
**Status:** blocked on `fraud` · **Raised:** Feature 7

Clicks store a client-supplied `device_fingerprint` as evidence. DATABASE.md
§11 gives `users` a `user_devices` table, and §9.2 lists "multi-account
detection: `user_devices` by fingerprint" as a known access path.

**Trigger fired and deliberately not taken (Feature 12).** `fraud` scores the
fingerprint now, through `ClicksService.countOtherAccountsSharingDevice()`,
which asks `clicks` the same question `user_devices` would answer — and answers
it identically, because `clicks` still holds every fingerprint ever seen.

A `user_devices` table would add a write to the click path and a second copy of
data that is not yet lossy. It stops being equivalent the moment `clicks` is
pruned or partitioned, because the correlation window would then be bounded by
click retention rather than by the fraud window — which is a real difference and
a real trigger, rather than the module boundary this entry originally used.

**Trigger:** T19 (retention for `clicks`), or a measured cost on the
fingerprint scan.

### T19 — Retention for `clicks`
**Status:** open · **Raised:** Feature 7

DATABASE.md §7 gives high-volume tables bounded retention, and §9.3 names
`clicks` as a first partitioning candidate. Nothing prunes or partitions it.

Deliberately untouched: a click is the evidence behind a support ticket, and
the retention window is a policy question (how long can a user dispute?) rather
than a technical one. **The trigger is measured query degradation, not table
size in the abstract** (§9.3).

**Trigger:** the `cleanup-expired` job (§12.1), with a retention period decided
alongside the support policy.

### T20 — A partial index on unprocessed postbacks
**Status:** open · **Raised:** Feature 8

DATABASE.md §9.2 asks for the processing-backlog index to be **partial** —
only unprocessed rows. Prisma cannot express one, and hand-writing it into the
migration would put it outside the schema, where the next `prisma migrate dev`
would generate a drop for it.

Shipped as a plain composite `(state, received_at)`. It is selective enough
while `RECEIVED` is the minority, which it is whenever processing is keeping
up — and when processing is *not* keeping up, an index is not the problem.

**What it would take:** a raw-SQL migration plus whatever Prisma's story for
unmanaged indexes is by then.

**Trigger:** measured cost of the backlog query, not table size in the
abstract (§9.3).

### T21 — Replay unprocessed postbacks from the archive
**Status:** open, unblocked · **Raised:** Feature 8 · **Unblocked:** Feature 9

The consumer now exists (D27 closed), so this is buildable and still is not
built. Two paths lead to a `RECEIVED` row with no live job: an enqueue that
failed while Redis was unavailable, and a job lost from Redis, which is not
durable storage. A third arrived with processing: a `QUARANTINED` row whose
reason has since stopped being true, which an admin resolves by putting it back
to `RECEIVED` — done by hand today, and proven to work end to end.

`provider_postbacks` is the replay source §10.1 designed it to be, so the fix
is a query — `state = 'RECEIVED'` older than N minutes — and a re-dispatch.
The natural-key `jobId` already makes re-dispatching an existing job a no-op,
so it can run on a schedule without any bookkeeping of its own.

Deliberately still not built: the replay path is exercised manually and the
sweeper that automates it wants an admin action beside it — "retry this row",
"retry everything quarantined for reason X" — which belongs with the review
screen rather than ahead of it.

**Trigger:** the admin quarantine queue's write actions.

### T22 — Header-signed postback schemes
**Status:** open · **Raised:** Feature 8

Archived headers are an allowlist (D28), so a provider that carries its
signature in a custom header would have that header dropped from the evidence
— it would still be *verified*, since the adapter reads the live request, but
a dispute could not be re-checked against the archive.

No adapter signs by header today. The fix when one does is one line: its
header name in `CAPTURED_HEADERS`, added alongside the adapter itself.

**Trigger:** the first adapter whose signing scheme reads a header.


### T23 — Archive `rawBody` for body-signed schemes
**Status:** open · **Raised:** Feature 9

Processing re-parses the archived payload rather than trusting intake's parse
(D32), which is what makes "fix the adapter, then replay" real. The archive
stores the parsed query and body but not the undecoded bytes, so an adapter that
*parses* from `rawBody` could be verified at intake and never replayed.

No adapter does. Verification — the operation that genuinely needs the exact
bytes — happens at intake while they are still in hand, so nothing is broken
today; what is missing is the replay half, exactly as T5 was missing the
matching half of its range check.

**What it would take:** a `raw_body` column, bounded, written only when the
provider's scheme declares it signs the body. Storing it unconditionally would
double the size of the fastest-growing table for nothing.

**Trigger:** the first adapter whose signing scheme covers the request body.

### T24 — An explicit original-transaction reference for reversals
**Status:** open · **Raised:** Feature 9

A chargeback is matched to its original by click and amount, and ambiguity is
quarantined rather than guessed (D33). That is correct and it is not precise:
a multi-step offer with two identical payouts on one click produces a reversal
no rule can resolve, and a human has to.

The real fix is a field — the provider's own reference to the transaction being
reversed — on `NormalizedConversion`, populated by adapters whose networks send
one. Not added speculatively: a contract field no adapter fills is a field the
next adapter author has to guess the semantics of.

**Trigger:** the first real network whose chargeback payload names the original.

### T25 — A user-facing conversion history
**Status:** blocked on the reward flow · **Raised:** Feature 9

PROJECT.md §3.2 lists "see conversion history" as a user feature. Only the
admin surface exists.

Deliberate: what a user wants to know about a conversion is what it paid them,
and that answer does not exist until `RewardAccountingService` does. An endpoint
returning `reward_points` today would show a number that is owed, not credited —
which reads as a balance and is not one, on the screen where that
misunderstanding is most expensive.

**Trigger:** the reward flow.

### T26 — Provider status transitions on an already-recorded conversion
**Status:** open · **Raised:** Feature 9

A conversion recorded `PENDING` stays `PENDING`. If a network later confirms the
same event by re-sending it **with the same transaction id**, intake correctly
recognises a duplicate (that is the guarantee) and processing never runs again.

Networks that send a separate confirmation event with its own transaction id are
handled already — two postbacks, two conversions, one click, which the schema
supports by design.

Not solved speculatively, because every available fix weakens something real:
comparing payloads on a duplicate and re-enqueueing puts a payload diff in front
of the idempotency constraint, which is the single most important thing in the
database. The right answer depends on what an actual network does.

**Trigger:** the first integrated network that mutates an event in place.


### T27 — Schedule the nightly reconciliation, with an alert behind it
**Status:** DONE (scheduling) · **Raised:** Feature 10 · **Closed:** Feature 16

§12.1's `reconciliation` job now exists: nightly at 03:00 UTC on the
`maintenance` queue, paging every balance through
`RewardAccountingService.reconcile`, reporting drift and repairing nothing (R5).

**The half that landed** is the scheduling, the sweep and the detection. **The
half that did not is the alert** — nobody is paged. That is now T59 rather than
part of this entry, because it is a dependency on §17.3 and not on anything
about reconciliation.

This entry's deferral argument — "a drift detector that reports to nothing is
worse than none" — was reconsidered rather than ignored, and the reasoning is
in D71: `error`-level logging and BullMQ's failed set are not nothing, and the
cost of waiting was that R5's and §23.1's triggers for the P2 ledger decision
were conditions nothing could ever satisfy.

### T28 — Per-user reconciliation does not scale to a nightly sweep
**Status:** open · **Raised:** Feature 10

`reconcile()` aggregates one user's transactions. Over every user nightly that
is one aggregate per user, which is fine at launch scale and is not how it
should run at a million.

The shape that scales is a single grouped query comparing `user_balances`
against `SUM(...) GROUP BY user_id` over `reward_transactions`, with the
per-user call kept for investigating one account.

Not written now because the correct query depends on how the table is
partitioned or retained, and neither is decided.

**The T27 half of the trigger fired in Feature 16 and was deliberately not
taken.** The sweep that shipped is the per-user loop this entry describes,
bounded to 200 balances per job and re-enqueued with a keyset cursor, which is
correct and paged but is still one aggregate per user. It was left that way
because this entry's actual blocker has not moved: the grouped query's shape
depends on partitioning and retention, and neither is decided. Deciding them to
avoid a loop that is fine at launch scale would be building for a load that does
not exist (P6).

**The per-user read then got 3.2× more expensive, and that is measured.** Fixing
the false-positive drift bug (D72) put the three reads inside one
`RepeatableRead` transaction. Over 300 sequential reconciles on a quiet
database:

| | per reconcile |
|---|---|
| before — three concurrent queries | **2.03 ms** |
| after — one snapshot behind `BEGIN`/`COMMIT` | **6.54 ms** |

The baseline overlapped its three queries; the snapshot serializes them on one
connection and adds the transaction's round trips.

**The trade is accepted and is not what this entry is asking to undo.** The
sweep's entire output is evidence for the P2 ledger decision (R5), and a cheap
read that reports drift on a consistent ledger is worth less than no read at
all. Reverting the isolation level to buy the 4.5ms back would reintroduce the
bug D72 exists to remove.

**It strengthens this entry's case without changing its trigger.** The grouped
query proposed above would recover the cost and the consistency together — one
statement is atomic by definition, so it needs no transaction at all — which
makes this the rare deferral where the scaling fix and the correctness fix are
the same piece of work. What it does *not* do is move the trigger: the blocker
is still that the query's shape depends on undecided partitioning and retention,
and 6.54ms per user is still comfortably inside a nightly window at any scale
this platform has. It only means the window closes sooner than the old numbers
implied — roughly 109 minutes for a million balances where the previous cost
suggested 34.

**Trigger:** the first reconciliation run that takes longer than its window —
which is now a measurable thing rather than a hypothetical one, because the run
logs `checked` on every page.

### T29 — Admin actions on held points and manual adjustments
**Status:** DONE · **Raised:** Feature 10 · **Closed:** Feature 12

A conversion held for review credits points that never mature (D39). Nothing
can currently clear one, so those points are stranded — deliberately, since the
accounts producing them are not active, but permanently, which is not the
design.

The trigger fired the moment `fraud` shipped: an engine that holds conversions
and cannot release them strands real users' points by design rather than by
accident, so the way out had to arrive with the thing that fills the queue.

`POST /admin/fraud/held/:id/review` resolves a hold — `CLEAR` matures the
credit, `CONFIRM` reverses it — and the status change, the balance movement and
the audit entry commit in one transaction. The service side needed nothing new:
`mature()` and `reverse()` were already there and already idempotent, which is
why a second clear is a 409 rather than a second credit.

**Still deferred:** free-standing manual adjustments (`MANUAL_ADJUSTMENT`
credits and debits with no conversion behind them). Nothing needs them yet, and
"an admin can move points for a reason they type in" is a surface that wants a
policy before it wants an endpoint. Folded into T35's trigger.

### T30 — Partial reversals
**Status:** open · **Raised:** Feature 10

`reverse()` takes back a whole credit. PROJECT.md §4.5 names partial reversals
as one of the business rules that are not yet understood, and it is right: no
provider has shown us one.

Implementing it speculatively would mean deciding now whether a partial
reversal is one row or several, how it interacts with maturation of the
remainder, and what "already reversed" means — decisions P2 exists to defer
until there is evidence.

**Trigger:** the first provider that charges back part of a conversion.


### T31 — Per-method withdrawal limits
**Status:** blocked on a configuration scope · **Raised:** Feature 11

PROJECT.md §1's P3 list and §4.6 both name "per-method limits" alongside the
global minimum and maximum. Only the global ones are implemented.

The blocker is real rather than effort: `ConfigScopeType` is `GLOBAL |
PROVIDER`, and a per-method limit needs a third scope. Adding one is a Postgres
enum migration plus a resolution-chain change in `core/config` — a core change,
for a feature that currently ships with one payout method whose economics are
the global ones.

Encoding it as key-per-method (`payouts.minimum_points.paypal`) was rejected:
it puts a value's scope inside its name, which is exactly what the scope
mechanism exists to avoid, and the admin configuration screen would list a
different set of keys depending on what an admin had enabled.

**Trigger:** a second payout method whose minimum or maximum genuinely differs —
a crypto method with a network fee floor is the likely first one.

### T32 — Fraud score and shared-device signals on the payout review screen
**Status:** DONE · **Closed:** Feature 12 — `PayoutReviewContext.fraud` now
carries peak score, latest score, flagged count and every rule ever triggered
for the account, which covers both halves §11.3 asked for: the score, and the
shared-device/shared-IP signals (those *are* two of the rules). Null rather than
a zeroed summary when an account has never been scored — `peakScore: 0` would
read as "we looked and found nothing".

**Superseded detail below, kept for the reasoning.**
**Status:** blocked on `fraud` · **Raised:** Feature 11

§11.3 lists what an admin sees alongside a request: "fraud score, conversion
history, chargeback rate, account age, and any shared-device or shared-IP
signals". The review context carries account age, account status, all three
balance buckets, conversion count, chargeback count and prior paid payouts.

The fraud score is **deliberately absent rather than defaulted**. `fraud` does
not exist, and a number on a review screen that nothing computes is worse than
no number — an admin would weigh it. Shared-device and shared-IP signals are
reachable today through `GET /admin/clicks?ipAddress=…`, which already answers
"who else clicked from here?"; what is missing is having them on this screen
rather than one hop away.

**Trigger:** the `fraud` module, for the score; the admin UI, for composing the
signals that already exist.

### T33 — Notify the user when a payout is rejected or fails
**Status:** blocked on `notifications` · **Raised:** Feature 11

§11.3: "Failed external payment → `FAILED`; the lock is released **and the user
is notified**." PROJECT.md §4.6 step 7 wants every status transition visible to
the user.

Half of it is done — every transition is on `GET /payouts`, with its reason, so
a user who looks can see what happened. The push half needs `notifications`,
which is its own module and deliberately out of scope.

**Trigger:** the `notifications` module.


### T35 — There is no admin surface for configuration at all
**Status:** DONE · **Raised:** Feature 12 · **Closed:** Feature 13

`GET /admin/configuration` lists all twenty-nine keys with the value in force
and where it came from; `GET :key` adds every explicit setting, the timeline,
and the chain resolved for a named provider; `PUT :key` sets one; `POST
:key/reset` removes one. Admin-only, reason mandatory, and every change writes
both records §3.7 asks for.

The three open questions this entry said the feature could not decide alone
were answered: scope is chosen per write (not per screen), a JSON-valued key is
edited as JSON validated by the key's own schema, and a reason **is** required —
`configuration_history.reason` had been nullable and unused since Feature 4.

**Not closed by it:** T3. The admin surface is what turned that from a
theoretical multi-replica note into a reproducible correctness gap, because the
`worker` process keeps serving its own cached copy. See T3.

**Superseded reasoning below.**

`ConfigurationService` has `get`, `set`, `register`, history and an effective-
value resolver. Nothing exposes any of it over HTTP. Twenty-nine registered keys
— reward rates, hold periods, withdrawal limits, click windows, and now twelve
fraud keys — are settable only by a process with a database connection.

P3 says the value in force is never in code. That half is honoured: every value
is a row, and code only supplies defaults. The other half is not:

> **PROJECT.md §4.7** — "Rules can be enabled, disabled, and retuned **from the
> admin panel without a deployment** — which matters because fraud patterns
> change faster than release cycles."
>
> **PROJECT.md §3.2** — an admin can "adjust reward rates, hold periods,
> withdrawal limits, daily limits, fraud thresholds, currencies — without a
> developer."

Today that adjustment requires a developer.

**Why it was not built here.** It is a `core/config` and `admin` surface serving
every module's keys, not a fraud one — the same gap existed at Features 5, 6, 7,
9, 10 and 11, each of which registered keys and shipped. Building it inside the
fraud feature would be the largest scope expansion in the project so far, and it
needs decisions this feature cannot make alone: whether a scope is chosen per
key or per screen, how a JSON-valued key is edited, and whether changing a
threshold requires a reason (it should — `configuration_history` already has the
column).

**Two things make it more urgent now than it was.** Fraud thresholds are the
first configuration that is *expected* to be tuned continuously rather than set
once; and a replica reads its own in-process cache (T3), so even a direct write
only takes effect on the writing process until the others restart. During the
live walkthrough of this feature, retuning one threshold required restarting the
worker.

**Trigger:** before any public deployment — this is the second entry here, with
T2, that is an operational gap rather than an improvement. Folding in T29's
remaining half (manual balance adjustments) makes sense once it exists.

### T37 — Related keys cannot be changed atomically
**Status:** open · **Raised:** Feature 13

Each write is one key. Some rules only make sense together:
`offers.accounting_currency` and `offers.points_per_minor_unit` are calibrated
for each other, and between two requests there is a window where the catalog
would sync with a rate meant for the previous currency.

Narrow, and not silent — the sync run records what it accepted and rejected, and
the currency guard in `conversions` quarantines rather than mispays. But it is
the same problem D48 solved inside the fraud module by making a rule's settings
one key, and the answer here is the same shape: a batch endpoint writing several
keys in one transaction, with one reason and one audit entry.

Not built now because two keys is the only pair that currently has this
relationship, and a batch endpoint is a second write path to reason about for a
problem with one instance.

**Trigger:** a third key joining a calibrated set, or the first incident caused
by a half-applied change.

### T38 — Configuration writes take no row lock
**Status:** open · **Raised:** Feature 13 review

`set()` and `unset()` now read the previous value inside their transaction
(D56), so the history row and the audit entry record what was actually stored
rather than what a process last cached. They still take no row lock, so two
writes landing simultaneously each report the value they read:

```text
admin A: 10 → 20   (history: 10 → 20)
admin B: 10 → 30   (history: 10 → 30)   final value: 30
```

Both changes are recorded with their reasons and the order is recoverable from
the timestamps, so nothing is lost — but the second row claims a base value that
was already gone.

**Not fixed now** because the cost is audit precision only. The value in force is
settled atomically by the upsert, and the equivalent race on `unset` no longer
produces an error at all. Adding `SELECT … FOR UPDATE` — as the payout
transitions do — would serialise every configuration write for a problem that is
cosmetic in a table written a few times a week.

**Trigger:** a second admin account (configuration is single-writer until then),
or any incident where a change's provenance is actually disputed.

### T39 — Nothing checks stored configuration against its schema at boot
**Status:** open · **Raised:** Feature 13 review

A stored value that no longer satisfies its key's schema is ignored on read and
logged at `error` (D55), so the chain falls through instead of feeding a
malformed value to a business rule. That is the safe behaviour, and it is
detected **at first read** — which may be in the worker, hours after the deploy
that caused it, in whichever process happened to touch the key first.

A scan at `onApplicationBootstrap` over `configuration_values` against the
registered definitions would turn that into a deploy-time signal: one log line
per bad row, naming the key and the scope, before any traffic arrives.

**Deliberately not built with the fix**, which was scoped to the two blockers.
Also worth deciding rather than assuming: whether a bad row should *refuse the
boot* — safe for a small platform, and exactly the wrong behaviour during an
incident when the priority is getting a process up.

**Related risk this would also surface:** falling back can be less conservative
than the operator intended. An admin who lowered `payouts.maximum_points` and
whose row later became invalid silently gets the more permissive default back.
The `valid: false` flag on the admin API shows it on the screen; nothing shows
it to an operator who is not looking.

**Trigger:** the first schema change to a key that already has stored values —
which is also the first time this can happen at all.

### T40 — `unset()` does not repeat `set()`'s PROVIDER-scope guard
**Status:** open · **Raised:** Feature 13 review

`set()` refuses `PROVIDER` scope with no scope id (`configuration.service.ts`),
because the empty string is GLOBAL's sentinel and a `(PROVIDER, '')` row would
be a scope that resolves for nobody. `unset()` checks only that the scope is
permitted for the key, so the same call falls through to `scopeId = ''`.

**It is safe today only by consequence, not by construction.** No `(PROVIDER,
'')` row can exist — `set()` is the only thing that creates rows and refuses to
create that one — so the delete matches nothing and the call is a no-op. The
admin surface never reaches it either: `assertScopeTargetExists` requires a
provider id before `unset()` is called.

That makes it a latent inconsistency rather than a bug, which is why it is here
instead of fixed: the fix is four lines, but adding them now means changing the
service that Feature 13 just closed for a path nothing can take.

**Trigger:** a third configuration scope (T31 would add one), or any second
caller of `unset()` that is not the admin service.

### T41 — `previousValue` conflates "nothing stored" with a stored null
**Status:** open · **Raised:** Feature 13 review

`WrittenConfiguration.previousValue` is `previous ?? null`, so the admin audit
entry's `before` reads `null` both when there was no override and when the
override's value was JSON `null`.

`configuration_history` is unaffected and keeps the distinction correctly —
`Prisma.DbNull` for "no row before" versus the stored value — which is the
record that matters for provenance. The audit log is the per-admin index and
loses one bit of it.

**Currently unreachable:** no registered key has a schema that accepts `null`,
so the two cases cannot both occur. It becomes real the moment one does.

**Trigger:** the first configuration key whose schema admits `null`.

### T42 — `overrideCount` counts rows the chain will not use
**Status:** open · **Raised:** Feature 13 review

`overrideCounts()` counts rows in `configuration_values`. Since D55 a row that
no longer satisfies its key's schema is ignored on read, so the list screen can
show `overrideCount: 1` beside `source: default` with nothing explaining the
contradiction — the `valid` flag that explains it is on the detail response
only.

Deliberately not fixed by filtering the count: the row *is* an override
somebody set, and hiding it from the count would make the list agree with the
resolver by making the row invisible, which is the opposite of what D55 chose.
The honest fix is a second number — "1 override, 1 not in use" — which is a
contract change for a case that cannot happen until T39's trigger fires.

**Trigger:** T39 — the first schema change to a key with stored values. They
are the same event seen from two screens.

### T43 — The configuration list resolves one key at a time
**Status:** open · **Raised:** Feature 13 review

`AdminConfigurationService.list()` calls `resolve()` per definition inside
`Promise.all`, which is one `findUnique` per key on a cold cache — twenty-nine
concurrent queries today. `detail()` has the same shape in miniature: it runs
`overrideCounts()`, a `groupBy` over the whole table, to obtain one key's count.

First call only; every subsequent one is served from the in-process cache.
Correct, and wasteful in a way that a single
`findMany({ where: { key: { in: [...] } } })` would remove without changing any
behaviour.

**Trigger:** a measured cost, or the key count outgrowing the connection pool —
whichever a profile shows first (§9.3's rule: measured degradation, not size in
the abstract).

### T44 — The configuration timeline is capped with no cursor
**Status:** open · **Raised:** Feature 13 review

`history()` takes `min(limit, 200)` and offers no offset or cursor, while
`configuration_history` is never deleted (DATABASE.md §7). A key changed a
thousand times has nine hundred entries no API call can reach.

Not a data-loss problem — the rows are there and §3.7's record is intact — but
it is a truncation the response does not announce, on the surface whose whole
purpose is answering "who changed this, and when".

**What it would take:** keyset pagination on `(created_at, id)`, which the
`@@index([key, createdAt])` already supports.

**Trigger:** the first key to exceed 200 history entries, or the admin UI
building a timeline view.

### T45 — `set()` logs before the caller's transaction commits
**Status:** open · **Raised:** Feature 13 review

When a caller owns the transaction, `ConfigurationService.set()` writes
"Configuration value changed" after the write but before the commit it does not
control. If the caller then fails — the admin service's audit entry is the one
statement that could — the transaction rolls back and the log line stays,
asserting a change that never happened.

`unset()` has the same shape. The write itself is correct in both: the value,
its history row and the audit entry commit together or not at all (§3.7).

**What it would take:** returning the log intent to the caller, as the
invalidation already is (D51) — the caller owns the commit, so it owns
everything that must not happen before one.

**Trigger:** the first investigation misled by it, or a second caller that owns
its own transaction.

### T46 — `detail(key, scopeId)` does not check that the provider exists
**Status:** open · **Raised:** Feature 13 review

`set()` and `reset()` both call `assertScopeTargetExists`, so a typo in a
provider id is a 404 rather than an override that resolves for nobody. The read
path does not: `GET /admin/configuration/:key?scopeId=<any uuid>` answers with
`resolvedForScope` computed for a provider that may not exist, and the answer —
the GLOBAL value — is indistinguishable from the correct one for a provider
with no override.

Harmless in itself, and inconsistent in a way that matters on this surface
specifically: the reason `assertScopeTargetExists` exists is that a scope
nobody can see is a scope nobody can debug.

**Trigger:** the admin UI, which will call this endpoint with an id the user
picked rather than typed — at which point the check is either redundant or the
only thing catching a stale link.

### T47 — There is no `.dockerignore`, so the image cannot be built
**Status:** DONE · **Raised:** Feature 14 · **Closed:** deployment pass

`.dockerignore` exists and excludes `node_modules`, `dist` and `.git`; the build
stage sets `CI=true`, which is what the pnpm error below asks for. All three
images (`api`, `migrate`, `web`) have been built from a working tree that has
`node_modules`, and CI builds and pushes them on every merge to `main` (§20.2).
The rest of this entry is kept for the reasoning.

`docker compose build api` fails on any working tree that has `node_modules`.
`COPY . .` copies the host's, whose symlinks point at a pnpm store that does not
exist in the image, so pnpm's dependency check decides the modules directory
must be purged and aborts:

```text
[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules
directory due to no TTY
```

**Pre-existing and unrelated to this feature** — it fails during dependency
installation, before any application code is compiled. Found because this
feature's live verification wanted the real two-process deployment; the
verification was done with two local `node dist/*.js` processes instead, which
is what every previous feature's walkthrough used and which exercises the same
two module graphs over the same Postgres and Redis.

**What it would take:** a `.dockerignore` with `node_modules`, `dist`, `.git`
and the log files. Possibly `CI=true` in the build stage as well, which is what
the error message itself recommends.

Not fixed here because the deployment artifact is not this feature's scope, and
because a `.dockerignore` written without running the image is a guess. It wants
one change and one verified build.

**Trigger:** the first deployment, or CI building the image — whichever comes
first. This is an operational gap, not an improvement.

### T48 — Nothing reports that a process stopped hearing invalidations
**Status:** open · **Raised:** Feature 14

A process whose invalidation subscriber is down serves whatever it last cached.
The mitigations make that bounded rather than silent — the disconnect is logged
at `warn`, a reconnect drops every cached copy (D61), and `RedisReadinessCheck`
already fails while Redis is unreachable — but there is no signal for the one
case none of those covers: **Redis is up, and this process's subscription is
not.** The initial `subscribe()` failing at boot is the way in; it logs at
`error` and the process serves traffic.

Readiness deliberately does not include it. §14.4 says cache failures degrade
rather than fail, and a process that refuses traffic because a *notification*
channel is down converts a degradation into an outage. The right shape is a
metric or an alert, not a probe — which means it belongs with §17.3's alerting
rather than ahead of it, the same argument T27 makes for reconciliation.

**Trigger:** the first alerting channel, with T27.

### T49 — One disconnect flag for two connections
**Status:** open · **Raised:** Feature 14 review

`InvalidationBus.reportedDisconnect` throttles connection-error logging to once
per outage, because ioredis re-emits `error` on every reconnection attempt and
the listener cannot be omitted — an `error` event with no listener terminates
the process.

It is one flag shared by the publisher and the subscriber, and only the
subscriber's successful resubscribe clears it. So a publisher blip raises it,
and a *subsequent* subscriber disconnect goes unlogged until the subscriber
resubscribes and clears it.

Costs log fidelity only, in the one place an operator would look to explain a
propagation failure — which is why it is written down rather than shrugged at.
Two flags, or one per connection object, is the whole fix.

**Trigger:** the first investigation into a propagation failure, or any change
to the bus's connection handling.

### T50 — A message arriving during shutdown still dispatches
**Status:** open · **Raised:** Feature 14 review

`establish()` checks `shuttingDown`; `receive()` does not. A message that lands
between `onApplicationShutdown` and the socket closing therefore reaches its
handlers, and `ProvidersService.reload()` issues a query against a Prisma client
that is disconnecting. The failure is caught and logged at `error`, so it is
noise rather than damage — but it is noise during every deploy, in the log
somebody reads when a deploy goes wrong.

**Trigger:** the first deploy whose logs are actually examined, or T48's
alerting, which would page on it.

### T51 — Queued reloads are not coalesced
**Status:** open · **Raised:** Feature 14 review

D63 serialises reloads, so two can never overlap. It does not merge them: N
invalidations queue N sequential reads of the provider table, even though any
one of them would produce the same snapshot as all N.

Bounded and harmless at the rates involved — one query at a time, and provider
changes are an operator action a few times a week. It becomes visible only under
a burst, and the burst that can actually happen is a rolling deploy that changed
the protocol version, where every write from a new process makes every old
process treat the message as unreadable and reload (D60).

Collapsing a queue of pending reloads into one is a few lines. Not written now
because a coalescing reload has its own correctness question — whether a reload
requested *during* the current read may be satisfied by it — and answering that
speculatively is how a subtle staleness bug gets introduced into the thing that
was built to remove one.

**Trigger:** a measured cost, or the first protocol-version change.

### T52 — The invalidation channel has no environment segment
**Status:** open · **Raised:** Feature 14 review

`ow:1:invalidation` follows §14.4's key convention exactly, and that convention
has no place for an environment. Two deployments sharing one Redis would
therefore exchange invalidations.

**Not a correctness problem**, which is why it is here and not in the review's
blocking section: a process that receives a foreign invalidation drops a cache
entry and re-reads it **from its own database**, so the value it ends up with is
right either way. The cost is wasted reads.

It is written down because the reasoning depends on invalidation being
idempotent and carrying no data — and the first message that carries a *value*
rather than a notification would turn this from waste into corruption. That is a
constraint on future changes to the message shape, not a defect in this one.

**Trigger:** any message that carries a value, or a deployment that shares Redis
between environments.

### T53 — The cache generation is global, not per entry
**Status:** open · **Raised:** Feature 14, second review

D65 stops an overtaken read from caching by comparing a generation counter
captured before its query. The counter covers the whole cache, so invalidating
one key also discards the write-back of every read in flight for *other* keys.

Conservative in the safe direction, and the entire cost is one extra query per
discarded read — at a few configuration writes a week, that is single-digit
queries. Per-entry generations would be precise and would introduce a second map
with its own lifetime, eviction question and opportunity to fall out of step
with the first, which is a worse trade at these rates (P6).

**Where it would stop being negligible:** a resync (D60, D61, D64) drops every
entry and bumps the generation once, so every read in flight at that instant
declines to cache and re-queries. That is bounded by the number of concurrent
requests, not by the key count — but it lands at the same moment every key is
already a miss, so it is the one situation where the coarseness and the miss
storm add up.

**Trigger:** a measured cost on the configuration read path, or a resync
producing a query burst somebody notices. Not table size or key count in the
abstract (§9.3).

### T54 — A connected but unresponsive Redis hangs an admin write
**Status:** open · **Raised:** Feature 14, third review

`InvalidationBus.publish()` awaits `publisher.publish(...)` with no command
timeout, and none is configured on the connection. `enableOfflineQueue: false`
covers the case D59 describes — a command issued while the connection is *down*
rejects immediately rather than parking in memory — but it does not apply to a
command already sent on an established connection.

So a Redis that accepts the connection and then stops answering — blocked on a
Lua script, forking for a `BGSAVE`, swapping — leaves the publish awaiting a
reply that never comes, and the admin request awaiting the publish. The database
transaction has already committed by then, so **the change is applied while the
request hangs**. The admin sees a timeout for a change that succeeded, and a
retry writes a second `configuration_history` row and a second
`admin_audit_log` entry for one intended change.

Reproduced deterministically with a publisher whose `publish` never settles:
`publish settled = false` after 250ms, against a connection reporting `ready`.

Affects `AdminConfigurationService.set` / `reset` and
`ProvidersService.reloadAndBroadcast`, which are the three admin write paths.

**Why it is deferred rather than fixed.** Every available mitigation is worse
than the problem at this scale:

- A command timeout turns a slow Redis into a *failed* broadcast, which is
  D59's degraded path — but it also means picking a number that is
  simultaneously long enough not to fire during an ordinary latency spike and
  short enough to matter to a waiting admin, and there is no measurement behind
  either bound yet.
- Not awaiting the publish would fix the hang and break D59: the failure could
  no longer be logged against the key it belongs to, and D64's recovery has
  nothing to record without a failure to observe.

Meanwhile the blast radius is small and bounded: three human-driven paths that
run a few times a week, no data corruption, and the duplicate history row a
retry produces is consistent with the existing decision that "an admin set this
again, for this reason" is a fact worth recording. Every automated path — every
configuration *read* on the request and job hot paths — is unaffected, because
nothing there publishes.

**Trigger:** the first observed Redis latency incident, or §17.3's alerting,
which would give the timeout a measured value instead of a guessed one. Should
be decided together with T48, which is the other half of "nobody finds out the
channel is unhealthy".

### T55 — A configuration row written directly in SQL is never noticed
**Status:** open · **Raised:** Feature 14, fifth review

`ConfigurationService` is the only thing that invalidates, so a
`configuration_values` row created, changed or deleted **outside** it is
invisible to every running process. The cached value keeps being served until
that key is written through the service or the process restarts.

Configuration has no second line of defence here. The provider registry does —
the catalog tick re-reads the table before every decision (D61's backstop), so a
provider row changed behind the registry's back self-corrects within one tick.
Nothing re-reads a configuration key that is already cached.

**D55 does not cover this**, and the distinction is easy to misread:

| direct change | what happens |
|---|---|
| writes an **invalid** value, key **not** cached | read parses, fails, falls back to the chain (D55). Handled. |
| writes an **invalid** value, key **is** cached | old valid value served. Not handled. |
| writes a **valid** value | old value served. Not handled. |
| **deletes** the row | old value served; the key never returns to its default. Not handled. |

D55 only helps on a cold cache and only for a bad shape. **T39 is the nearest
neighbour and is a different problem** — it asks for a boot-time scan that
detects rows whose *schema* no longer fits. A row written directly with a
perfectly valid value is exactly what T39's scan would pass.

**The behaviour is already demonstrated in the suite**, at
`test/integration/configuration.spec.ts` — the test writes a row with Prisma,
asserts the stale value is still served, and then calls `invalidate()` by hand
to move on. It has been passing since Feature 4 with nothing recording what it
proves.

**Why it is not blocking.** The service is the documented write path, and §14.3's
channel exists precisely because writes go through it. Migrations run as part of
a deploy, and a deploy restarts every process, so the case D55's comment calls
"an ordinary event" resolves itself. What is left is an operator running manual
SQL against a live system — outside the documented path, and no data is
corrupted when it happens: the stored value is correct, only the reading of it
is stale.

**Why it still matters.** Manual SQL against a live system is not a hypothetical
— it is what somebody does during an incident, when a value needs changing and
the admin panel is the thing that is broken. That is precisely when a change
that silently does not take effect is most expensive, and nothing in the logs
would say so.

**What it would take:** the smallest honest fix is an operator procedure rather
than code — "after editing the table by hand, restart, or make the change
through the admin API instead". A code fix would be a periodic re-read, which is
a poor trade for a table read on nearly every business operation, or a Postgres
`LISTEN/NOTIFY` trigger, which puts a second invalidation mechanism beside the
one §14.3 specifies.

**Trigger:** the first migration or seed that writes a `configuration_values`
row, or the first runbook that tells an operator to edit the table directly —
whichever comes first. Either one turns this from an out-of-path action into a
documented one.

### T56 — No index supports the wall's query
**Status:** open · **Raised:** Feature 15

`offers` carries three indexes beyond its primary key: the unique
`(provider_id, external_id)` the sync upserts against, `(provider_id,
last_seen_at)` for the prune query, and `(provider_id, is_active)` for the admin
catalog list. The wall asks a different question:

```sql
WHERE provider_id IN (…) AND is_active = true
ORDER BY reward_points DESC, id ASC
LIMIT n OFFSET m
```

The unique index leads on `provider_id`, so it can narrow to a provider's
offers. Nothing serves the ordering — so every request sorts the matched rows.
`(provider_id, is_active, reward_points DESC, id)` is the shape that would.

**Two filters cannot be indexed at all and are worth naming separately.**
`search` compiles to `ILIKE '%…%'`, which no btree can serve — it wants a
trigram index if it ever matters. `country` and `device` are array containment
over `text[]`, which wants GIN. Both are opt-in parameters rather than the
default wall, so they are a cost a client chooses.

Note for whoever builds it: `(provider_id, is_active)` already exists, and the
shape above is a superset of it. This is a *replacement*, not an addition —
leaving both behind means every write maintaining a redundant index.

**Not built now, on the same rule the project has applied twice already**
(T19, T20, DATABASE.md §9.3): a measured cost, not table size in the abstract.
Today the catalog holds two offers per provider. The reason it is written down
rather than shrugged at is that the wall is the platform's most requested
authenticated read, so it is the one place where this stops being theoretical
first — and the fix is a migration, which wants to land deliberately rather
than during an incident.

**Trigger:** a measured cost on `GET /offers`, or the first provider catalog in
the thousands — whichever a profile shows first.

### T57 — The wall pages by offset
**Status:** open · **Raised:** Feature 15

`Paginated` is offset-based, and the contract has said since Feature 3 that
"cursor pagination is a later concern (P6)". The wall inherits it.

Offset paging degrades in exactly the way that matters here: `OFFSET 10000`
makes the database produce and discard ten thousand rows before returning the
page. On an admin screen that is somebody's own patience. On the wall it is
every user who scrolls, against the ordering T56 already says is unindexed —
the two compound, and T56 is the half worth fixing first because it makes the
early pages cheap regardless.

The ordering is already stable enough to become a cursor without changing what
a client sees: every sort ends with `id`, so `(reward_points, id)` is a usable
keyset. That was done for correctness — a tied sort repeats and skips offers
across pages — and it happens to be the precondition for this.

**This entry originally named `external_id` as the keyset, and that was wrong.**
`external_id` is unique only within a provider, so a keyset built on it would
have carried the very defect the tiebreaker was meant to remove straight into
the cursor. The ordering was corrected to `id` — see the note at the top of
`wallOrderBy` — and this paragraph with it.

**Trigger:** a wall deep enough that anyone pages past the first few hundred
offers, or T56 being addressed — at which point the keyset is the natural shape
to index for.

### T58 — Ten other paginated reads have no unique tiebreaker at all
**Status:** open · **Raised:** Feature 15 (review round 3)

Fixing the wall's ordering exposed that `offers` was the only module that had
*tried*. Every offset-paginated read in the codebase:

| read | ordering | unique? |
|---|---|---|
| `reward_transactions` (user history) | `created_at DESC` | no |
| `clicks`, `conversions`, `users`, `admin_audit_log` | `created_at DESC` | no |
| `provider_postbacks` | `received_at DESC` | no |
| `fraud_evaluations` | `evaluated_at DESC` | no |
| `offer_sync_runs` | `started_at DESC` | no |
| `payout_requests` | composite | no |
| `offers` ×2 | `… , id ASC` | **yes**, since this round |

Every one of those columns is `Timestamptz(3)`. Whether two rows tie is
therefore a function of write rate, not of anything the code decides: two clicks
in the same millisecond tie, and so does any pair of rows a batch writes. The
consequence is the same one the wall had — a page repeats a row and drops
another — and on `reward_transactions` it lands on a user's financial history,
which is the one list PROJECT.md §1 promises is explainable.

**Why it is not blocking.** Reachability is unproven outside `offers`, where it
was demonstrated. The dev database shows zero ties, but it holds almost no rows,
so that is not evidence either way. And the defect predates Feature 15
everywhere it appears — Features 3 through 12 — so it is not something this
feature introduced or should widen its scope to absorb.

**What it wants is a convention, not eleven patches:** every paginated ordering
ends with the table's primary key. Cheap, mechanical, and enforceable by an
architecture test that reads each `findMany` with a `skip:` and asserts its last
`orderBy` key is `id`.

**Trigger:** the first report of a duplicated or missing row in any paginated
list, or the first load test that puts more than a handful of writes per second
on any of these tables — whichever comes first. Sooner if `reward_transactions`
history becomes a screen a user reads rather than an API nobody has built a UI
for yet.

### T59 — Nothing is paged when reconciliation reports drift
**Status:** open · **Raised:** Feature 16

The nightly sweep (T27) detects drift and writes it at `error` with the user id
and the exact discrepancy, and a failed run lands in BullMQ's failed set where
§13.2 says an admin reviews it. Nobody is *pushed* the news.

**Why it matters:** §12.1 specifies "alert immediately — this job failing hides
the drift it exists to detect", and that is the one job whose silence is
indistinguishable from success. A balance that cannot be explained by its own
history is, per R5, the signal to migrate the accounting model — a decision
nobody makes by reading yesterday's logs.

**Why it is not blocking:** the evidence is durably recorded either way, and R5
schedules the decision on the drift *rate* after a month of production data
rather than on the first occurrence. The gap is latency to notice, not loss of
the finding.

**Trigger:** the first alerting channel (§17.3 / §17.5), together with T48 —
they are the same dependency and should land in one piece of work.

### T64 — No way to ask for another verification email
**Status:** unblocked · **Owner module:** `auth` · **Raised:** Feature 18

A verification token is issued once, at registration, and expires after a day
by default. Anyone who loses the email, waits too long, or registers while the
queue is unreachable has no route to a second one — the account is simply never
verified.

**Why it is not urgent.** Verification gates nothing (D75), so an unverifiable
account is not a restricted account; it is an account with a null timestamp.
The moment anything depends on that timestamp this becomes blocking, which is
the trigger.

A resend endpoint is also not free: it is a public, unauthenticated route that
sends email on demand, so it needs its own throttle and the same
"same-response-whether-or-not-the-address-exists" property the reset flow will
need. Building it with password reset means building that reasoning once.

**Trigger:** the first thing that requires a verified address, or password
reset — whichever comes first. **Password reset came first (Feature 19), so
this has fired.** `AuthService.requestPasswordReset` is now the worked example:
same 204 for every address, enqueue failures swallowed rather than reported,
inactive accounts silently skipped. A resend endpoint is that method with a
different token purpose. It was not built with Feature 19 because nothing in
Feature 19 needed it — the throttle it also wants is itself deferred (T66).

### T65 — `email_log` is specified but not built
**Status:** deferred · **Owner module:** `notifications` · **Raised:** Feature 18

DATABASE.md §3 specifies an `email_log` table: user, template, recipient,
status, provider message id, error. It answers "was the verification email
sent?".

The only provider today writes to the application log, so there is no delivery
status to record beyond "handed to the logger", no provider message id, and no
error a delivery service reported. A table recording that a log line was
written is a second copy of the log line.

**Trigger:** the first `EmailProvider` that talks to something outside this
process. The table and the provider should land together, because the columns
the table needs are exactly what that provider returns.

**The trigger has fired**: `SmtpEmailProvider` exists. Deferred once more
because nodemailer's result carries a message id and an accepted/rejected list
that nothing yet reads, and delivery is already visible in the queue's own
failure record — but this is now a gap rather than a thing that cannot be
built.

### T66 — `/auth/forgot-password` is not throttled
**Status:** deferred · **Owner module:** `auth` · **Raised:** Feature 19

The endpoint is public, unauthenticated, and sends an email on demand. Posting
one address in a loop mails that person repeatedly; posting many consumes
whatever quota the eventual delivery provider grants. The login throttle does
not cover it — that one is keyed on login attempts and this is not one.

**Why it is not blocking.** It is an abuse vector rather than a correctness
defect: no reset succeeds that should not, and a flood of links to one mailbox
is a nuisance whose tokens all expire in an hour. The only provider today writes
to a log, so there is no quota to exhaust and no per-message cost yet.

**What it should not become.** A per-address counter that answers differently
once tripped would re-open the enumeration hole D76 closes — the 429 would mean
"this address has been asked about", which is nearly "this address exists". The
control has to be per-IP, or it has to fail into the same 204.

**Trigger:** the first `EmailProvider` that sends real mail, or M5's rate
limiting sweep (PROJECT.md §7) — whichever comes first.

### T67 — Emails carry a bare token, not a link
**Status:** DONE · **Owner module:** `notifications` · **Raised:** Feature 20 · **Closed:** SMTP feature

Emails now carry complete links built from `PUBLIC_APP_URL`. The rest of this
entry is kept for the reasoning that led there.

`NotificationsProcessor` passes `params: { token }` and says why: `web` did not
exist, so there was nowhere for a link to point. It exists now, and the pages
are already there — `/verify-email?token=` and `/reset-password?token=` both
read the query string.

What is missing is the origin. The API has no environment variable naming the
public address, and inventing one before there is a domain to put in it means a
variable whose value is a guess. The recipient's alternative today is pasting
the token into the form on either page, which works and reads badly.

**Trigger:** the first deploy to a real domain (M6), or any decision to send
mail through a provider that actually delivers (T65) — whichever comes first.
They are the same piece of work: an origin, a template that uses it, and a
`PUBLIC_APP_URL` in `apps/api`.

### T68 — Two concurrent requests with an expired access token log the user out
**Status:** deferred · **Owner module:** `web` · **Raised:** Feature 20

`apiAuthed` refreshes on 401. Two requests that hit an expired access token at
the same moment both present the *same* refresh token, and the second one is a
reuse — which §8.2 answers by revoking the whole family. The user is signed out
and must log in again.

**This was observed, not theorised**: replaying one forged session cookie twice
produced `Refresh token reuse detected — family revoked` in the API log and a
redirect to the login page, which is exactly the design working as written.

**Why it is not blocking.** §8.2 already names this case — "a race between
browser tabs" — and accepts it: "the cost is an occasional forced login, the
benefit is that a stolen refresh token has a bounded useful life". SSR makes it
rarer than a client-side SPA would, since a page load is usually one request.
It is a nuisance with a known workaround (log in again), not a correctness
failure, and the fix — a single-flight refresh keyed on the session, or a short
grace window on the API side — is real machinery that wants its own design.

**What makes it worse, and is worth knowing:** `app.html` sets
`data-sveltekit-preload-data="hover"`, so hovering a link can start a data
request alongside a navigation. Left on because the race exists across tabs
regardless and the preload is a real improvement; the first report of
unexplained logouts should turn it off as the cheap first move.

**Trigger:** the first user report of being logged out unexpectedly, or the
first page that issues more than one authenticated request in parallel.

### T69 — `docker compose up` does not apply migrations
**Status:** DONE · **Owner module:** deployment · **Raised:** Feature 25 · **Closed:** production-blocker pass

`docker-compose.prod.yml` runs a one-shot `migrate` service built from a new
`migrate` stage of `docker/api.Dockerfile`; `api` waits on
`service_completed_successfully`. Verified against an empty database (17 tables
created) and re-run (no pending migrations). The development file is unchanged
and still expects a host-run `pnpm db:migrate`.

Neither Dockerfile nor the compose file runs `prisma migrate deploy`. The stack
starts against whatever schema the database already has, so a fresh volume
gives an API that boots and fails every query. It worked during Feature 25's
verification only because the host had already migrated that database.

**Trigger:** the first deployment to a machine that is not this one — which is
also the first time anyone starts from an empty volume.

### T70 — The payout form's method list is hardcoded, but methods are configuration
**Status:** open · **Owner module:** `web` · **Raised:** Feature 23

`payouts.enabled_methods` is a P3 value an admin can change. The form offers
`['paypal']`, written in `payouts/+page.svelte`, because no endpoint exposes the
enabled list to a non-admin. An admin who enables a second method changes
nothing a user can see, which is exactly the failure P3 exists to prevent.

**Trigger:** the first method added beyond `paypal`.

### T72 — Backups do not leave the host, and are not encrypted
**Status:** DONE · **Owner:** deployment · **Raised:** backups pass · **Closed:** real off-host verification

`backup-remote` (`docker/backup-remote.sh`, §20.3) encrypts every dump
client-side, uploads it to an S3-compatible endpoint, reads it back through the
same decryption and compares SHA-256 before recording a receipt, then applies
remote retention on §20.3's two windows.

**Verified against a real external provider**, not a stand-in:
`docker/backup-remote-drill.sh` against a Backblaze B2 bucket over its
S3-compatible API — 26 assertions, all passing. What that run actually
established, beyond what a local server could:

- The object left this machine and existed in someone else's storage.
- What landed there is an rclone crypt container. The `PGDMP` header is not
  present in the bucket: **the provider holds bytes it cannot read.**
- Downloading it back produced the same SHA-256, `pg_restore --list` accepted
  it, and it restored into a separate database with balances unchanged.
- The retention sweep removed an object past its window and left the current
  one, over the real API.
- **A key with no account-level rights is enough.** Listing buckets returns
  `403 AccessDenied: not entitled` and nothing in the flow needs it.

Two things the real run forced fixes for, both now closed: the drill never
passed `BACKUP_S3_REGION` through, which any provider that is not AWS
`us-east-1` rejects outright at the signature; and the bucket assertions used
`mc`, whose `alias set` validates by listing every bucket in the account —
which a correctly scoped key is not allowed to do.

**Three residues, none of which reopen this:**

1. **Versioned buckets keep what retention deletes.** Confirmed on B2: the
   swept object disappeared from the listing and remained as a non-current
   version. Retention makes data unreachable; a bucket lifecycle rule is what
   makes it stop costing money. That rule is set in the provider's console —
   §20.3 says so, and no code here can or should do it.
2. **The passphrase has no rotation story.** Changing it makes existing objects
   unreadable, so a rotation means re-uploading the retained window.
3. **Local retention can delete a dump that was never uploaded**, after 30 days
   of the health check reporting unhealthy. The alarm precedes the loss by a
   month, which is enough, but it is not a guarantee.

### T71 — `autoheal` holds an unrestricted Docker socket
**Status:** DONE, with a named residue · **Owner:** deployment · **Raised:** production blockers pass · **Closed:** socket hardening pass

`autoheal` no longer holds the socket. `socket-proxy` — HAProxy, the rules in
`docker/docker-socket-proxy.cfg` — holds it and publishes a unix socket in a
volume shared with `autoheal` alone. Not a TCP listener: there is no port, so
there is nothing on the host or the internal network to reach.

Two requests pass, which is everything `willfarrell/autoheal:1.2.0` issues:

| Allowed | Why |
|---|---|
| `GET /containers/json?filters=…gemone.autoheal…` | Finds the unhealthy labelled containers. Health and state come from this response — autoheal never calls the inspect endpoint |
| `POST /containers/<id>/restart` | The restart itself |

Everything else is denied by the final rule, verified by probe: `POST
/containers/create` (the privileged-container escape), `POST
/containers/<id>/exec`, `kill`, `stop`, `DELETE /containers/<id>`, `GET
/containers/<id>/json`, `/images/json`, `/info`, `/version`, `/volumes/create`,
and an unfiltered `GET /containers/json`.

**What this does not protect, stated plainly:**

1. **`socket-proxy` is now the root-equivalent container.** It holds the socket
   and runs as root, because HAProxy has to open a socket owned by
   `root:docker`. Code execution inside it is code execution as root on the
   host, exactly as it was inside `autoheal` before. The trust moved; it did
   not disappear. What improved is the reachable surface: a config file that
   parses HTTP and holds no credentials, instead of a shell script polling a
   JSON API, and nothing routes to it but one volume.
2. **Restart accepts any container id.** The label lives on the container, not
   in the request, so the proxy cannot check it. A compromised `autoheal` can
   restart `postgres`, `caddy` or the proxy itself, repeatedly — a denial of
   service against this VPS. It cannot create, exec into, stop, kill or delete
   anything, which is what separates that from host compromise.
3. **The list rule matches a substring, not a meaning.** It requires
   `gemone.autoheal` to appear in the `filters` parameter. A crafted filter
   containing that substring while dropping the `health` condition would list
   the labelled containers regardless of health — within the same blast radius,
   and no wider.
4. **The rules are fitted to the pinned autoheal version.** A different
   version issuing a different request shape fails closed: healing stops, and
   nothing raises an error. Re-run the drill when changing that pin.

**What would close the residue:** rootless Docker, or `podman` with a per-user
socket, so that holding the API is no longer holding the host. That is a change
to how the VPS runs containers, not to this stack, and it is the only thing
that removes item 1 rather than relocating it.

**Trigger:** rebuilding the host, or a security review that treats a restart-only
denial of service as unacceptable.

### T73 — Log retention is whatever fits in 30 MB
**Status:** open · **Owner:** deployment · **Raised:** log rotation pass

`docker-compose.prod.yml` bounds every container's log at `max-size: 10m`,
`max-file: 3` (§16.1), which closes the failure it was written for: unbounded
logs filling the VPS disk and stopping Postgres. Rotation is by size, so what it
does *not* give is a time window. Under load the API's 30 MB is hours; idle it
is months. The lines that would matter most — the burst before an incident — are
the ones a busy hour rotates away fastest.

Raising the limit only moves the number, and it competes with the same disk the
database and the backups (T72) are on. Keeping lines longer means sending them
somewhere else.

**What it would take:** a destination that is not this host. Deliberately not a
platform: §17.4 and §22 already decline Loki/ELK for the MVP, and this does not
change that. The smallest thing that would work is the same shape as T72 —
somewhere off-host to write to, and a credential.

**Trigger:** the first incident where the relevant lines had already rotated, or
the shipping destination chosen for T72, whichever comes first. Not a launch
blocker: the disk is protected, which is what the missing configuration
threatened.

### T63 — A concurrent correct password can be refused as rate-limited
**Status:** deferred · **Owner module:** `auth` · **Raised:** Feature 17 (review)

`reserveAttempt` decides admission from the value its own `INCR` returns, which
is what makes the ceiling exact under concurrency. The cost is that a request
must be admitted before anything can discover its credential is correct. A user
whose counter is one below the ceiling, submitting the right password twice
simultaneously, therefore sees:

```text
two concurrent correct logins  ->  200, 429
```

Ticket 3 is admitted and verifies; ticket 4 is over a ceiling of 3 and is
refused before the password is ever examined.

**Not a correctness defect.** No invariant is broken and the error is in the
safe direction — a correct credential is refused, never a wrong one admitted.
It follows necessarily from the exact-limit guarantee: knowing a credential is
correct requires admitting the request, so the two properties cannot both hold
at the boundary. It is a trade-off that was made implicitly by that change
rather than chosen deliberately, which is why it is recorded here rather than
in DECISIONS.md.

**Self-correcting.** The winning request clears the account counter, so the
refused one succeeds on retry. The user's experience is one spurious "too many
attempts" on a login that then works.

**Its likelihood scales inversely with the configured ceiling.** At the default
of 10 it needs nine accumulated failures inside one window *and* two attempts in
flight within ~40ms. At a ceiling of 2 or 3 — values the schema permits — two
typos and a double-submitted form are enough.

**Trigger:** lowering `auth.login_max_failures_per_account` below about 5, or
the first support report of a rate-limit message on a login that succeeds
immediately afterwards.

### T62 — A successful login resets the account counter with `DEL`, which is not compositional
**Status:** deferred · **Owner module:** `auth` · **Raised:** Feature 17 (review)

`releaseAttempt` settles the two counters with different operators: `DECR` on
the address key, `DEL` on the account key. `DECR` is order-independent; `DEL`
is an assignment to zero, so it wipes the contribution of any request that was
in flight concurrently. The same four events give different residual state
depending only on interleaving:

```text
one correct + three wrong, concurrent  ->  account = (absent)   ip = 3
one correct + three wrong, sequential  ->  account = 3          ip = 3
```

**Why it is not a bug to fix now.** `DEL` implements a *reset*, and a reset is
order-sensitive by definition: when a failure is genuinely concurrent with the
proof of ownership, there is no fact of the matter about which came first, and
discarding it is as defensible as keeping it. More decisively, the admission
decisions are unaffected — each request is judged on its own atomic ticket, so
the ceiling is enforced exactly. Measured over ten bursts of one correct
password against nine wrong ones at a ceiling of three: 20 guesses evaluated
against the 33 that the ten resets already licensed. The race granted nothing.

It is also not attacker-controllable. The wipe needs a *successful* login
concurrent with the failures, which needs the password.

**Trigger:** a compare-and-set primitive arriving in this service for another
reason, or the first evidence that the residual count matters — an alert, a
support case, or a rule that reads the counter for anything other than the
ceiling.

### T61 — Stricter login throttling on the admin path
**Status:** deferred · **Owner module:** `auth` · **Raised:** Feature 17 (review)

ARCHITECTURE.md §8.4 lists four compensating controls to hold while TOTP is
absent and says of the list that they "are not optional". One of them is
**"aggressive login throttling on the admin path, stricter than the user
path"**. Feature 17 shipped one global pair of thresholds with no admin
distinction, so this bullet is not satisfied.

**Why it is a deferral and not a gap in Feature 17.** §8.3 — the section the
feature implements — asks for per-account and per-IP counters with configurable
thresholds, and that is what shipped. The compensating-controls list belongs to
§8.4 and is governed by §8.4's own trigger, not by §8.3's. None of the four has
a TODO today; this is the one Feature 17 came close enough to touch that leaving
it unrecorded would be a choice rather than an omission.

**It is not a threshold change, and that is the substance of the deferral.**
The throttle decides before the user lookup, on purpose: the bucket is keyed by
a hash of the email so that an unregistered address behaves exactly like a
registered one. A stricter ceiling for admins has to know the address belongs to
an admin, and:

- deciding *before* the lookup means admin addresses lock out at a different
  attempt count than everyone else, which is an oracle for "which address is an
  admin" — a worse leak than the one D74 just closed, aimed at the accounts
  worth attacking;
- deciding *after* the lookup means the check no longer happens before argon2,
  which gives up the CPU-exhaustion property and reorders a login flow that was
  designed step by step.

A defensible shape exists — a second counter, consulted after the lookup, that
only ever *shortens* an already-running throttle and never changes the
pre-lookup answer — but it is a design, not a parameter, and it should be built
with the admin IP allowlist from the same list, which §8.4 calls the control
that "alone blocks credential-stuffing" and which M5 already schedules.

**Trigger:** §8.4's own — the first admin account beyond the founding operator,
or the first automated payout provider — or M5's hardening pass, whichever comes
first.


### T60 — A Redis outage locks everyone out, including whoever would fix it
**Status:** open · **Raised:** Feature 17

Login throttling fails closed (§15.4): if the counters cannot be read, the
request is refused with 503. That is the correct policy for a control — an
unavailable control is not a reason to stop controlling — and it has a cost
worth naming rather than discovering during the incident.

**While Redis is down, nobody can log in.** Not a user, not an admin, not the
person who would restart Redis. Every other path in the system degrades open on
a Redis failure, so an outage that would otherwise be "slower responses" becomes
"no new sessions" for as long as it lasts. Existing access tokens keep working
until they expire, which is the only thing limiting the blast radius today.

**Why it is not fixed now.** Every fix is a hole in the control, and a hole
somebody can reach is worse than the outage: an admin bypass is a bypass, and it
would be reachable by anyone who can claim to be an admin — which is the thing
the password is for. The defensible shapes are operational rather than
architectural (a break-glass credential path with its own audit trail, or an
admin session lifetime long enough to outlive a plausible outage), and choosing
between them is a runbook decision, not a code one.

**Trigger:** the production runbook (M6), or the first Redis outage in an
environment anyone depends on — whichever comes first. It should be decided
with the on-call procedure in hand rather than in advance of it.

### T36 — The two geo-dependent fraud rules
**Status:** blocked on geo-IP · **Raised:** Feature 12

PROJECT.md §4.7 lists seven signals. Five are implemented. Two are not:

- **VPN / proxy / datacenter IP detection**
- **Geo mismatch** between the click IP and the postback-reported country

Both need an IP-to-geography source, which ARCHITECTURE.md §23 open question 3
leaves undecided ("a free database, MaxMind GeoLite2 or similar, behind our own
interface"). Neither can be faked usefully: a geo-mismatch rule with no geo data
would either never fire or fire on every conversion, and shipping a rule that
never fires is worse than not shipping it — it appears in the snapshot of every
evaluation and in the admin screen as a control that exists.

The engine needs no structural change to accept them: a rule is an entry in a
data table, and the context object grows two nullable fields that the existing
skip mechanism already handles correctly.

**Trigger:** the geo-IP source T17 also waits on. They should land together —
T17 wants the same lookup for click-time eligibility.

### T34 — The configuration-key inventory is asserted in three places
**Status:** deferred · **Raised:** Feature 11

`clicks.spec.ts`, `catalog-sync.spec.ts`, and `providers.spec.ts` each assert the
full list of registered configuration keys. Feature 11 added six keys and all
three failed together — which is the guard working, but three times over.

Not consolidated now because the duplication is currently useful: each spec
boots a different module graph, so the three assertions prove the same registry
is reached along three different paths. That stops being worth the cost once a
feature adds keys and the only work is pasting the same lines three times.

**Trigger:** the next feature that registers configuration keys, or a fourth
copy of the list appearing.

**It has now fired twice** — Feature 18 added one key and Feature 19 another,
and each time the work was pasting one line into three files. Still deferred
because the reason the duplication is useful has not changed and the cost is
still one line; the next time it fires it should be done rather than recorded
again.


### T9 — `eslint-plugin-boundaries` object-based selectors
**Status:** blocked upstream · **Raised:** Feature 1

Every lint run prints a legacy-syntax advisory. The object-based replacement
the notice points at is rejected by the plugin's own options schema in 6.0.2.
The rules work correctly either way.

**Trigger:** a release where the documented syntax validates.

### T10 — Contract tests for adapter HTTP failure mapping
**Status:** open · **Raised:** Feature 5

`ProviderUnavailable` / `RateLimited` / `AuthFailed` / `ResponseInvalid` are
defined and unit-tested as a taxonomy, but no adapter maps a real transport
failure onto them yet — the mock talks to no network, and inventing a fake
HTTP layer to demonstrate the mapping would test the fake.

**Trigger:** `core/http` (the outbound helper with timeouts and retries), or
the first adapter that makes a network call.

---

## Web (BFF and UI)

### T74 — The app shell and two pages fetch the same endpoints twice
**Status:** RESOLVED in UI phase 6 · **Raised:** UI phase 2 (application shell)

`(app)/+layout.server.ts` loads `/users/me` and `/rewards/balance` to fill the
topbar's identity pill (DESIGN_SYSTEM.md §14.3). `/dashboard` already loads
`/users/me` and `/payouts` already loads `/rewards/balance`, so those two routes
now call one endpoint twice per navigation.

**Not a correctness problem and not a serial cost:** SvelteKit runs layout and
page loads concurrently, so the duplicate adds a parallel request, not latency
on top of an existing one. It is two small authenticated GETs.

Collapsing it means the page reading the value from its parent instead of
fetching it — which changes what each page's `data` contains and therefore what
its `+page.svelte` reads. **Deliberately not done in phase 2**, whose whole
constraint was that no page content changes.

**Trigger:** the phase that redesigns `/dashboard` (phase 4) and `/payouts`
(phase 6). Each is already rewriting the page's data usage; folding the parent
value in there costs nothing extra and is the natural moment.

**Half done in phase 4, three quarters in phase 5.**
`(app)/+layout.server.ts` now returns the whole `Balance` instead of one figure.
`/dashboard` fetches neither the profile nor the balance, and `/earnings` no
longer fetches the balance either — it was refetching it on every page of the
pager. `/payouts` is the last one; it waits for phase 6, as written above.

**Closed in phase 6.** `/payouts` reads `data.balance` from the layout and
fetches `/rewards/balance` no more. No route in `(app)` now calls an endpoint
its parent layout already called; the three balance figures on the withdrawal
screen and the pill in the topbar are one fetch, and a successful submission
refreshes all four at once through `invalidateAll()`.

---

### T75 — Referrals: the signup card has nowhere to put an invite
**Status:** open · **Raised:** UI phase 3 (authentication + landing)

DESIGN_SYSTEM.md §19 specifies a referral banner on `/signup?ref=CODE` — "🎁
You were invited! You'll both start earning together." — and §18/§18.13 give
referrals a landing-page tile and a footer link. None of it was built in phase
3, because none of it has anything behind it: `POST /auth/register` takes an
email and a password, no request shape carries a referral code, and no reward
rule credits an inviter.

The banner is the visible half of a feature. Rendering it alone would promise
two people a shared reward that nothing in the system would ever create — which
is worse than not showing it, because the promise is made at the exact moment
someone commits to an account.

**Trigger:** a referral feature on the API side. When `register` accepts a code
and reward accounting can credit an inviter, the banner, the `?ref=` handling
and the "Referrals" earning tile land together in one change.

---

### T76 — The public site has no legal or support pages
**Status:** open · **Raised:** UI phase 3 (authentication + landing)

Legacy's footer carries eighteen links across four columns — Platform, Company,
Support, Legal — of which three resolve (`/terms`, `/privacy`, `/cookies`) and
fifteen are `href="#"`. Its header adds two more dead ones (Blog, Support), and
"Earn" carries a chevron with no menu behind it.

Phase 3 shipped the footer with **two** columns, both of them real, and three
header links that all point at sections of the page. Shipping the other
fifteen would have meant shipping fifteen links to nowhere — the defect
UI_AUDIT.md §9 records against legacy's admin sidebar, reproduced on the one
page every visitor sees first.

What is actually missing is the pages, not the links: terms of service, privacy
policy, cookie policy, and something to put behind "Support". DESIGN_SYSTEM.md
§18.14 already specifies the layout for the legal three — a `max-w-3xl` column
inside the same public frame, `text-4xl` title, prose block — so the frame is
designed and only the text has to be written.

**Trigger:** whoever writes the policy text. The links go back into
`landing/content.ts` in the same change; nothing else has to move.

---

### ~~T77 — A ledger row cannot say which offer it came from~~
**Status:** RESOLVED in UI phase 5 (earnings) · **Raised:** UI phase 4 (dashboard)

`RewardTransactionRecord` carried `sourceType: 'CONVERSION'` and `sourceId` —
the conversion's id — and no offer title, so the statement could say "Offer
completed" and nothing more specific.

**Resolved by recording the name at write time, not by resolving it at read
time.** `reward_transactions` gained one nullable column, `source_label`; the
contract gained `sourceLabel`; `RewardSource` gained an optional `label` that
the caller supplies. `conversions` passes `click.offerTitleSnapshot` with the
credit, and `mature()` / `reverse()` copy it from the transaction they act on,
so one offer's whole story reads under one name.

**Why not a join, which was the first instinct.** The read would have to go
`reward_transactions → conversions → clicks`, and the module that owns the
first table is forbidden from depending on any other domain module — P2, stated
in `RewardsModule`'s own comment as "deliberately and permanently". Worse,
`conversions → rewards` is already an arrow in ARCHITECTURE.md §4.1, so the
reverse is a cycle, not merely a new edge.

**Why not resolve it in the BFF.** There is no user-facing conversions
endpoint, so it would have needed one built for the purpose, plus a lookup per
row across the network.

**And a live join would be wrong even where it were allowed.** Offers are
overwritten by every catalog sync, so `offers.title` is what the offer is
called *today*, on a line describing money that moved months ago. The snapshot
is the same value, frozen at the same moment, as the promise the conversion
settles — the reasoning `clicks.offer_title_snapshot` already encodes. See D85.

Rows written before the column existed keep `null` and show no name. Nothing
backfills them: the only recoverable title is today's, which is the wrong one.

---

### T78 — No points-to-currency rate is exposed to a user
**Status:** RESOLVED in UI phase 6 · **Raised:** UI phase 4 (dashboard)

Every balance figure in the legacy design carries a currency equivalent —
`12,560 Points` above `≈ $12.56 USD` (DESIGN_SYSTEM.md §11.2, §16). Nothing in
the user-facing API exposes the rate: `/rewards/balance` returns points,
`/rewards/history` returns points, and the conversion lives in the payout
service's configuration where only an admin can see it.

The dashboard therefore shows points and no equivalent. That is the correct
behaviour for now — an invented rate on a balance screen is a number people
plan around, and being wrong about it is worse than being silent.

**What it needs:** a read of the configured rate on an endpoint a user may
call. It is a value, not a calculation, and P3 already says the rate is
configuration rather than code — so the gap is exposure, not arithmetic.

**Trigger:** phase 5 or 6, whichever first shows a figure the user is deciding
a withdrawal on. The withdrawal form is where the equivalent matters most.

**Resolved in phase 6 (D86).** The wording above — "no public API value
exposing the rate" — invites inventing one, and there was nothing to invent.
The rate is `payouts.points_per_currency_unit`, default 1000, and `submit()`
already reads it on every request and stamps it onto the row (D42). The gap was
exposure, not arithmetic.

`GET /payouts/options` now returns the methods, the minimum, the maximum, the
rate and the currency — the read side of configuration that was always the
source of truth. `/payouts` quotes `≈ $12.50 USD` under the amount as you type,
using arithmetic that is a deliberate copy of the service's `toCashMinor`
(integer, rounding down), pinned to it by an integration test so the form
cannot advertise a price the system does not honour. When the call fails the
cash line disappears rather than falling back to a rate nobody configured.

**Where it is still not shown.** `/dashboard` and `/earnings` still print points
with no equivalent. Both could read the same endpoint, and neither was changed
in phase 6 — this phase's scope was `/payouts`, and adding a call to two other
pages is a change to two screens that were signed off without it. It is a small
follow-up, not a gap: the value is now reachable, and the decision of which
screens quote money is a product one.

---

### T79 — `@gemone/contracts` runtime values cannot be imported by `web`
**Status:** RESOLVED in UI phase 10 · **Raised:** UI phase 4 (dashboard)

The package compiles to CommonJS and re-exports every module through
`__exportStar`. Rollup cannot trace named *values* through that when bundling
the SvelteKit SSR output, so

```ts
import { REWARD_TRANSACTION_TYPES } from '@gemone/contracts';
```

fails `vite build` with *"REWARD_TRANSACTION_TYPES is not exported by
../../packages/contracts/dist/index.js"*. Type-only imports are unaffected,
which is why nothing noticed until now: `web` had never imported a value from
the package.

**The trap is where it fails.** `svelte-check` resolves it, Vitest resolves it,
`vite dev` resolves it. Only the production build does not — so it is a lint-
and test-clean change that breaks the release build, which is the worst place
for a packaging problem to surface.

**Worked around, not fixed.** `$lib/rewards/ledger.ts` and
`dashboard/AccountCard.svelte` write the enum members as string literals inside
`Record<RewardTransactionType, …>` / `Record<UserStatus, …>` maps. The compiler
still rejects a missing member and a misspelt one, so nothing is less safe —
it is just less obvious why it is written that way.

**The real fix** is a dual build for the package: `tsc` twice, or `tsup`, with
an `exports` map giving `import` an ESM entry and `require` the current CJS
one. `apps/api` and `apps/worker` keep the CJS path unchanged, which is what
makes it low risk.

**Trigger:** the next phase that wants a contract constant in the browser.

**Re-confirmed and not fixed in phase 5.** The reproduction still holds — a
one-line probe importing `REWARD_TRANSACTION_TYPES` fails `vite build` with the
same message while `svelte-check`, Vitest and `vite dev` all resolve it.
`/earnings` was expected to need the constant for its type filter and turned
out not to: `LEDGER_TYPES` in `$lib/rewards/ledger.ts` is derived from a
`Record<RewardTransactionType, …>`, so it *is* the contract's set, checked by
the compiler, with no runtime import. Changing a package three applications
build against to avoid an import nothing needs would be the wrong trade.

**Resolved in phase 10 — the dual build this entry described.** See D90. The
reproduction was run first and failed exactly as recorded, then the package was
given an `exports` map with an ESM entry for `import` and the existing CommonJS
one for `require`, and the same probe built. Every workaround site was undone:
five `$lib` modules now import the constant they were spelling out, and three
`Object.keys(…) as X[]` casts — which the compiler took on trust, because
`Object.keys` returns `string[]` whatever it is given — became
`Object.values(THE_ENUM)`, which needs no cast at all.

The regression guard is `packages/contracts/test/packaging.test.mjs`, run by
`node --test` rather than Vitest deliberately: Vitest brings its own module
resolution, and resolution is the thing under test. It loads `dist` both ways
and asserts the ESM entry re-exports statically with resolvable specifiers —
the property a bundler needs, which no behavioural test can see because Node
interoperates with CommonJS perfectly well.

---

### T80 — The statement cannot filter by status
**Status:** RESOLVED in UI phase 10 · **Raised:** UI phase 5 (earnings)

`/earnings` filters by transaction *type*, because `GET /rewards/history` takes
`type`, `limit` and `offset` and nothing else. It does not filter by **status**
— Pending, Available, Cleared, Reversed, In review — and that is the axis a
user actually asks about ("what is still pending?").

**Status is derived, not stored.** `$lib/rewards/ledger.ts` computes it from
the transaction's type and its bucket deltas. Filtering it in the browser would
mean the page fetching twenty rows, hiding some, and printing "1–20 of 28" over
a list of four — a filter that lies about how much it found. Doing it properly
means the API expressing the same derivation in a `where` clause.

**Worth thinking about before building.** The derivation is a *view* over the
type and the deltas, and duplicating it in SQL creates a second definition that
can drift from the one the UI renders. The cheaper honest option may be to
expose the two questions people actually ask — "credits still pending" and
"movements that took points back" — as named filters rather than a general
status parameter.

**Trigger:** whenever the statement has enough rows for the type filter to stop
being sufficient, or the first support ticket that asks "which of these is
still pending".

**Resolved in phase 10, and not by the cheaper option.** See D91. The named
filters this entry proposed were rejected once the real objection was isolated:
the problem is not that a status filter is hard, it is that the derivation
would exist twice — once as the rule the UI renders, once as a `where` clause —
in two languages that can drift.

So the derivation moved into `@gemone/contracts` and was written **as data**.
`REWARD_STATUS_RULES` says which types carry a status and what constraint the
`pendingDelta` is under; `rewardStatusOf` reads it to decide a row's status and
`whereForStatus` reads it to select rows. Neither contains the list, so neither
can disagree about it — and a unit test walks every (type, delta) combination
asserting the clause selects exactly what the function would derive.

Filtering in the database is also what makes the count honest: `findMany` and
`count` take the same `where`, so the pager's total is the filtered total. That
was the specific failure this entry named — "1–20 of 28" printed over a list of
four — and it is now structurally impossible rather than avoided.

---

### T84 — No admin endpoint returns another user's balance
**Status:** open · **Raised:** UI phase 11 (admin users) · **Priority:** low

`/admin/users/[id]` shows an account's fraud signals, withdrawals, conversions
and administrative history, all from endpoints that already existed. It does
not show the balance, because there is no way to ask for one: `GET
/rewards/balance` is scoped to the caller, and the only admin path to somebody
else's three buckets is `PayoutReviewContext`, bundled inside a payout detail.

**Not approximated.** Summing the conversions on the page is not a balance — it
ignores maturation, chargebacks and locks — and a number on an admin screen that
disagrees with the ledger is worse than no number.

`RewardAccountingService.findMany` already accepts `AdminRewardHistoryQuery`
with a `userId`, and that query type has been in the contract since Feature 4
waiting for an endpoint. So the work is a controller method, not a design.

**Trigger:** the first support question that is "how many points does this
account have" rather than "should this withdrawal go out" — the second already
has a screen.

---

### T85 — An account's role cannot be changed through the API
**Status:** open · **Raised:** UI phase 11 (admin users) · **Priority:** low

`ADMIN_ACTIONS.USER_ROLE_CHANGED` is in the audit vocabulary and nothing writes
it. Promotion is `create-admin.js`, which ARCHITECTURE.md §8.4 intends —
"provisioned by a seed script or by an existing admin" — but only the first half
of that sentence has an implementation.

`/admin/users/[id]` therefore offers no role control. Adding one would mean
inventing what demoting the last admin does, and that is a decision with a
recovery story attached, not a form field.

**Trigger:** a deployment with more than one operator, where provisioning by
shell is a person waiting on somebody with server access.

---

### T86 — A malformed id on `/admin/payouts/[id]` reports 502
**Status:** open · **Raised:** UI phase 11 · **Priority:** low

`error(result.failure.status === 404 ? 404 : 502, …)` turns the API's 422 for an
unparseable UUID into a bad-gateway page, which blames the API for a URL
somebody mistyped — and 502 is the page an operator escalates. The same line was
written into `/admin/users/[id]` and fixed there to `status < 500 ? 404 : 502`
during phase 11; the payout screen was left alone because it was outside that
phase's scope.

**Trigger:** touching that file for any reason.

---

### T87 — Settings can only be edited at GLOBAL scope
**Status:** open · **Raised:** UI phase 11 (admin settings) · **Priority:** medium

`PUT /admin/configuration/:key` accepts `scope: PROVIDER` with a `scopeId`, and
eleven of the thirty-seven registered keys declare that scope. `/admin/settings/
[key]` writes only at GLOBAL.

Existing provider overrides are **shown**, with which provider each belongs to,
and the edit form warns when any exist — a global write is shadowed for exactly
those providers. So nothing is hidden; it is just not editable here.

A per-provider editor is a genuinely different screen: it needs a provider
picker, and the value it displays depends on which provider is selected.
Building half of one would let an operator set an override without ever seeing
the other providers' values, which is how the resolution chain becomes
surprising.

**Trigger:** the first provider that needs a different hold period or reward
share — which is the case P3's PROVIDER scope was designed for, so this is the
most likely of these to come due.

---

### T88 — Concurrent configuration writes overwrite each other silently
**Status:** open · **Raised:** UI phase 11 (admin settings) · **Priority:** low

`SetConfigurationDto` carries no version, etag or expected-current-value, so two
administrators editing the same key in the same minute both succeed and the
second value wins with nothing said to either.

The blast radius is bounded by the audit trail: every write records the old
value, the new one, who wrote it and why, and `/admin/settings/[key]` renders
that timeline — so a change that appeared from nowhere is attributable on the
next load. That is detection, not prevention.

Preventing it means a precondition on the write, which is an API change.

**Trigger:** a second full-time operator, or the first time a configuration
change is reverted by accident.

---

### T81 — The integration suite cannot run while the dev worker is up
**Status:** RESOLVED — queues in UI phase 8, database in UI phase 11 · **Raised:** UI phase 5 (earnings)

`docker compose up` runs a worker that consumes the same Redis queues and the
same Postgres database the integration suite uses. Running
`vitest --project integration` against a live stack therefore has two consumers
racing for every job: the suite's in-process services and the container.

**It does not fail loudly.** It fails as assertions about *someone else's*
work — `processingAttempts` is 2 where the test expects 1, and a conversion the
test just created was already credited by the container running an older image,
so a new column reads null. Both look exactly like application bugs. This cost
a debugging cycle in phase 5 before the cause was found; the fix each time is
`docker compose stop worker`, and with the worker stopped the whole suite (28
files, 578 tests) passes.

**Options, cheapest first:** a line in the test README; a `pretest:integration`
that refuses to start when something is already consuming the queue; or a
per-run queue prefix so the two cannot see each other's jobs. The third is the
only one that actually removes the category.

**Trigger:** the next time someone loses an hour to it, or CI gaining a job
that runs integration against a composed stack.

**Hit again in phase 6.** 57 failures across 8 files, all of them assertions
about work the container had already done. `docker compose stop worker` and the
same suite passes. Two phases, two debugging detours — this has now cost more
than the per-run queue prefix would.

**Resolved in phase 8 — the third option, the one that removes the category.**

The root cause is one line of BullMQ configuration: every queue was keyed under
BullMQ's default prefix, so the `worker` container's `bull:postbacks` and the
suite's `bull:postbacks` were *the same queue*. Two consumers, one queue, and
the container usually wins — which is why the symptom was never a queue error
but an assertion about somebody else's work.

The suite is a consumer, not just a producer: `worker-jobs.spec.ts` boots
`WorkerModule` in-process precisely to test the jobs only the worker runs.
That is what made "just don't consume in tests" not an option.

The fix:

- `QUEUE_PREFIX` on the env schema, defaulting to `bull` — BullMQ's own
  default, so **no deployment changes and no existing queue moves**.
- `queue.module.ts` passes it to `BullModule.forRootAsync`.
- `test/integration/setup.ts` sets `QUEUE_PREFIX=bull-test` before the
  application boots, and clears `bull-test:*` once per file so a crashed run
  leaves no ghosts.

**Measured, not assumed.** The same suite that produced 57 failures with the
worker up now passes 28 files / 584 tests **with the worker running** — which
is the whole point: nothing has to be stopped, and nothing depends on anybody
remembering to.

**The database half, resolved in phase 11.** See D95. The paragraph that stood
here said no test had ever failed on the shared database and left it at that.
It had the risk backwards: the damage was not to the tests, it was *by* them.
`admin-catalog.spec.ts` alone calls `deleteMany()` on eleven tables, and it ran
against whatever `DATABASE_URL` named — which on a developer's machine is the
database `docker compose` is serving. One integration file destroys the local
admin account, the registered provider, the synced catalog and every account
used to verify a feature by hand.

That was reproduced deliberately in phase 11 and had already happened three
times unprompted while building it, each time presenting as *"the admin
password stopped working"* — the same shape of disguise the queue half wore.

The fix is the same shape as the queue fix, one level down: the suite derives
`<database>_test` from `DATABASE_URL`, `global-setup.ts` creates and migrates it
once per run, and `resolveTestDatabaseUrl` **refuses to run** against any
database whose name does not end in `_test`. A developer who has only ever
copied `.env.example` gets isolation with no new configuration, which is the
only kind of safety measure that is actually on.

Measured: the developer database was snapshotted before and after two
consecutive full runs with the worker up — 8 users, 2 offers, 1 provider, 37
configuration keys, identical both times — while the suite passed 28 files /
601 tests.

**What remains shared, deliberately.** `ow:1:invalidation`, the cache
invalidation channel (§14.3). Its `ow:1:` is a *protocol version*, not a
namespace, and the message it carries says only "forget your cached copy of key
X" — each process then re-reads from its own database, so the worst case is a
cache miss in whichever process was listening. Left alone rather than made
configurable, because turning a versioned protocol constant into an
environment-derived one to prevent a redundant cache read is the wrong trade.

---

### T82 — `WallOffer` carries a provider slug and no provider name
**Status:** RESOLVED in UI phase 9 · **Raised:** UI phase 7 (offer wall)

Every offer card and the offer detail page attribute the offer to its network,
which is what a support conversation needs first when somebody says an offer
did not credit. `WallOffer` carries `providerSlug` and nothing else — the
display name lives on the `providers` row, which the wall deliberately does not
join.

So `$lib/offers/offer.ts` title-cases the handle: `mock` → "Mock". That is a
display transform of a real value rather than an invention, and it is the same
thing `methodName` does for a payout method. It is also **wrong for the first
real provider whose name is not a plain word** — `adgem` renders as "Adgem",
not "AdGem".

**What it needs:** `providerName` on `WallOffer`, populated from
`providers.display_name` — a column that already exists and is already admin-
facing. `OfferWallService` resolves the slug from the in-memory registry per
request (`eligibleProviders()`), so the name is available at the same cost as
the slug; this is a contract field and a map lookup, not a join.

Not done in phase 7 because that phase changed no API at all, and a wrong
capitalisation on one caption is not worth being the exception.

**Trigger:** registering the first real provider, or any screen that lists
providers to a user.

**Resolved in phase 9, and it cost nothing.** `WallOffer.providerName` carries
`providers.display_name`. `OfferWallService.eligibleProviders()` already built a
`Map<providerId, slug>` from the in-memory registry snapshot on every wall
request — and `ProviderRegistration` is `{ id, slug, displayName, isEnabled }`,
so the display name was already in the map's source. The map now carries both.

**No join, no second query, no lookup per offer.** The registry exists precisely
so the wall costs no query on the platform's most requested authenticated read
(§7.3), and this keeps that true.

`providerSlug` stays: it is the stable handle a support ticket quotes and the
postback path is named after. The browser-side `providerName()` transform that
title-cased the slug is deleted — it was the second source of truth, and it was
wrong for the first provider whose name is not a plain word.

---

### T83 — Points are quoted in money on two screens out of four
**Status:** RESOLVED in UI phase 9 · **Raised:** UI phase 7 (offer wall)

`payouts.points_per_currency_unit` became reachable in phase 6 (D86, closing
T78) and is now read by `/payouts` and `/offers`, which both quote `≈ $1.71`
beside a points figure. `/dashboard` and `/earnings` still print points alone.

That is an inconsistency the user notices before anyone else does: the same
1,715 points is a dollar figure on the wall and a bare number on the statement
that records having earned it.

**What it needs:** the same `GET /payouts/options` read in those two loads and
`approxCash` in their components — both already exist, so it is two small
changes and no new architecture.

**The thing to decide first** is where the rate should live. It is a platform
economic constant, and it is currently exposed under `/payouts/options` because
that is the screen that needed it. A third and fourth consumer is the point at
which "the withdrawal form's options" stops being an honest name for it.

**Trigger:** the phase that revisits `/dashboard`, or the first complaint that
the numbers do not agree.

**Resolved in phase 9**, and the question this entry said to decide first —
where the rate should live — is answered by *moving the read*, not by moving the
endpoint.

`(app)/+layout.server.ts` loads `GET /payouts/options` once for the whole group,
beside the profile and the balance it already loads. All four screens read
`data.payoutOptions`:

- `/dashboard` and `/earnings` gained the cash caption they were missing;
- `/offers` and `/payouts` **dropped the calls they were each making** — one
  value fetched by four pages is exactly the shape T74 spent three phases
  undoing, and this closes it before it opens.

One helper, `pointsUnit(points, rate)`, builds every caption, so seven figures
across three components cannot drift into quoting the same balance differently.
The rate is never defaulted: a failed options call costs the cash half of the
caption and nothing else (D86).

The endpoint keeps its name. `/payouts/options` reads configuration the payout
service enforces, and that *is* where the rate is defined — a neutral
`/config/public` would be a second surface onto one value, which is the problem
this entry was worried about rather than the fix.

---

## Not yet built (scope, not deferral)

Listed so they are not mistaken for oversights. These are M2+ scope in
PROJECT.md §7, not decisions to revisit.

- `core/cache`, `core/http` — arrive with their first consumer. `core/cache` was
  reconsidered in Feature 12 and deliberately not built (D49, T15), and again in
  Feature 14: T3 had recorded itself as blocked on it, which turned out to be a
  mis-statement rather than a dependency. `core/events` publishes notifications
  and holds nothing, so the cache still has no consumer (D58).
- ~~`notifications` — email behind an interface.~~ **Built in Feature 18**, with
  email verification as its first consumer (D75). One `EmailProvider` interface,
  one implementation that writes to the log.
- ~~`web` — the SvelteKit BFF.~~ **Built in Feature 20** (D78): auth flows,
  protected routes, and the session cookie §6.1 is built around.
