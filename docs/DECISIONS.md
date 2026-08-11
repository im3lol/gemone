# DECISIONS — Implementation-Time Decision Log

> **Purpose:** decisions taken *while writing code* that resolve, amend, or go
> beyond what the approved documents say.
>
> PROJECT.md, ARCHITECTURE.md and DATABASE.md are **approved**. They are not
> silently edited when implementation learns something they did not anticipate.
> This file records what implementation decided instead, so the divergence is
> visible and can be approved, reversed, or folded back into the source
> document deliberately.
>
> **What belongs here:** a decision that contradicts an approved document,
> reconciles two that disagree, or resolves something they left open.
> **What does not:** ordinary design choices already explained where they live —
> the code comments carry those, and a second copy here would drift from them.
> **Deferred work belongs in [TODO.md](TODO.md)**, not here.

Each entry: what was decided, what it changed, and why. The *why* is the part
that lets the decision be revisited intelligently later.

---

## D1 — NestJS has no multi-provider tokens; readiness registers explicitly
**Feature 2** · corrects an earlier design of mine

An early draft registered readiness checks with `{ provide: READINESS_CHECK,
multi: true }`. **That is Angular, not NestJS** — the option does not exist and
the code did not compile.

Replaced with each dependency calling `HealthService.register()` from its own
module. The dependency arrow still points at `core/health`, which keeps knowing
nothing about Postgres.

Worth recording because of *how* it was found: `/health/ready` had been passing
before the check existed at all — it returned true because no checks were
registered. A green probe for the wrong reason.

**Recorded in:** `core/health/readiness-check.ts`.

---

## D2 — `@Public()` lives in `core/security`, not in `modules/auth`
**Feature 3** · corrects an earlier placement of mine

`core/health` needs the decorator, and §5 rule 2 forbids `core → modules`.
Moving it to `core/security/public.decorator.ts` inverts the dependency.

It is deliberately **not re-exported** from `modules/auth`. A re-export would
make the auth path the obvious import for anyone in `core`, recreating the
violation through an alias — which lint would then permit, because the alias
resolves inside `modules`.

---

## D3 — `configuration_values.scope_id` is NOT NULL with an empty-string sentinel
**Feature 4** · a correctness fix, not a style choice

DATABASE.md §3.6 describes the scope id as "null for global". Implemented that
way, `UNIQUE (key, scope_type, scope_id)` **does not constrain anything**: in
PostgreSQL two NULLs are never equal, so unlimited duplicate GLOBAL rows are
permitted for one key, and resolution would depend on row order.

The constraint DATABASE.md §9.1 relies on to make the chain unambiguous only
holds if the column cannot be null.

Proven against the database before and after: the second duplicate insert now
fails with `duplicate key value violates unique constraint`.

**Amends:** DATABASE.md §3.6's "null for global".

---

## D4 — `providers.is_enabled` is a column, not a configuration key
**Feature 5** · reconciles two approved documents

ARCHITECTURE.md §7.3 calls disabling a provider "configuration (P3)".
DATABASE.md §3.2 lists an enabled flag among the provider row's columns. Read
strictly, they disagree about where the bit lives.

**Decided: the column.** §7.3's point is that disabling must not require a
deploy, which a column satisfies. Putting the bit in `configuration_values`
would let the provider row and the configuration value disagree about whether a
provider exists and is switched on — two sources of truth for one fact, which
is the failure P3's single audited path exists to prevent.

Consistent with §5.2: the system already has flags where it needs them; what it
will not have is a flag *platform*.

---

## D5 — The registry is fed provider rows; it does not query the table
**Feature 5** · refines ARCHITECTURE.md §7.3

§7.3 says the registry "reads enabled providers from the `providers` table at
boot". Implemented the other way round: `ProvidersService` owns the table and
calls `ProviderRegistry.load(rows)`.

Same behaviour, opposite dependency direction, for two reasons. The service
must validate every write's slug against the adapter map, so a registry that
queried the table would close a cycle — the one NestJS resolves with
`forwardRef()` and that quietly makes both sides untestable in isolation, which
§4.2 documents as the trap that shaped the `fraud` module. And a registry fed
plain objects is testable with plain objects, which is what makes the P1 proof
in D8 possible at all.

---

## D6 — Providers are deliberately not readiness checks
**Feature 5**

`/health/ready` answers "should traffic be routed to this process" (§17.2). A
provider being down does not make the process unable to serve: users still log
in, browse other providers' offers, and withdraw.

Reporting not-ready would pull a healthy replica out of rotation because a
third party is having a bad hour — converting someone else's outage into ours.
The database registers because without it we can serve nothing.

Verified live: with the mock adapter unregistrable, `/health/ready` returns
`200 ready`.

---

## D7 — Provider health is recorded, never probed; and it never gates `enabled()`
**Feature 5**

**Recorded, not probed.** A synthetic health check answers whether the provider
responds to *our probe*. The question that matters is whether the work we
actually do against them succeeds, which recorded outcomes answer exactly, for
free, with no API quota spent and no probe that stays green while every real
sync fails.

**Never gates enablement.** `ProviderRegistry.enabled()` filters on
`is_enabled` alone. Excluding an unhealthy provider would be a state with no
exit: nothing would call it, so nothing would ever record a success, so it
could never recover on its own. Health informs an operator; `is_enabled` is the
decision.

---

## D8 — The adapter map is injected via a DI token
**Feature 5** · one indirection, bought deliberately

`PROVIDER_ADAPTERS` could simply be imported by the registry. It is provided
under a token instead, so that a test can supply a map containing an adapter
that has never existed in this repository and drive the real registry, the real
validation and the real credential injection against it.

That test is the honest form of P1's promise. Without the token, "adding a
provider changes nothing outside its own folder" could be argued but not run —
and PROJECT.md §9 criterion 5 makes it a success criterion, not an aspiration.

---

## D9 — Adapter metadata is reachable without constructing the adapter
**Feature 5** · a security fix found while writing it

The registry must know which credentials an adapter needs *before* it can
resolve them. The obvious alternative — construct the adapter with every
environment variable sharing the slug's prefix, then ask what it wanted —
hands the adapter registered as `acme` the value of `PROVIDER_ACME_EU_API_KEY`,
i.e. **one provider receiving another provider's secret** whenever one slug
prefixes another.

So the registry map holds `{ metadata, create }`, and credentials are resolved
by exact variable name. Covered by a test that asserts the non-leak directly.

---

## D10 — Provider-scoped configuration is keyed by provider id, not slug
**Feature 5**

A slug reads better in the database and is editable in principle; an id is the
row's actual identity. Scoping by slug would mean a rename silently orphans
every configuration value set for that provider.

Both halves are enforced: the scope id is the id, **and**
`ProvidersService.update` refuses to rename a slug at all — it is also the
registry's lookup key and appears in stored click URLs.

---

## D11 — `consistent-type-imports` is disabled, permanently
**Feature 1**

The rule rewrites `import { HealthService }` to `import type { HealthService }`
whenever the symbol appears only in type position — which constructor
parameters do. That erases `emitDecoratorMetadata` and **breaks NestJS
dependency injection at runtime, with no compile error**.

A lint rule that silently breaks DI is worse than the inconsistency it fixes.
Type-only imports are still written by hand where they are clearly types.

---

## D12 — Boundary rules are proven to fail before they are trusted
**Feature 1, reaffirmed in Feature 5** · a working practice, not a code change

`eslint-plugin-boundaries` resolves imports through `eslint-module-utils`,
whose default node resolver does not know about `.ts`. Without an explicit
`import/resolver` setting, every internal import resolves to nothing, every
dependency is classified "unknown", and **the rules pass on code that violates
them** — the worst possible failure for a rule whose entire job is to fail.

Found by injecting a deliberate violation and watching lint stay green.

**The practice that follows:** a new boundary or architecture rule is not
trusted until a deliberate violation has been seen to fail it, and the probe is
then removed. Applied to the provider rules (§5 rules 6 and 7) and to
`provider-independence.spec.ts`, which caught three real violations on its first
run.

---

## D13 — The first production configuration keys, and what happened to the guard
**Feature 5** · amends a Feature 4 test

`core/config` shipped with zero registered keys, guarded by a test asserting
the list was empty. `providers` registers the first two — the health degradation
thresholds — so that guard would now be either false or misleading.

Replaced with an **exact inventory** asserted against the full `AppModule`: a
key appearing that nobody announced still fails the test. The original
assertion survives in `configuration.spec.ts` against a module graph that
excludes feature modules, where it now says something narrower and still true:
`core/config` defines no business rules of its own.

A guard that is deleted the first time it fires was never a guard.

---

## D14 — The scheduled path re-reads the provider registry before every decision
**Feature 6** · a bug the live run exposed and the test suite had not

The registry is an in-memory snapshot rebuilt on write by whichever process
made the write. An admin adds and enables a provider through the `api`
process; the `worker` — the process that runs every scheduled sync — booted
earlier, so its snapshot is empty and stays empty. The tick reports nothing
due, forever, and a newly added provider's catalog never populates until
somebody restarts the worker.

This is **not** the multi-replica caveat (§14.3, TODO T3). It bites with
exactly one of each process, which is every deployment.

`CatalogSyncService` therefore reloads before deciding what is due and before
resolving an adapter — one indexed query per tick and per run. The pub/sub
channel in §14.3 is what would make that unnecessary rather than merely cheap.

**Worth recording for how it was found:** every test passed, because a test
that boots one module graph has one registry. Two processes is the condition,
and only the live run had two.

---

## D15 — Deactivation carries a source, so a sync cannot undo an admin
**Feature 6** · adds a column DATABASE.md §3.2 does not list

§3.2 gives `offers` an "active flag". A single boolean is not enough: an offer
an admin pulled is still in the provider's catalog, so the next sync sets it
active again. "Remove this offer" would quietly mean "remove it until the next
sync" — about a minute.

`deactivation_source` distinguishes SYNC from ADMIN. A sync may only undo its
own deactivations; an admin's decision survives until an admin reverses it.
The offer's *content* is still refreshed while suppressed, so re-enabling it
shows the current offer rather than whatever it said the day it was pulled.

---

## D16 — A full sync refuses to prune when the fetch looks too small
**Feature 6**

Deactivating everything a full sync did not see is correct when the provider
returned their whole catalog, and catastrophic when they returned an empty page
because their API had a bad minute: every offer they have goes dark until the
next successful run.

So pruning is skipped when what was accepted falls below a configured
percentage of what is currently live (default 50%). The run is recorded PARTIAL
with the reason and the offers stay up.

**Failing towards a stale catalog is recoverable; failing towards an empty one
is an outage** (P5). The threshold is configuration, so an operator who has
verified that a shrink is real can let the prune through without a deploy.

---

## D17 — `offers` omits the dedup and ranking columns DATABASE.md lists
**Feature 6** · a deliberate, scoped omission

DATABASE.md §3.2 has `offers` carry a dedup fingerprint, a group-winner flag,
and an admin pin/weight. None are in the schema.

Neither deduplication nor ranking was in this feature's scope, and the
fingerprint additionally needs `advertiser` and `targetApplicationId` — fields
the adapter contract does not carry, so populating it would mean amending a
contract approved one feature earlier.

Adding the columns unpopulated was the alternative and is worse: a column
nothing writes is one the next feature has to backfill, and an always-null
column reads as a bug. They arrive with the wall, together with the code that
fills them (TODO T12).

---

## D18 — One repeatable tick, not one repeatable job per provider
**Feature 6** · refines ARCHITECTURE.md §12.1

§12.1 describes `catalog-sync` as "cron, per provider, interval configurable",
which reads as one repeatable job each. Implemented as a single tick every
minute that asks the database which providers are due.

A per-provider schedule has to be re-registered whenever an interval changes, a
provider is added, or one is disabled — three ways for the schedule in Redis to
drift from the rows in Postgres, each failing silently as "that provider stopped
syncing". With a tick, the rows *are* the schedule.

The tick interval itself is a constant, not configuration: it bounds how late a
due sync can be, not how often any provider is synced, so §5.1's test puts it
outside P3.

---

## D19 — §4.1's `offers → clicks` arrow is the user's path, not a dependency
**Feature 7** · reading of an approved diagram

ARCHITECTURE.md §4.1 draws an arrow from `offers` down to `clicks`. Read as a
code dependency it is backwards: `offers` has no reason to know clicks exist,
while a click cannot be recorded without the offer it is a promise about — the
title and reward are snapshotted onto it.

Implemented as `clicks → offers` and `clicks → providers`, both through the
owning services (§11.2). The diagram is read as the *flow* a user takes: browse
the wall, then click.

Nothing in the document is wrong; it is a diagram of a journey sitting in a
section about dependencies. Recorded rather than edited.

---

## D20 — `POST /clicks` returns JSON, not a 302
**Feature 7**

§4's module table gives `clicks` an "authenticated + redirect" surface, which
could mean the API itself issues the redirect.

It returns the URL instead. §6.1 is explicit that the browser never calls the
API directly — SvelteKit does, server-side — so a 302 here would be followed by
the BFF rather than by the user, and the BFF would have to read `Location` and
re-issue it anyway. Returning the URL lets `web` issue the redirect and a
future mobile client (§21) open it natively, from one endpoint.

The redirect still happens; it happens one layer out, where navigation belongs.

---

## D21 — The click limit counts rows, it does not read Redis counters
**Feature 7**

§14.1 puts fraud velocity counters in Redis, and that is the right home for
them when `fraud` needs cross-module velocity at conversion time.

For this one check, on a table this module owns, an indexed count over a
one-hour window is *exact*, has no invalidation problem, and needs no second
store that can disagree with the rows (P6). The index exists for it.

**The trade, stated plainly:** the check runs before the insert and outside any
transaction, so two clicks arriving in the same millisecond can both pass. That
is accepted — this is a fraud control bounding sustained behaviour, not an
accounting invariant, and the cost of a race is one extra click. Making it exact
would mean serialising every click behind a lock on the user row: real
contention, on the hot path, to prevent an off-by-one in a threshold that is
itself a judgement call.

Revisit when the count becomes a measured cost, or when `fraud` needs the same
counters (TODO T15).

---

## D22 — `CLICK_SIGNING_SECRET` is separate from `JWT_SECRET`
**Feature 7**

Both are HMAC keys and sharing one would have worked. They protect different
things with very different lifetimes: an access token lives fifteen minutes, a
click's attribution window lives thirty days.

Sharing one key would mean rotating it for a session-security reason silently
invalidated every outstanding click — and every conversion still to arrive for
them, which is money users had already earned.

Rotation of the click key has that consequence by definition, which is a real
operational constraint rather than a bug; it is recorded in TODO T16.

---

## D23 — Geo and device eligibility are not enforced at click time
**Feature 7** · a deliberate gap, not an oversight

An offer carries `countries` and `devices`. Refusing a click from outside them
would prevent a user doing work that can never convert — a real protection.

It is not implemented because there is nothing honest to check against. There
is no geo-IP source (§14.1 lists the cache for one; nothing populates it), and
`users.registration_country` is a weak proxy that would refuse a legitimate
traveller. Device would mean parsing user agents, which is guesswork with a
long tail. Enforcing on an unreliable signal blocks real users to prevent a
hypothetical one.

The click's IP is recorded, so the check becomes available the moment geo-IP
does — and `fraud`'s geo-mismatch rule (PROJECT.md §4.7) needs the same source.
Targeting remains a wall-render concern until then (TODO T17).

---

## D24 — `provider_postbacks` has no `duplicate` state; it has a counter
**Feature 8**

DATABASE.md §3.4 lists `duplicate` among the processing states, and
ARCHITECTURE.md §10.1 says "on conflict: mark duplicate".

Those two cannot both be taken literally. The unique constraint means a
duplicate **never becomes a row** — there is nothing for the state to sit on,
and the only thing present to mark is the row being duplicated.

Implemented as `duplicate_count` plus `last_duplicate_at`, incremented on
conflict. That is "mark duplicate" with a subject, and it is the only
visibility anyone has into a provider retry storm: a count climbing while
nothing else changes says our acknowledgement is not reaching them.

The other five states are kept as declared, including the three only
processing writes. Adding an enum value later is a migration on the
highest-volume table in the system.

---

## D25 — Nothing is archived before the signature verifies
**Feature 8**

§10.1's flow inserts the raw payload early, and its stated reason is strong:
"a postback that was rejected in memory is a conversion the user completed and
can never be paid for."

It is nevertheless placed **after** verification, not before. The endpoint is
public and unauthenticated by necessity (§19.2), so a row written for
unverified input is a table anyone who can type is allowed to fill — at our
storage cost, on the table §9.3 already names as the first partitioning
candidate. Rejections go to the log instead, at `warn`, with the source
address and the adapter's reason.

Consequence, recorded rather than hidden: there is no `signature_valid`
column. DATABASE.md §3.4 lists one, and it could only ever hold `true`. A
column with one possible value is a column that misleads whoever reads it.

---

## D26 — A postback that verified and will not parse is archived anyway
**Feature 8** · the other half of D25

§10.1 parses before it inserts, which reads as "drop what will not parse".
Taken with that section's own reasoning it cannot be right: the reason to
store raw payloads is that *processing can have a bug*, and parsing is
processing. A provider renaming a field would otherwise lose every conversion
for the length of the incident, with no evidence any of them arrived — and
those are conversions users completed.

So it is archived as `REJECTED`, with the parse failure in `error_detail`, and
answered 400. Not enqueued, because there is nothing to process.

Safe precisely because of D25's ordering: only someone holding the provider's
secret can write these rows, so the volume is bounded by the provider's own
retry policy rather than by the internet.

Such a row has no `external_transaction_id` — there was none to extract — so
the column is nullable. Two NULLs are never equal in PostgreSQL, so these rows
never collide with each other. That is correct rather than a loophole: a
payload with no idempotency key cannot be deduplicated, and duplicating
evidence is harmless.

---

## D27 — The postback queue has a producer and no consumer yet
**Feature 8**

§10.1 step 7 enqueues a processing job. The processor belongs to conversion
processing — it needs the `conversions` table, `RewardAccountingService` and
`FraudService`, none of which exist — so this feature ships the producer
alone.

The alternative, not enqueueing until the consumer lands, was rejected: the
after-commit ordering, the natural-key `jobId`, and "a failed enqueue must not
fail the request" are the parts that are hard to add correctly later, and they
are only testable with a real producer.

Jobs wait in Redis until the processor starts, which drains them. Nothing is
at risk if they are lost: `provider_postbacks` is the replay source, and a
`RECEIVED` row with no job is exactly what a replay re-dispatches (TODO T21).

**A failed enqueue returns 200, not 500.** The row is already durable, and a
500 would make the provider retry — which we would then correctly recognise as
a duplicate and still not enqueue. The retry buys nothing and costs a
duplicate.

---

## D28 — Archived headers are an allowlist, and the postback endpoint has no DTO
**Feature 8**

Two decisions that look opposed and share one reason: the payload is the
provider's, the headers are the transport's, and only one of them may contain
a secret.

**Headers: allowlist.** A denylist keeps whatever it did not think of, and
that includes the day a provider authenticates with a bearer token — at which
point their credential is in our database, our backups and every replica,
which DATABASE.md §1 exists to prevent. The cost is that a provider signing
via a custom header has that header dropped from the archive; no adapter does,
and the first that does adds its name (TODO T22).

**Body and query: no DTO, nothing rejected.** §19.3 rejects unknown properties
on every other endpoint. Here they *are* the payload — a provider adding a
field would otherwise make every conversion fail validation for a field nobody
needed. Validation is the adapter's `parsePostback`, strict about what it
requires and indifferent to what it does not.

---

## D29 — Postback intake introduces no configuration keys
**Feature 8** · recorded because the absence is a decision

P3 makes business rule values configurable, and every feature so far added
keys. This one adds none, and that is not an oversight: intake contains no
business rule. It has no rates, no thresholds, no limits — it decides whether
a request is authentic and stores it.

The one value that looks tunable, the source IP allowlist, is already
configuration in §5.1's sense: it lives on the provider row, an admin changes
it without a deploy, and §7.3 requires exactly that.

Inventing a key here — a payload size cap, a "require an allowlist" toggle —
would be adding a knob nobody asked for to a screen someone has to read
(P6, §5.2's boundary).

---

## D30 — The postback→conversion link lives on the conversion only
**Feature 9**

DATABASE.md §3.4 gives `provider_postbacks` a "resulting conversion reference
(nullable)". It is not implemented, and the reason is the constraint that
replaced it.

`conversions.postback_id` is **unique**, so "the conversion for this postback"
is already one indexed lookup, and "at most one conversion per postback" is
enforced by the database rather than by whoever remembers to keep two columns
in step. Adding the back-reference would create a second copy of the same fact
in the opposite direction — and two columns pointing at each other are two
columns that can disagree, on the pair of tables where disagreement means a
conversion that is either invisible or double-counted.

Prisma exposes the relation from both sides regardless, so nothing is harder
to read; there is simply one writable copy of the truth.

---

## D31 — One status column, carrying both what the provider said and what we did
**Feature 9**

DATABASE.md §3.4 lists `credited` / `held` / `reversed` / `rejected`. Three
things it does not cover appeared immediately: a provider reporting an event as
*not yet final*, a conversion that is matched and priced but not credited, and
the fact that "rejected" can mean either the provider refused it or we did.

Implemented as `PENDING` / `ATTRIBUTED` / `CREDITED` / `HELD` / `REVERSED` /
`REJECTED`, with the provider's own word kept verbatim in `provider_status`
beside it.

**Why one column and not two.** Only one of the two is ever the current answer
— a conversion the provider has not finalised cannot also be credited — so a
second status column would be a second thing to keep in step, and the failure
mode is a conversion that is `PENDING` to one query and `CREDITED` to another.
What is genuinely two facts is *what was reported* versus *what we decided*, and
that pair is exactly what `provider_status` plus `status` records.

`ATTRIBUTED` is this feature's terminal success state and does not become dead
when the reward flow lands: it is the state between recognising a conversion and
crediting it, which is where anything whose credit has not completed sits.

---

## D32 — Processing re-parses the archive; it never trusts intake's parse
**Feature 9**

Intake already parses a postback — it needs the transaction id for the
idempotency key. Storing the parsed result there and reading it back here would
have saved a parse per conversion.

It is re-parsed from the raw archived payload instead, every time. §10.1's
stated reason for archiving raw payloads is that *processing can have a bug and
the job can be replayed after the fix* — and parsing is processing. A parser bug
baked into every row it touched at intake time would be unreachable by any
replay, which would leave "re-deliver these events" as the only recovery, and
providers consider delivered events delivered.

The cost is one parse per conversion on the worker, off the request path, which
is where §10.3 explicitly puts the expensive half.

**The limitation this exposes**, recorded rather than hidden: `rawBody` is not
archived, so a provider whose adapter *parses* from the raw bytes could not be
replayed. Verification, which genuinely needs the bytes, happens at intake while
they are still in hand (TODO T23).

---

## D33 — A chargeback finds its target by click and amount, and quarantines when unsure
**Feature 9**

ARCHITECTURE.md §7.1 lists what `parsePostback` extracts, and a reference to the
conversion being reversed is not among it — the networks this was modelled on
re-send the `sub_id` with a new transaction id instead.

So the original is found among the conversions on that click, narrowed by the
amount being taken back. One match is reversed; **zero or more than one is
quarantined**, never guessed.

Guessing would mean picking "the most recent", which on a multi-step offer
reverses whichever conversion happened to sort first. That is wrong silently, in
money, and it is wrong in a way no test and no admin screen would show. A human
resolving the occasional ambiguous reversal is much cheaper.

Extending the adapter contract with an explicit original-transaction reference is
the real fix, and it is deferred until a network provides one to model it on
(TODO T24).

---

## D34 — A disabled provider still has its accepted postbacks processed
**Feature 9**

§7.3 makes a disabled provider inert, and Feature 8 applied that to the intake
surface: its endpoint rejects.

Processing deliberately does **not** check `isEnabled`. Everything in the
archive was accepted while the provider was live, and those are conversions
users had already earned. Refusing to process them would mean disabling a
provider silently confiscated the work done before the switch was flipped —
turning an operational action into a financial one.

What processing *does* require is a usable adapter, since the payload cannot be
read without one; a provider whose adapter this build cannot load quarantines
rather than fails, because retrying will not deploy the missing code.

---

## D35 — The worker reloads the provider registry on a miss, not before every job
**Feature 9**

D14 made the scheduled catalog path re-read the registry before every decision,
because a worker's in-memory snapshot is taken at boot and a provider enabled
afterwards is invisible to it. The same trap applies here, and it would look the
same: conversions quarantined as `PROVIDER_UNAVAILABLE` for a provider that is
plainly working.

The fix is the same, applied differently. The catalog tick runs once a minute,
so an unconditional read costs one query a minute; this is the highest-volume
queue there will be, so the equivalent would be one provider-table read *per
conversion* for a table that changes a few times a week.

So the lookup runs first and reloads only when the slug is missing. The
correctness is identical — the reload happens before anything gives up — and the
cost is paid only in the rare case that motivated it.

`RatesService` was extracted from `CatalogSyncService` in the same spirit: it
began as a private method with one caller, and became a service the moment a
second one needed it. Two implementations of one calculation is how a conversion
comes to be worth a different number of points than the offer it came from.

---

## D36 — `users` depends on `rewards`, so the balance row is never created lazily
**Feature 10**

DATABASE.md §3.5 is explicit that the balance row is created **with the user**,
not on first credit: "a missing balance row during a credit is an error path
nobody tests; an always-present zero row is one less branch." §10.1 puts both
inserts in the registration transaction.

That collides with P2's access rule, which has no exception for inserts. Two
ways out were available and both were wrong: letting `users` write the table
directly grants the exception `arch.spec.ts` exists to refuse, and creating the
row lazily inside `credit()` reinstates the branch the design removed.

So `UsersService.create` opens a transaction and calls
`RewardAccountingService.openAccount(userId, tx)`. The rewards service remains
the only writer; the row still lands with the user; and a registration that
fails takes its balance with it.

§4.1's dependency graph does not draw `users → rewards`. It draws the arrows
that existed when it was written, and this one exists because of a rule in a
different document. `rewards` depends on no domain module — deliberately and
permanently — so nothing cycles.

---

## D37 — Reversal takes from `pending` first and is allowed to go negative
**Feature 10**

§9.5 states both halves; this records what they mean together, because the
second one looks like a bug in every code review.

**Pending first**, because those points were never withdrawable — taking them
back costs the user nothing they had been told was theirs.

**Negative rather than clamped**, because a clamped balance is a silently lost
debt. When a chargeback arrives after the points were paid out, the money left
and a zero would say it had not; the next credit would then quietly pay off a
debt nobody could see, and the user's statement would never mention it.

**`locked` is never touched.** Those points are reserved for a payout an admin
may be part-way through sending. Reaching into them would leave the payout
unfunded without the payout knowing — a reversal must not be able to break an
operation it cannot see.

---

## D38 — Maturation is a transaction row, not a flag on the credit
**Feature 10**

PROJECT.md §4.5 lists seven transaction types and none of them is maturation.
The obvious implementation is therefore a `matured_at` column on the credit,
set once by the sweep.

Rejected for two reasons that turned out to be the same reason.

`reward_transactions` is **append-only** — DATABASE.md §3.5 says rows are never
updated or deleted, and that an `updated_at` there "is a lie that invites
someone to write to it". A write-once mark is a smaller lie, and still a write.

More decisively: the pending-to-available move would then be **the only balance
change with no transaction behind it**, and reconciliation would stop being a
sum over history and become a simulation of it. Reconciliation is the mechanism
R4 lists as its final mitigation and R5 names as the evidence the whole P2
decision turns on. Weakening it to avoid adding an enum value is the wrong
trade by a wide margin.

So `REWARD_MATURATION` is an eighth type, carrying `amountPoints: 0` — nothing
was earned or lost, points changed bucket — and pointing at the credit it
matures. "Has this credit matured?" is answered by the existence of that row,
which is also how "has it been charged back?" is answered. No marks anywhere,
and a balance that is always the sum of its own history.

---

## D39 — An indefinite hold has no maturity date at all
**Feature 10**

§10.3 step 7 requires a held conversion's points to stay in `pending` "past
their maturity date until an admin clears it". Implemented by giving the credit
**no** maturity date: `matures_at` is null, and the maturation sweep's
`maturesAt <= now` comparison excludes nulls by construction.

The alternative — a far-future date — is a lie with an expiry on it, and the
expiry always arrives.

The consequence is that clearing a hold cannot be done by a clock; it is an
explicit maturation with an admin as the actor. The service operation exists;
the admin surface for it does not yet (TODO T29), so held points are currently
stranded by design rather than by accident. The conversions that produce them
are those of accounts that are not active, which should not be paid without a
human looking anyway.

---

## D40 — Reconciliation reports drift and never repairs it
**Feature 10**

The tempting implementation writes the corrected total back. It would make the
symptom disappear.

PROJECT.md R5: *"If reconciliation reports any unexplained drift in production,
that is the signal to migrate — not a bug to patch."* A repair destroys the only
evidence that the simple balance model has started failing, which is the
evidence the P2 decision is supposed to be made on. The check therefore returns
the recorded totals, the expected totals and the per-bucket difference, and logs
at `error` when they disagree.

The nightly scheduled run (§12.1's `reconciliation` job on the `maintenance`
queue) is **not** part of this feature — it needs the alerting §17.3 defers, and
a drift detector nobody is paged by is a detector that reports to nothing. The
check itself ships now because it is the invariant this feature must hold, and
every integration test ends by asserting it (TODO T27).

---

## D41 — `FAILED` is terminal, which §11.1 does not say
**Feature 11**

§11.1 states that "`PAID` and `REJECTED` are terminal" and leaves `FAILED`
unstated while also requiring that "every state names its permitted next
states". Read together, those imply `FAILED` has successors and does not say
what they are.

It has none, and it cannot. `FAILED` releases the lock, so the points are back
in the user's `available` balance and may already have been spent on another
withdrawal. A transition out of `FAILED` would have to re-lock — an operation
that can fail for reasons outside the machine — and a state machine with an
edge that can fail is not one.

Retrying a failed payment is therefore a **new request with a new lock**, which
is also the honest description of what happens operationally: the money did not
move, the user still has the points, and they ask again.

Recorded rather than treated as a gap in the document, because the document is
right about everything it does say.

---

## D42 — The points-to-cash rate is stored on the payout request
**Feature 11** · answers an open question rather than opening one

DATABASE.md §13's first open question: *"Points-to-cash conversion
representation. Points are integers; the cash equivalent shown at withdrawal
needs a rate. **Leaning toward storing the rate used on the payout request**
(same reasoning as §3.4), decided when the withdrawal screen is built."*

It is built. The lean was right, and for exactly the reason §3.4 gives about
the reward rate on a conversion: **the rule in force at the moment of the event
is part of the event.** Without the stored rate, a payout's cash value cannot
be explained once configuration moves, and "why was my 5,000 points worth less
than my friend's 5,000 points" has no answer.

So `payout_requests` carries `cash_amount_minor`, `cash_currency` and
`points_per_currency_unit`, all resolved at submission.

The conversion rounds **down**. A fractional cent rounded up is a fraction of a
cent nobody earned, and doing that on every payout is a slow leak with no
record; the remainder stays as points the user keeps.

---

## D43 — The payment destination is validated for storability, not for format
**Feature 11**

PROJECT.md §4.6 requires that "adding a payment method an admin can settle
manually requires no deployment". Per-method format rules — a PayPal address is
an email, an IBAN has a checksum, a wallet address has a prefix — are code, and
code is a deployment. The two requirements cannot both be satisfied by
validating format.

They do not need to be. **Under a manual payout model the validator is the
human who reads the destination before sending the money.** That is not a
weakness of the model, it is the model: an admin who cannot tell a valid
destination from an invalid one cannot send the payment either.

What is validated is that the value is *storable and legible*: bounded length,
no line breaks, no invisible characters. Those are not format concerns — an
admin copies this string into a banking app, and a zero-width character in the
middle of a wallet address is money sent nowhere.

An automated payout provider would validate format, and it would do so where
the format knowledge belongs: inside the provider, behind §11.4's seam.

---

## D44 — `admin` opens the transaction for payout transitions, so `payouts` never imports it
**Feature 11**

Every payout transition must write its audit entry inside the same transaction
as the money it moves (§10.2, rule 5). `AdminAuditService` belongs to `admin`,
and `admin` already imports `payouts` for the queue surface — so the obvious
implementation makes the two modules import each other.

Resolved by following the pattern the codebase already had rather than reaching
for `forwardRef`: **`AdminProvidersService` and `AdminUsersService` already open
the transaction in `admin` and pass the client down** to the owning module's
service. `AdminPayoutsService` does the same — it opens the transaction, calls
`PayoutsService.applyTransition(tx, …)`, and writes the audit entry beside it.

`PayoutsService` keeps everything that decides what a transition *means*: the
state machine, the lock effect, the row. `admin` supplies who did it. The
dependency stays one-directional, and §4.1's `payouts → rewards` remains the
only arrow out of this module.

---

## D45 — Reading a payment destination is an audited action, on a GET
**Feature 11**

DATABASE.md §3.5 requires the payment destination to be "never returned in list
responses, only on the detail view an admin explicitly opens, **and that view is
audited**".

Implemented literally: `GET /admin/payouts/:id` writes a
`payout.destination_viewed` audit entry before returning. A GET with a side
effect is a deliberate exception to the obvious rule, and the alternative — a
POST that reads — would hide the exception behind a verb rather than remove it.

The entry records **that** the destination was read, never what was read. An
audit trail holding the secret it audits is a second copy of the secret (§16.4),
and it is a copy with a much longer retention.

---

## D46 — A missing rejection reason is a validation failure, not a transition one
**Feature 11**

Found during the live walkthrough, not by a test: rejecting a payout with no
reason returned HTTP 422 carrying `PAYOUT_INVALID_TRANSITION`. The status was
right and the code was wrong, and the integration test asserted the wrong code
too, so the suite agreed with the bug.

The two failures behind that one code need different fixes. "You left the reason
box empty" is corrected by filling it in; "this request is already rejected" is
corrected by reloading the queue, because a colleague got there first. §15.1
draws exactly this line — `ValidationError` for a malformed request,
`DomainError` for a well-formed one the rules forbid — and a `DomainError`
constructed with an overridden 422 was straddling it.

Now a `ValidationError` with `fields: [{ field: 'reason' }]`, which is the
family that carries per-field detail (§15.3). No new error code: the field list
already says which box, and a `PAYOUT_REASON_REQUIRED` code would add a second
way to express what `VALIDATION_FAILED` plus a field name already expresses.

---

## D47 — The conversion↔evaluation link is one column, not two
**Feature 12**

DATABASE.md §3.4 gives `conversions` a "fraud evaluation reference"; §3.6 gives
`fraud_evaluations` a "conversion reference". One 1:1 edge, described from both
ends — which is normal for prose and would be a defect in a schema.

Stored once, on `conversions.fraud_evaluation_id`. Two columns holding one edge
is two things that can disagree, and there is no query either answers that the
single column plus a relation does not.

The direction is forced by ordering, not preference: scoring happens at §10.3
step 4 and the conversion row is created at step 6, so the evaluation exists
first and cannot carry a reference to a row that does not exist yet. The
evaluation keeps its own `user_id` for the same reason — an evaluation whose
conversion was never created still belongs to somebody, and "everything ever
scored for this account" is the query the payout review screen runs.

---

## D48 — A rule's settings are one configuration key, not four
**Feature 12**

PROJECT.md §4.7 requires every rule's threshold **and** its action to be
configuration. The obvious shape is four keys per rule — enabled, threshold,
weight, action — which is twenty-eight keys for seven rules and, worse, makes it
possible to save half a decision.

An admin loosening a threshold while softening its action would have a window,
however brief, where the new threshold ran with the old action. One JSON key per
rule, validated as a whole, has no such window. It also keeps the admin screen
readable: seven rules, seven rows.

The cost is that changing one field means writing the object back, which is what
a form does anyway.

---

## D49 — Velocity counters are counted in Postgres, by the caller
**Feature 12**

DATABASE.md §11.2 says `fraud` reads velocity counters from Redis through
`core/cache`. Two halves of that are deferred and one is honoured.

**Honoured:** `fraud` does not query `clicks`. It queries nothing — the caller
assembles a `FraudEvaluationContext` of primitives (§4.2), and the boundary
§11.2 exists to protect is fully intact.

**Deferred:** the counters come from Postgres rather than Redis, and
`core/cache` is still unbuilt. Three reasons, in order of weight:

1. These counts decide whether to withhold someone's money. Postgres counts are
   exact; a Redis counter that expired, was never written, or was lost to a
   restart under-counts silently, and the failure looks like a clean account.
2. `clicks` already counts its rate limits this way (D21). One mechanism.
3. TODO T15 already anticipated this exact moment and said the right answer is
   *one shared counter* rather than two implementations that can disagree —
   which is an argument for building it once, deliberately, when there is a
   measured cost to point at.

T15 carries the trigger. Nothing about the deferral is invisible: the counts are
two indexed queries on the conversion path, and the path already runs on a
worker where nobody is waiting.

---

## D50 — A confirmed hold is `REJECTED`, not `REVERSED`
**Feature 12**

An admin who confirms a held conversion as fraud has its credit reversed
through `RewardAccountingService.reverse()`. The conversion's own status could
plausibly be either.

`REVERSED` is what a chargeback writes on the conversion it points at, and it
implies a reversal *row* exists — DATABASE.md §3.4: "A chargeback creates a new
conversion row of reversal type pointing at the original, and marks the original
reversed." Here no provider disputed anything and no such row exists; a reviewer
decided. Using `REVERSED` would make the two situations indistinguishable in a
query, and the chargeback-rate rule counts exactly that status — a confirmed
fraud hold would inflate the user's *provider* chargeback rate, which is a
different fact about a different party.

`REJECTED` already means "recognised, and it earned nothing", which is precisely
the outcome. Its contract comment named the provider as the only rejecter; that
comment is now accurate about both, and no status was added — a fifth status for
a case the fourth describes would be vocabulary, not information.

---

## D51 — The cache is invalidated after the commit, by the transaction's owner
**Feature 13**

`ConfigurationService.set()` now accepts a caller-supplied transaction client,
so the value, its history row and the `admin_audit_log` entry commit together
(DATABASE.md §3.7). That moved one thing out of the service's control: the
moment of commit, and therefore the moment it is safe to drop the cache.

**Invalidating inside the transaction would be worse than not invalidating at
all.** Between the invalidation and the commit the new value is invisible to
other connections. A concurrent read in that window finds an empty cache, goes
to the database, gets the *old* value, and caches it — and there it stays until
the process restarts. Stale configuration that survives every subsequent request
is precisely the failure this cache must never produce, and it would appear only
under load, only sometimes.

So `set(…, client)` does not invalidate; the caller does, after `$transaction`
resolves. `set(…)` without a client keeps owning both, unchanged.

The ordering has its own unit test asserting the *sequence*
`set → audit → commit → invalidate`, not merely that invalidation happened — a
version that invalidates inside the transaction calls it exactly as many times.
Verified by moving the call inside and watching that test, and only that test,
fail.

---

## D52 — `unset` is a first-class operation, not a delete of the row
**Feature 13**

The service could change a value and never remove one. That made "reset to
default" — the most ordinary thing on a settings screen — impossible: once a
hold period was set, it could be set to something else forever but never
returned to the value code declares, and a provider override could never stop
shadowing GLOBAL.

`unset(key, options, client?)` deletes the row **and writes a history entry with
a null `newValue`**. Null there means "returned to the resolution chain", which
is a different fact from any value it could have been set to, and the timeline
would otherwise show a value simply ceasing to be mentioned.

Two consequences worth stating:

- **Removing nothing is not an error.** `unset` returns null when no row
  existed, and the admin layer skips the audit entry. "Use the default" was
  already true, and failing would make the reset button's behaviour depend on
  a state the admin cannot see. An audit entry whose before and after are
  identical is noise in the one log that has to stay readable.
- **It removes one scope at a time.** Resetting a provider override returns that
  provider to GLOBAL, not to the default — the chain, not the bottom of it.

---

## D53 — History carries the scope of every entry
**Feature 13**

`history()` returned old value, new value, actor, reason and timestamp — and not
which scope had changed, although the column has been on the table since Feature
4.

For a key set at one scope this is invisible. For a key with a GLOBAL value and
three provider overrides — exactly what the resolution chain exists for — the
timeline becomes a list of "30 → 60" entries with no way to tell which of the
four moved. DATABASE.md §3.7 keeps this table separate from `admin_audit_log`
precisely because "show me this key's history" is a per-key timeline, and a
per-key timeline spans every scope that key is set at.

Found by writing the detail screen, which is the first thing that ever displayed
one of these rows to a person.

---

## D54 — An unknown key is a 404 on every verb of its URL
**Feature 13**

`ConfigurationService` refuses an unregistered key with a 422, which is right
for a service call where the key is an argument the caller got wrong.

On the admin surface the key *is* the URL. `GET /admin/configuration/invented`
answering 404 while `PUT` on the same URL answered 422 is two answers about one
resource, and the second reads as "the key exists, your value was bad" — which
is the opposite of the truth. The admin layer therefore performs the same
registry lookup first and gives it the status its own surface implies.

Not a second validator: no schema is re-checked and no scope rule is re-decided.
The boundary it enforces is §5.2's — a caller cannot invent a key, because every
key is declared by the module that owns the rule.

---

## D55 — Stored configuration is re-validated on read, and a bad value is a miss
**Feature 13, from the pre-production review**

`set()` validates on write, so nothing written through the service is
malformed. `resolve()` did not validate on read, so anything that got into the
table by another route was handed to business rules as though it were valid.

Two routes are ordinary, not exotic: **a key whose schema changes in a later
release while a value is stored under the old shape**, and a migration or seed
writing a row directly. The first became likely with this feature — before it,
almost nothing was stored.

**The failures were silent and specific.** A `fraud.rules.*` value stored under
an older shape, missing `weight` and `action`, produced:

- `score: NaN`, which PostgreSQL refuses on an integer column — the evaluation
  insert fails, the conversion job throws, BullMQ retries, and the postback ends
  `FAILED`. A user completed an offer and was never credited.
- `action: ALLOW` for a rule that had **fired**, because `undefined` compares as
  less severe than every real action. Fraud holds silently stop happening.

Neither logs anything by itself. Both were reproduced before the fix.

`readStored` now parses the row against the key's registered schema. A failure
is logged at `error` — §17.1's level for "a thing that should have happened did
not" — and **treated as a miss**, which is ARCHITECTURE.md §14.4's own
prescription: *"Cached values are typed on read, not trusted. A stale shape from
a previous deploy is treated as a miss."* The rule was written about the cache
and applies with more force to the row behind it, because a row outlives every
deploy.

Treating it as a miss makes the chain fall through: a bad PROVIDER value yields
the GLOBAL one, a bad GLOBAL value yields the declared default.

**The residual risk, stated plainly.** Falling back can be *less* conservative
than the operator intended — an admin who lowered `payouts.maximum_points` and
whose row later became invalid gets the more permissive default back. The
alternative, throwing, would take down every business operation that reads the
key. The mitigations are the `error` log, the `valid: false` flag now on every
override in the admin API, and T39.

---

## D56 — Configuration writes read their own "before" inside the transaction
**Feature 13, from the pre-production review**

`set()` and `unset()` both read the previous value through the in-process cache,
outside the transaction, and used it for the history row's `oldValue` and the
audit entry's `before`.

For `unset()` this was a defect with a 500 attached — see the fix below. For
`set()` it was an accuracy problem: a cache entry this process happens to hold
can be stale, and an audit trail that records a change *from a value that was
never there* is worse than one that records nothing.

Both now read inside the transaction.

**This narrows the window; it does not close it.** There is no row lock on the
configuration row, so two writes landing simultaneously still each report the
value they read. That residual costs audit precision only — never the value in
force, which the upsert settles atomically — and is recorded as T38.

---

## D57 — `deleteMany`, not `delete`, and no cache pre-check
**Feature 13, from the pre-production review**

`unset()` checked the cache for "is anything stored?" and then called `delete`.
That was wrong in both directions:

- **Two concurrent resets** — a double-clicked button — both saw a value, both
  called `delete`, and the loser hit Prisma's record-not-found, which nothing
  caught and which reached the admin as a **500**. Reproduced.
- **A stale cache saying "nothing stored"** for a row written by another process
  made the reset silently do nothing while answering 200.

The check is gone; the transaction is the only authority. `deleteMany` reports a
count instead of throwing, so under contention the second transaction blocks on
the first one's row lock, re-evaluates its predicate against the committed
state, matches nothing, and returns zero — the race resolves into an ordinary
no-op.

**Catching the exception would not have worked.** In PostgreSQL a failed
statement aborts the whole transaction, so the history row that follows could
not have been written anyway. The fix had to avoid the error, not handle it.


---

## D58 — The invalidation channel is `core/events`, not `core/cache`
**Feature 14**

T3 recorded itself as "blocked on `core/cache`" for two features. That blocker
was a mis-statement, and unblocking it meant saying so rather than building the
module it named.

Nothing in this feature caches anything. Publishing a notification that a value
changed and holding a copy of that value are different jobs, and §14.1's cache
still has no consumer — the one thing that would justify building it (P6, and
the "arrives with its first consumer" rule the module list already applies to
`core/http`). Building a cache in order to unblock a channel that does not need
one is the framework P6 forbids, arrived at by following a note instead of the
argument behind it.

So `core/events` owns one Redis channel, one message shape, and a `subscribe` /
`publish` pair. The dependency direction is what keeps it small: `core/config`
and `modules/providers` reach *down* and register a handler; the bus never
reaches back and never learns what a configuration key or a provider is.

**`HealthService.register()` is the precedent** — a core service that collects
handlers it knows nothing about, so that the things being collected do not have
to know about each other.

---

## D59 — A publish that fails degrades; it never fails the write
**Feature 14**

By the time anything is published, the database transaction has committed and
the writing process has already dropped its own cache entry. Failing the request
there would report a change that *did* happen as one that did not — and the
admin's obvious response, retrying, would write a second history row and a
second audit entry for one intended change.

So `publish()` catches, logs at `error` (§17.1: a thing that should have
happened did not), and returns. ARCHITECTURE.md §14.4 states the rule this
follows — *"cache failures degrade, never fail"* — and this is the first code
that has to obey it.

> **Corrected by D64.** This decision originally said the system degrades to
> "correct on the writing process, stale elsewhere until reconnect or restart".
> The review found that wrong in the case that matters most: when only the
> *publisher* fails, no other process reconnects, because none of them
> disconnected. There was nothing to recover from. D64 closes it; the sentence
> is left here struck rather than edited away, because the gap it hid is the
> reason D64 exists.

Two settings make the degradation fast rather than merely eventual. The
publishing connection runs with `enableOfflineQueue: false`, so a publish issued
while Redis is unreachable rejects immediately instead of waiting in memory for
a reconnection; and the process does not block on Redis at boot, because a
channel that is optional at runtime cannot be mandatory at startup.

**"Fail fast" here means fast to *fail*, and it covers exactly one failure: a
Redis this process is not connected to.** `enableOfflineQueue: false` governs
commands issued while the connection is down or reconnecting — it rejects them
instead of parking them in memory. It says nothing about a command that has
already gone out on an established connection. Such a command has no timeout
(none is configured, and ioredis sets none by default), so a Redis that is
**connected but not answering** — blocked on a Lua script, forking for a
`BGSAVE`, swapping — leaves `publish()` awaiting a reply that never arrives, and
the admin request awaiting `publish()`. The transaction has already committed at
that point, so the change is applied while the request hangs.

That second failure mode is **not** handled, deliberately, and is recorded as
TODO T54 with its trigger. This paragraph exists because the original wording
implied it was: a decision that claims more than the code does is worse than one
that claims nothing, since the next person reads the claim instead of the
setting.

**Verified live** by stopping Redis and writing a value: HTTP 200 in 67ms, with
`Stream isn't writeable and enableOfflineQueue options is false` logged beside
the key it could not announce. That is the disconnected case — the only one the
setting addresses.

---

## D60 — A message that cannot be read invalidates everything
**Feature 14**

The obvious handling for an unparseable broadcast is to log it and move on. That
is wrong here, and the reason is the rolling deploy.

During one, processes on the old build receive messages from processes on the
new build. If the payload gained a field or the protocol version moved, every
one of those messages is unreadable to the old process — and **every one of them
means a value it has cached just changed**. Dropping them makes the old
processes silently stale for the length of the deploy, which is the failure
§14.3 exists to prevent, arriving at the one moment nobody is watching for it.

So an unreadable message is treated as "something changed and I cannot tell
what": every registered domain is told to drop everything. Always safe, since
the next read repopulates from the database; never wrong, only occasionally
wasteful. That is the correct direction to be imprecise in.

The same reasoning governs the parser's strictness in the other direction. A
*scope* it does not recognise is accepted rather than rejected, because a scope
an older build cannot resolve simply matches no cache entry — whereas rejecting
the message means it never learns anything changed at all. Strict about the
envelope, permissive about the payload's vocabulary.

---

## D61 — A reconnect drops every cached copy
**Feature 14**

Redis pub/sub has no persistence, no backlog and no acknowledgement. A message
published while a process is disconnected is gone, and there is no sequence
number for the process to notice the gap with.

A subscriber that comes back therefore cannot distinguish "nothing changed while
I was away" from "everything did", and only one of those two assumptions is
safe. It assumes it missed everything: `ready` firing for the second time drops
every cached copy in every domain.

The cost is one repopulating read per key actually used afterwards. The
alternative is a process serving a value that changed during a one-second
network blip, indefinitely and silently, with the admin panel showing the new
value the whole time.

**This is also why the existing backstops stay.** The catalog tick still re-reads
the provider table before every decision (its comment now says why), because a
periodic re-read is what bounds the gap when a message is lost — pub/sub makes
propagation fast, it does not make it guaranteed, and nothing may be built on an
assumption of delivery. Durable work goes on a BullMQ queue (§13).

**Verified live:** Redis stopped, a value written through `api`, Redis started.
The worker logged the resync and priced the next catalog sync at the new rate —
a change it was never told about.

---

## D62 — `invalidate` and `invalidateAndBroadcast` are two methods, not a flag
**Feature 14**

Every cache in this system now has a local invalidation and a broadcasting one.
They could have been one method with a `broadcast = true` parameter.

They are not, because the failure a parameter invites is a loop: a handler that
rebroadcasts what it just received is received again, forever, by every process
including the one that sent it. A default in either direction puts that loop one
forgotten argument away at a call site whose author is thinking about a cache,
not about a channel. Two names cannot be confused.

The split also settles which callers want which, and the answer is not uniform:
`ProvidersService.reload()` is wanted verbatim by the boot sequence, by the
subscriber, and by the two read-repair paths D35 introduced — none of which is a
change anybody else needs to hear about — while only the three admin write paths
want `reloadAndBroadcast()`. A parameter with a default would have made the boot
sequence broadcast on every process start, which turns a rolling restart of N
processes into N² reloads.

---

## D63 — Reloads are serialised rather than versioned
**Feature 14**

T14 asked for "a guard against a stale registry reload overwriting a fresh one"
and named this feature as its trigger, correctly: a remote invalidation now
arrives at a moment nothing chose and can land in the middle of a local reload.

T14 proposed a version or timestamp on the snapshot. A promise chain was built
instead. It is a stronger guarantee — two reloads cannot overlap at all, so
there is never a pair of snapshots in flight to order wrongly — and it carries no
version that a future writer has to remember to stamp. Reloads happen a few
times a week, so the serialisation costs nothing anybody can measure.

One detail is load-bearing: the chain continues past a *rejected* reload. If it
did not, a single transient database error would freeze the registry for the
life of the process, and the symptom would be "every provider looks disabled",
hours later, with nothing pointing back at the error.

---

## D64 — A recovered publisher announces what it could not send
**Feature 14, from the pre-production review**

D59 accepted that a failed broadcast degrades rather than fails, and described
the degradation as "stale elsewhere until reconnect or restart". The review
found the case that description does not cover, and it is the one that matters:

**When only the publishing connection fails, nothing on the receiving side ever
notices.** Their subscriptions were never interrupted, so D61's resync — which
depends on a subscriber coming *back* — never fires. And configuration, unlike
the provider registry, has no periodic re-read to heal it: the catalog tick
re-reads the provider table before every decision, but nothing re-reads a
configuration key that is already cached. So the stale value survives until that
key is written again or the process is restarted, on every other process at
once, with the admin panel showing the new value the whole time.

A single connection dropping while others to the same Redis survive is ordinary
— an idle timeout, a connection limit, a proxy recycling a socket.

**The sender is the only party that can notice, so the fix belongs there.** A
failed send records its *domain*; when the publisher's connection comes back,
every recorded domain is announced wholesale and the record is cleared.

Three properties, each of which is the decision:

- **Domains, not entries.** Keeping the lost entries to replay them would make
  this a buffer, and a buffer is the first half of the message queue D58 says
  this is not. One whole-domain message is always a superset of what was lost.
- **Nothing is announced if nothing was lost.** The set is only ever filled by a
  send that actually failed, so an idle reconnection cannot make every process
  on the platform drop its caches. Recovery must not cost more than the failure.
- **A failed announcement is retried, not dropped.** If the connection goes
  again mid-recovery the domains go back into the set, and the next `ready` is
  the same method.

**Verified live**, staged so that only the publisher was affected: the
publisher's connections were killed in a loop faster than ioredis could
reconnect, while eight writes went through the admin API.

```text
api    ERROR x8  Could not broadcast a cache invalidation
                 err = Stream isn't writeable and enableOfflineQueue options is false
api    WARN      The invalidation publisher recovered; announcing ...
                 domains = ['configuration']
worker           re-priced the catalog at the new rate      147/48  ->  98/32
worker           subscriber resyncs: 0   "Lost the Redis": 0
```

The last line is the point. The worker never disconnected, so D61 cannot be what
healed it — the announcement is.

**Connections are named** (`gemone:invalidation-publisher` /
`gemone:invalidation-subscriber`) as part of this. A process holds several Redis
connections and `CLIENT LIST` shows them as indistinguishable addresses, which
matters exactly when somebody is working out why a change did not propagate. It
is also what made the failure above stageable at all: `CLIENT KILL` can target
the publisher and leave every subscriber connected, which is the one arrangement
a Redis outage cannot produce.

---

## D65 — A read that was overtaken declines to cache, and returns anyway
**Feature 14, from the second pre-production review**

D51 established that the cache is invalidated *after* the commit, and argued
that this closes the window in which a concurrent read could load the old value
into a freshly-emptied cache. **It closes one window and leaves an adjacent
one.**

A read is not atomic. `readStored` checks the cache, awaits a query, and writes
the result back. An invalidation landing between the query being *issued* and
its result being *stored* deletes an entry that does not exist yet, and the
write-back then reinstates precisely the value the invalidation was about.
Nothing further is coming, so the process serves it until that key is written
again or it restarts — which is the failure D51 names as the one this cache must
never produce, reached by a route D51 did not consider.

**Reproduced deterministically** before the fix: read issued, invalidate,
query resolves with the pre-write row, next read returns it forever.

**This predates the §14.3 channel** — the same interleaving was reachable
in-process, because `await` yields. But the channel makes it materially more
likely, and that is why it belongs to this feature rather than to a note: D60,
D61 and D64 all drop *every* entry at once, so immediately after any resync
every key's next read is a query, and the number of reads in flight is at its
maximum exactly when an invalidation is most likely to arrive.

### The fix

A generation counter on the cache — not on the data. Every `invalidate` and
`invalidateAll` increments it. A read captures it before its query and compares
after; if it moved, the value is returned to the caller and **not** stored.

Four properties, each of which was a constraint rather than a preference:

- **`invalidate` stays O(1)** — a delete and an increment. No lock, no scan, no
  second structure to keep in step.
- **A cache hit is untouched.** The counter is read only on the miss path, so
  the hot path — a configuration read on nearly every business operation
  (§14.3) — is unchanged.
- **External behaviour is unchanged.** The overtaken read still returns what it
  found. A read that began before a write legitimately observes what was there
  when it began; that is ordinary read timing, not staleness, and converting it
  into a retry would change the contract to fix something that is only about
  persistence.
- **Declining to cache is always safe.** The cost of declining wrongly is one
  extra query on the next read. The cost of *not* declining when it mattered is
  a wrong value in force, indefinitely. The asymmetry decides the design.

### Why a counter is sufficient, and a lock is not needed

The comparison and the `cache.set` are in the same synchronous block, so nothing
can run between them. The only concurrency here is the interleaving of awaited
continuations on one thread, and a monotonic integer captures exactly the fact a
read needs: *did the cache's state change while I was away.* A lock would
serialise reads to solve a problem that is not contention.

### What it deliberately gives up

The counter is global, so invalidating one key discards the write-back of every
read in flight, including reads of unrelated keys. That is conservative in the
safe direction and costs one query per discarded read. Per-entry generations
would be precise and would add a second map with its own lifetime to reason
about, for a saving measured in single queries at rates of a few writes a week.
Recorded as T53 rather than built.

---

## D66 — Wall eligibility comes from the registry, not from `providers.is_enabled`
**Feature 15**

The obvious filter for the wall is SQL: join `offers` to `providers` and take
`is_enabled = true`. That is *almost* right, and the gap is the expensive kind.

`ProviderRegistry` refuses two kinds of provider, and only one of them is a
column. A disabled provider is `is_enabled = false` (§7.3). A provider whose
adapter could not be built — because the slug was removed from the code beneath
an existing row, or a credential is missing from this deployment — is
`is_enabled = true` and completely unusable. `ClicksService.create` calls
`registry.require(slug)` and so refuses both.

A SQL filter would therefore list offers whose click is guaranteed to fail, and
the failure is not a clean 409: the adapter that cannot be built is the same one
that verifies the postback. A user who somehow got through would do the work,
the conversion would arrive unverifiable, and it would be quarantined —
PROJECT.md §3.2's *"I completed this and was not paid"* ticket, generated by us.

So the wall takes its eligible provider ids from the same object the click path
consults. **The two surfaces agree by construction rather than by two copies of
one rule**, which is the only version of this that stays true.

It is also free. The registry is an in-memory snapshot precisely so the hot
paths do not pay for it, and since §14.3 it is correct on every process rather
than on whichever one an admin happened to reach.

**Proven by reversion:** replacing the registry lookup with the `is_enabled`
equivalent fails exactly one integration test — the one that plants an enabled
provider row with no usable adapter — and nothing else.

---

## D67 — The wall has its own serialiser, written by addition
**Feature 15**

`OfferSummary` carries `payoutAmountMinor` and `payoutCurrency`, because every
caller it has had so far is an admin. The wall needs the same row without them:
what a provider pays us is our commercial relationship, and shown beside what
the user earns it is also the margin on every offer, published to anyone with an
account.

`WallOffer` is a **separate type listing what a user may see**, not
`Omit<OfferSummary, …>`. The direction is the decision. A subtractive type
defaults to exposure: a column added to `offers` and threaded into
`OfferSummary` for some future admin screen would appear on the wall
automatically, and nothing would fail. An additive type defaults to secrecy, and
its failure mode is a field missing from a screen — visible, cheap, and noticed
by whoever wanted it.

The same reasoning governs `toWallOffer`, which names every field rather than
spreading the row.

**Enforced, not documented.** `offers-wall.arch.spec.ts` asserts both that the
serialiser's source never mentions the three forbidden fields *and* that its
output never contains them. Two assertions because either alone is satisfiable
while the rule is broken: a spread mentions no forbidden name and leaks all
three. A third test pins the fields that must be present, so the rule cannot be
"kept" by returning an empty object. All three verified by deliberate violation.

---

## D68 — An offer that is not on the wall is a 404, and a click on it is a 409
**Feature 15**

The same offer produces two different statuses depending on which surface is
asked, and that is deliberate rather than an inconsistency to reconcile.

`GET /offers/:id` answers **404** for an offer that does not exist, one that was
deactivated, and one whose provider is switched off. A browsing user has no
legitimate way to act on the difference, and distinguishing them turns the wall
into an oracle for which providers we run and what state each is in.

`POST /clicks` answers **409 CLICK_OFFER_UNAVAILABLE** for the same offer,
because there the user has *chosen* something and is owed the reason it did not
work. A 404 there would read as "your request was wrong".

The rule underneath: browsing reveals nothing about what is hidden; acting
explains why it failed.

---

## D69 — The `maintenance` queue arrives with reconciliation, separate from `rewards`
**Feature 16**

§13.1 has always listed `maintenance`, and `queue.constants.ts` has always said
the missing queues "arrive with the work that fills them, because an empty queue
is still a thing to configure, monitor and reason about". Reconciliation is that
work, so the queue is declared now and not before.

**Why not put it on `rewards`, which it reads.** The two have opposite failure
characteristics, which is the only axis §13.1 splits on. `rewards` carries
maturation — short units of work, each taking a balance row lock, where being
late means someone's points are not withdrawable yet. Reconciliation is a scan
over every balance. Sharing the queue would put a sweep of the whole table in
front of maturation for as long as the sweep takes, and the queue exists
precisely to stop one kind of work from doing that to another.

Concurrency 1, as §13.1 specifies. Two scans at once contend for the same pages
and neither finishes sooner, and the continuation chain is sequential anyway.

Scheduled at a fixed hour (03:00 UTC) rather than `{ every: 24h }`. An interval
drifts to whatever time the worker last restarted, so the heaviest scan in the
system would eventually wander into peak hours with nothing recording why.

**The timezone is pinned explicitly, and only live verification caught that it
had to be.** BullMQ resolves a cron pattern in the *server's local timezone*
when none is given. The scheduled time read back out of Redis on a UTC+3 machine
was `2026-08-06T00:00:00Z` — the pattern said three in the morning and the job
was set to run at midnight. In a container that happens to be UTC the bug is
invisible, which is exactly why it is worth pinning: without `tz`, the hour this
job runs is a property of the host it was deployed to, and two replicas in
different zones would disagree about when "nightly" is. With `tz: 'UTC'` the
same read returns `03:00:00Z`.

---

## D70 — The sweep pages the balance table from inside the rewards service
**Feature 16**

The job needs a list of users to check, which is a read of `user_balances`. It
gets it from `RewardAccountingService.findUsersToReconcile`, not from Prisma.

**P2 admits no exception for reads.** `arch.spec.ts` fails the build on
`prisma.userBalance` anywhere outside `modules/rewards`, and it names the
offending file — verified by deliberately paging the table from the processor,
which failed exactly one assertion with `jobs/reconciliation.processor.ts` in
it. The rule is worth keeping for a read because a second reader is how the
first one's guarantees stop being the only ones: the balance is then read from
two places and only one of them takes the lock that makes it correct.

**The cursor is `userId`, which is unique on that table.** A non-unique page key
repeats and skips rows — the defect Feature 15 shipped and had to fix — and on
this sweep the consequence is worse than a bad screen: skipped balances are
never checked, while the run still reports "all clear". A reconciliation job
with a blind spot is more dangerous than no reconciliation job, because it
manufactures confidence. Completeness is asserted by a test that plants drift
past the first page boundary.

Iterating `user_balances` rather than `users` is what makes the sweep total:
`openAccount` runs inside the registration transaction (DATABASE.md §10.1), so
a user without a balance row does not exist.

---

## D71 — Reconciliation ships with error-level logging, ahead of alerting
**Feature 16**

T27 deferred this job with a specific argument: *"§17.3's alerting is future
work, and a drift detector that reports to nothing is worse than none — it
creates the belief that somebody is watching."* That argument is why the job did
not exist for six features, and shipping it now overrides it, so the override is
recorded rather than assumed.

**What changed is that "nothing" was never the alternative.** The job logs at
`error`, which is the same surface every other failure in this system reports to
(§16), and a failing job lands in BullMQ's failed set, which §13.2 designates as
the dead-letter queue an admin already reviews. What is still missing is the
push — nobody is woken up. That is a real gap and it stays recorded (T59).

**And the cost of continuing to wait was concrete.** R5 schedules the P2 ledger
decision on *"the reconciliation job's drift rate as the deciding evidence"*, and
§23.1 reopens the append-only ledger "when reconciliation reports unexplained
drift". Both were unfirable conditions: no job, no drift rate, no trigger. The
decision they gate is the largest deferred decision in the system, and it was
scheduled against evidence nothing was producing.

**Reports; never repairs.** R5 is explicit that drift is "the signal to migrate —
not a bug to patch", so the sweep is observably read-only: an integration test
corrupts a balance, runs the sweep, and asserts every column and the version
counter are untouched.

---

## D72 — Reconciliation reads one snapshot, at `RepeatableRead`
**Feature 16**

`reconcile` compares a balance against the sum of the history that is supposed
to explain it. Those are two reads, and **they have to be as of the same
instant** or the comparison is not a comparison at all.

Under `ReadCommitted` — PostgreSQL's default, and what the method used when it
was written — every statement takes its own snapshot. A credit committing
between the balance read and the history aggregate is counted on one side and
not the other, and the method reports drift on a ledger that is perfectly
consistent. **That is measured, not feared:** with writes landing concurrently
it reproduced at roughly 2% of reads, always by exactly the amount of one
in-flight movement.

The three reads now run inside a single transaction at `RepeatableRead`, which
fixes the snapshot at the first statement and holds it for all of them.

**Why not `ReadCommitted` with the transaction alone.** A transaction without
the isolation level does not help — it makes it *worse*. Prisma runs an
interactive transaction on one connection, so the reads serialize instead of
overlapping, which widens the gap between them: reverting only the isolation
level and keeping the transaction produced ~343 false positives per run against
~81 with no transaction at all. The isolation level is the fix; the transaction
is only what carries it.

**Why not `Serializable`.** All this needs is that its own reads agree with each
other, and a stable snapshot is exactly that. `Serializable` would add predicate
locks and a serialization-failure retry path to a transaction that writes
nothing — machinery for an anomaly that cannot arise here, since a read-only
transaction never conflicts.

**Why it matters more here than in an ordinary read.** This method's output is
**evidence**. R5 schedules the P2 ledger decision on "the reconciliation job's
drift rate", and §23.1 reopens the append-only ledger "when reconciliation
reports unexplained drift". A false positive is indistinguishable from a real
one in the log, so an unstable read does not merely produce noise — it puts the
largest deferred decision in the system on unreliable evidence, in the direction
of acting when nothing is wrong.

**Read-only, and still not a repair.** The transaction exists to make the *read*
coherent; it grants no licence to write. Nothing in it takes a row lock, so
concurrent credits, debits and payouts run untouched — a reader that blocked
writers would be a reconciliation job that costs the platform money to run. And
it still does not correct a drifted row, for the reason D71 gives: repairing it
would destroy the evidence the decision above is waiting for.

**The cost is real and accepted.** 6.54ms per reconcile against 2.03ms before —
3.2×, measured over 300 sequential reads on a quiet database. The baseline
issued its three queries concurrently; this one serializes them behind
`BEGIN`/`COMMIT`. A fast answer that cannot be trusted is worth nothing here, so
the trade is one-sided — but it is written down in T28, whose trigger it brings
closer.

**Enforced by test**, not by this entry: an integration test runs eight readers
against a continuous writer and asserts that a consistent ledger never reports
drift. Removing the transaction *or* the isolation level fails it.

---

## D73 — Login counters: what increments, what clears, and what deliberately does not
**Feature 17**

Login throttling (§8.3, closing T2) keeps two counters — one per account, one
per address. Three rules govern them, and each is a decision rather than an
implementation detail.

### Only a failed authentication increments

What this control measures is **guessing**, not traffic. Counting successful
logins would turn it into a rate limiter for the endpoint — a different control,
listed separately in M5 and out of this feature's scope — and its practical
effect would be to throttle a mobile client that renews its session on schedule.
Failure is the signal, so failure alone is counted.

> **Amended after the concurrency review: the counter is now taken *before* the
> verdict and given back on success.** The rule above is about what the counter
> ends up measuring, and that is unchanged — a proven-correct password releases
> its own reservation, so what remains counted is failures. What changed is when
> `INCR` is issued, and it had to change: reading the counter before argon2 and
> writing it after left ~40ms in which every concurrent request read the same
> number, so a ceiling of 5 admitted **all ten** of ten simultaneous attempts,
> on both counters. `INCR` is atomic and returns a distinct value to each
> caller, so exactly `limit` of them now land inside the ceiling — no lock, no
> script, and one fewer round trip than before. The comparison moved from `>=`
> to `>` because the count now includes the attempt being judged; the externally
> visible ceiling is identical.
>
> Two consequences are real and accepted. An attempt **abandoned mid-flight**
> stays counted, which errs towards refusing. And a Redis failure while
> reserving now **refuses the request** rather than letting it through
> uncounted: the increment is no longer bookkeeping after the decision, it *is*
> the decision, so §15.4 applies to it. The best-effort half of the asymmetry
> survives where it still belongs — releasing after a login that already
> succeeded never fails that login.

### A verified password clears the account counter

A correct password is **proof that the guessing this counter measures has
ended**, so keeping the count afterwards protects nothing and costs something
real: a user who mistypes four times and then succeeds would stay one typo away
from a lockout for the rest of the window.

Cleared on password verification rather than on completed login — before the
account-status check, not after. What earns the reset is a correct credential,
not an authorized session. It also keeps the two failing paths symmetric: each
performs one hash and one Redis operation before it throws.

### The IP counter survives a successful login, on purpose

This is the part that looks like an oversight and is not. The two counters
answer different questions: the account counter asks *"is somebody guessing this
account's password"*, the IP counter asks *"is this source guessing across many
accounts"*. **One correct password says nothing about the other fifty accounts
being tried from the same address.**

If success cleared it, the ceiling would collapse against a trivial attack: fail
a few times, log into an account you own, repeat indefinitely. Registration is
open, so every attacker has such an account. Treating proof of identity as proof
of intent is the whole error, and it would leave the IP limit as decoration.

### Why Redis here, when D49 chose Postgres

D49 moved the fraud and click velocity counters to Postgres and gave three
reasons. Applied here, the first one **inverts**.

- D49's weightiest argument was that *"a Redis counter that expired, was never
  written, or was lost to a restart under-counts silently, and the failure looks
  like a clean account"* — decisive, because those counts decide whether to
  withhold someone's money. This counter decides nothing about money. A lost
  count weakens a barrier for a few minutes, and §15.4 already covers the
  serious version of that failure by **failing closed** when the counters cannot
  be read at all.
- Login attempts are not rows anywhere. Clicks and conversions are already
  persisted, so counting them in Postgres costs a query; counting logins there
  would cost a **table and a migration** for data whose entire value expires in
  minutes.
- §8.3 specifies Redis for exactly this.

T15 — the shared velocity counter — therefore stays deferred and unaffected.
This is not the counter it is about: those must be exact, this one must be fast
and must fail closed, and putting both behind one abstraction would hand one of
them the other's failure policy.

### The asymmetry between reading and writing

The **read** fails closed: unreadable counters mean 503, because §15.4 says an
unavailable control is not a reason to stop controlling. The **write** fails
open: if the increment cannot land, the request still answers 401, because the
caller genuinely did fail to authenticate and telling them the service is broken
would be untrue. The window this leaves is narrow and self-closing — if Redis is
unreachable, the next attempt's read refuses anyway.

**Enforced by test.** Every rule above has a regression test that fails when it
is broken, including the one that matters most: dropping the count for
unregistered addresses leaves them answering 401 forever while real accounts
lock out, which is an enumeration oracle, and the suite reports it as
`[401, 401, 401, 401]` against an expected `[401, 401, 401, 429]`.

---

## D74 — The login decoy hash is generated, not written down
**Feature 17 (review)**

`AuthService.login` verifies a password against a decoy hash when the address
has no account, so that request costs what a request for a real account costs.
Otherwise the response time answers "is this address registered" — the question
the shared `AUTH_INVALID_CREDENTIALS` code and §8.3's enumeration rule exist to
refuse.

### It had never worked

The decoy shipped in Feature 3 as a hand-written constant, and that string was
not a valid argon2 hash:

```text
verify(DUMMY_HASH, …)   →  throws: Invalid hashed password: invalid Base64 encoding
verify(<real hash>, …)  →  false, in 44ms
```

`PasswordService.verify` catches a malformed hash and returns `false` — correct
behaviour for a corrupt stored row, and fatal here, because it turned the
equaliser into a no-op. Measured over HTTP:

```text
before   unknown address  8.0ms median (7–10)    known address 36.3ms median (35–48)
after    unknown address 50.1ms median (40–69)   known address 49.2ms median (38–61)
```

The ranges did not overlap. One unauthenticated request classified any address.
Every attempt also wrote an error line, so the log could be flooded on demand.

### Generated, so it cannot be wrong in that way again

The value now comes from `PasswordService.hash()` on random bytes, memoised for
the process and pre-computed in `onModuleInit` (so the first unknown address is
not itself the slow one). Three properties follow from *how it is made* rather
than from having been pasted correctly:

- It is always parseable, because argon2 produced it.
- It always matches the current `options`. §8.3 anticipates raising the
  parameters as hardware improves; a literal would have silently gone on
  costing the old amount, which is the same defect with a different cause.
- It is per-process and unknown, so it is not a value anyone can look up.

The cost is one argon2 hash at startup, ~40ms, once.

### Why the tests did not catch it

Every existing test asserted the *response* — same code, same message, same
body for both cases, all true and all passing. The leak was in a dimension
nothing measured. Two regression tests now cover it, deliberately by different
means: one asserts the decoy parses (a malformed one takes `verify`'s catch
branch, which logs, so the assertion is "nothing was logged"), the other asserts
it costs at least half what a real verification costs. Reverting the fix fails
both, and fails the HTTP test at a ratio of 0.23 against a required 0.6.

**The general lesson, recorded because it is the second time in this feature:**
a security property stated in a comment is not enforced by the comment. The
account-key design was tested and correct; the sentence next to it, about the
decoy, described something that had never been true.

---

## D75 — Email verification ships without gating anything
**Feature 18**

`emailVerifiedAt` has existed on `users` since the first migration, written by
nothing and read only by the admin summary. This feature makes it mean
something: a token is issued at registration, delivered through the
`notifications` queue, and spent at `POST /auth/verify-email`.

**It gates nothing.** Not login, not the wall, not a payout. That is the whole
of the deliberate part.

Adding a gate would be a change to behaviour that already exists and is already
tested — an unverified account can log in today. It would also be a policy
decision with no stated owner: PROJECT.md M1 asks for "verify email" in a list
with register and login, and neither it nor §8 says what an unverified user may
not do. Shipping the mechanism without the policy leaves the policy to whoever
has the reason to choose it, and leaves a system whose behaviour did not change
for anyone who was already using it.

The regression test that pins this is deliberately dull: log in, verify, log in
again, expecting 200 both times. "We did not change that" is exactly the kind
of claim that stops being true unnoticed.

### The token is created after the user, not with them

DATABASE.md §7 lists registration as one flow — create user, open balance,
create verification token. The first two share a transaction inside
`UsersService.create`; the token is created after it returns.

Threading a transaction handle out of `UsersService` for `auth`'s benefit would
change a shared method's signature for one caller, and `create` is the wrong
place for a second module's side effect. The window this opens is a crash
between the two writes, leaving an account with no token — and because
verification gates nothing, the consequence is a user who is exactly as able to
use the platform as they were a moment earlier. That is what makes the cheaper
construction defensible here and would not make it defensible if a gate existed.

### The queued job carries the token itself

Every other job in this system carries identifiers and re-reads state (§13.2).
This one carries a secret, because it has to: only the SHA-256 is stored, so a
job holding an id would have nothing to put in the email. The exposure is one
short-lived token in Redis, bounded by its own expiry and by `removeOnComplete`
— and the alternative, storing the token in plaintext so a job could fetch it,
is worse in every way.

### Delivery failure retries; enqueue failure does not fail registration

The processor lets errors escape so BullMQ retries — the opposite of the
balance queues, and correct here: a duplicate send is a second email, not a
second credit. But the *enqueue* is best effort. A Redis outage must not turn a
successful registration into a 500 for an account that already exists, has a
balance, and has been issued a session.

---

## D76 — Password reset: one response, one transaction, every session gone

**Feature 19.** ARCHITECTURE.md §8.3 requires reset tokens to be "single-use,
hashed at rest, short expiry" and reset requests to "return the same response
whether or not the email exists". §8.2 lists password change among the things a
refresh token must be revocable for. This records how those became code, and
what was deliberately left out.

### The request endpoint returns 204 and nothing else, always

Unknown address, suspended account, an issuing failure, a queue that refused the
job — all of them end at the same `204`, with the same empty body. The service
method returns `void` so there is nothing that *could* vary, and the enqueue is
wrapped in a `catch` that logs rather than propagates.

That last part is the uncomfortable one: an infrastructure failure is silently
absorbed on a path a user is waiting on. It is still right. An error response
here is only ever produced for addresses that *do* have accounts — the unknown
ones return before reaching the queue — so a 500 is a positive answer to the
question the endpoint exists to refuse. The failure is not lost; it is logged at
error level, which is where the operator is, rather than in the response, which
is where the attacker is.

**No decoy work is needed to equalise timing here**, unlike login. There is no
argon2 verification on this path — a lookup and an enqueue, both fast, neither
varying by enough to measure across a network.

### The three writes are one transaction

Spending the token, setting the hash and revoking the sessions commit together.
Two of the three interleavings are bad in different ways: a spend without a
password change consumes the only link the user has, and a password change
without revocation leaves whoever prompted the reset still logged in — which is
the specific outcome the user was trying to produce.

`UsersService.updatePasswordHash` gained a client parameter for this, the same
one `updateStatus` and `revokeAllForUser` already take (DATABASE.md §10.1). The
hashing happens *before* the transaction opens: argon2 costs ~40ms and should
not spend it holding a connection and a row lock. That ordering is a cost
choice, not a correctness one — a policy failure raised inside the transaction
rolls the consumption back just as well, which was established by reverting it.

### The purpose is part of the lookup, not a property of the value

Both purposes live in one table (DATABASE.md §3.1) and both tokens are 43
base64url characters drawn from the same generator. Nothing about a token
distinguishes them. If `purpose` were not in the `WHERE` clause, the
verification link mailed to every registration — valid for a day, gating
nothing, therefore the least guarded token in the system — would be a password
reset. It is pinned by a test that presents one to the other's endpoint.

### Resetting does not log you in

A reset returns 204 and no session. Registration issues one because the
credentials were proven in that request; here the caller has proven they can
read an inbox, which may not be their own. They log in like anyone else.

### Issuing a new reset token does not invalidate the old ones

A user who clicks "forgot password" twice because the first email was slow gets
two live links. Invalidating on issue would break whichever one they actually
open. Each is single-use and expires in an hour by default, so the window
closes by itself.

### What was left out

**Throttling.** `/auth/forgot-password` is public, unauthenticated, and sends
email on demand — it can be used to flood one address or to consume a delivery
quota. Not built here (T66). It is abuse rather than a correctness defect, the
token TTL bounds what a flood is worth, and M5 already schedules the rate
limiting sweep.

**A successful reset does not mark the address verified**, although spending an
emailed token proves the same thing verification proves. Left alone because
verification currently gates nothing (D75), so the timestamp would move without
any behaviour depending on it — and `emailVerifiedAt` answers "since when has
this been a real address", which fraud review reads. Widening what writes it is
a decision to take when something reads it.

---

## D77 — The notifications worker dispatches from a table, not a switch

**Architecture check before Feature 20.** Two questions were asked of
`NotificationsProcessor`: is it becoming a God object, and does adding a
notification type require only adding a handler?

**The first: no.** One collaborator (`EmailProvider`), no business rule, no
state. It resolves nothing and decides nothing — it maps a job to a message and
hands it over. Growth in this class would come from *branches*, and that is the
second question.

**The second: not yet, and the `switch` was not the reason.** Both cases routed
through one shared `deliver()` that built `params: { token }` itself. That works
only because the two payloads this queue carries today happen to be identical.
The first notification whose email needs anything else — a payout amount and a
reference, a rejection reason — would have had to change `deliver()`, and
changing it means editing the code path that delivers verification and password
reset emails in order to add an unrelated one. That is a real coupling with a
real failure mode, not a style preference, so it was fixed rather than recorded.

Each row of `HANDLERS` now builds its own message and shares nothing with its
neighbours. What stays shared is what genuinely is common: look the job up,
send, log, let failures escape.

**Demonstrated rather than asserted.** A third handler with a deliberately
different parameter shape (`{ amount, reference }` instead of `{ token }`) was
added, type-checked, and the existing tests re-run before it was removed. It
compiled and dispatched without touching either existing handler, `process()`,
the `handler()` helper or the interface — additions only. That is the property
the check was asking about, and it now has evidence behind it.

**What was deliberately not built:** module-side registration, where `auth`
registers its own handlers and this table disappears. It would make the worker's
behaviour depend on which modules loaded, so a producer that forgot to register
would fail to deliver *silently*. A table that is wrong loudly beats a registry
that is wrong quietly (P6).

The four existing unit tests were not modified, and passing unchanged is what
establishes that this refactor altered no behaviour.

---

## D78 — `web` holds the token pair in one unsigned httpOnly cookie

**Feature 20.** ARCHITECTURE.md §23 lists "whether `web` needs its own session
store" as an open question with a starting position: *signed cookies holding
the token pair, no server-side store*. This is that position, implemented, with
one deliberate difference.

### No server-side store

Nothing in `web` is stateful, so nothing has to be shared between replicas, and
§19.1's "`web` never touches the database" stays true without an exception for
sessions. Redis-backed sessions remain a contained change inside `web` if
cookie size or server-side revocation ever justifies them — and revocation
already exists at the API, where `refresh_tokens` can be revoked by family or
by user (§8.2).

### The cookie is not signed

The pair is there; the signature is not, because **both tokens already
authenticate themselves at the API**. The access token is a JWT verified by
signature (§8.1); the refresh token is matched against a hash in
`refresh_tokens` (§8.2). A tampered cookie therefore produces a 401 rather than
a forged session, and an attacker who can write this cookie can only put tokens
in it that they already hold.

A second secret, a second rotation procedure and an HMAC per request would buy
nothing measurable. The condition that reverses this is precise and written in
the code: **the moment `web` stores something it does not re-verify** — a role,
a flag, an entitlement — the signature has to arrive with that field.

### The refresh exchange lives in the proxy

A 15-minute access token is only usable because something renews it without
involving the user. `apiAuthed` retries **once**: 401 → refresh → retry. A
second 401 after a fresh token means the session is genuinely finished, and
looping would turn one dead session into a stream of requests.

Verified against a live API rather than only against mocks: a session whose
access token was replaced with a garbage JWT still rendered the dashboard, and
wrote back a rotated cookie.

### The redirect in `hooks.server.ts` is not authorization

It is a redirect, and the comment says so. Whether a session is valid and what
it may do is decided by the API's guards on every call (§6.2 steps 7–8). What
the hook decides is where to send someone whose page would otherwise fail its
own data load. Confusing the two is how a front end becomes the thing that
decides who sees what.

### Verification is spent on load; a reset is not

Following a verification link verifies the address — a GET with an effect, and
the right trade: the token is single-use and consuming it is exactly what the
recipient asked for by clicking. The reset link deliberately does the opposite,
carrying its token into a form and spending it only when a password is
submitted, because spending it to render a page would burn the link every time
a mail client previewed it.

---

## D79 — The web app compiles CSS with Tailwind v4; the tokens are plain CSS variables
**Phase 1 — design foundation** · goes beyond the approved documents

ARCHITECTURE.md names the web stack down to the adapter and says nothing about
styling, so the choice was open. `apps/web` had no CSS engine at all: eight
`<style>` blocks, fourteen hard-coded colours, zero design tokens and zero
`@media` queries (UI_AUDIT.md F1–F10).

Tailwind v4 was chosen over hand-written CSS for one reason that outweighs P6
(Simplicity First): **DESIGN_SYSTEM.md is written entirely in Tailwind class
strings**, because legacy was a Tailwind application. Every recipe in it — the
card, the pill button, the badge tones, `sm:grid-cols-2 lg:grid-cols-3
xl:grid-cols-4` — transcribes one-for-one instead of being re-derived by hand
into media queries in each of the twenty screens still to be built. Re-deriving
them is precisely the duplication F10 records.

It is also a small commitment: one dev dependency and one Vite plugin, no
`tailwind.config.js` (v4 has none), and nothing in the runtime image, which
`adapter-node` bundles from source anyway.

**What keeps it reversible.** The token layer is declared in `@theme` and
emitted as ordinary CSS custom properties, and every multi-property recipe in
`app.css` is written as plain CSS against those variables rather than with
`@apply`. Tailwind supplies layout utilities and breakpoints; it does not
supply the design system. Removing it would cost the utility classes in
components, not the tokens or the recipes.

**The value that must not drift.** `--color-brand-500: #10b981`. Legacy
hard-coded Tailwind **v3**'s emerald scale; v4's own `emerald-500` is `#00bb7f`
(DESIGN_SYSTEM.md §3.1). The scale is written out literally and `emerald-*` is
never substituted for it.

---

## D80 — Focus and label markup depart from the documented legacy values, deliberately
**Phase 1 — design foundation** · amends DESIGN_SYSTEM.md §10.1–10.2 for the rebuild

DESIGN_SYSTEM.md is an extraction of what legacy *did*, and the rebuild
reproduces it — with two exceptions, recorded here so the divergence from a
reference document is visible rather than looking like a transcription error.

**1. Legacy sets `outline-none` on every input (§10.1).** It replaces the
browser outline with a `brand-400` (#34d399) border and a `brand-100` ring.
Against white that indicator is 1.9:1, below WCAG 2.2's 3:1 for focus
appearance, and `outline-none` removes the only fallback. The rebuild keeps the
brand ring for pointer focus, moves the border to `brand-600` (#059669, 3.2:1),
and adds one global `:focus-visible` outline in `brand-700` that nothing is
allowed to remove. UI_AUDIT.md records zero visible focus states in the current
app; this is the rule that fixes it once rather than per component.

**2. Legacy wraps the control inside its `<label>` and emits no `for=`
(§10.2).** That works for a bare input and stops working the moment a field has
a hint, an error to announce, or a control that is not an input. `Field.svelte`
uses explicit `id`/`for` with `aria-describedby` and `aria-invalid` instead.
The *look* is unchanged; only the wiring is.

Both are the "improve the UX, keep the visual language" side of the phase brief.
The pages written before this phase still use the legacy wrapping pattern and
are styled through a `label:not([class])` compatibility rule that dies with them.

---

## D81 — Which shell a route gets is decided by its folder, not by its path
**Phase 2 — application shell** · goes beyond the approved documents

ARCHITECTURE.md §6.1 describes what `web` *is* — a BFF holding an httpOnly
cookie — and says nothing about how its routes are organised. Phase 1 left a
stopgap in the root layout: a list of auth paths and an `admin` prefix, checked
against `page.url.pathname` to pick a container width. It worked and it did not
scale — every new route would have had to be remembered in a list somewhere
other than where the route lives.

`apps/web/src/routes` now has two SvelteKit route groups:

```
(app)/    dashboard, offers, earnings, payouts      → AppShell
(auth)/   login, register, forgot/reset, verify     → a 24rem column
admin/    payout review                             → a holding layout (phase 7)
```

**Group parentheses never appear in a URL.** `/dashboard` is still `/dashboard`,
every link and redirect still resolves, and — the part that mattered most —
`hooks.server.ts`'s `PROTECTED_PREFIXES` still names the same five paths, so
nothing about who may reach a page changed when the folders did.

**Two consequences worth stating.**

The root `+layout.server.ts` was deleted. Its only output was
`isAuthenticated`, consumed by the header that no longer lives there; its own
comment argued against loading a profile in the root layout because that runs on
public pages too. `(app)/+layout.server.ts` loads the profile and balance the
topbar needs, in the one place where a shell exists to fill.

`admin/+layout.svelte` is **not** the admin shell of DESIGN_SYSTEM.md §14.4.
It is a header with the logo, a way back, and logout — what those pages already
had before the root layout stopped drawing one. The real admin shell arrives in
phase 7 with the screens it navigates to; a sidebar whose links all lead to
pages that do not exist is the defect UI_AUDIT.md §9 records against legacy.

---

## D82 — The public page reproduces legacy's design and not its claims
**Phase 3 — authentication and landing** · goes beyond the approved documents

DESIGN_SYSTEM.md §18 is a faithful extraction of the legacy landing page, and
three of its nine bands state things about GemOne that are not true of the
system in this repository:

| Band | Legacy content | What exists |
|---|---|---|
| §18.6 partners strip | "Trusted by top offer partners" — AdGem, CPX Research, TOROX, timewall, lootably, ayet studios | `providers/adapters/` contains `mock` |
| §18.10 testimonials | Three named people, five stars each, "$250+ via PayPal" | no users, no reviews, no payouts |
| §18.11 stats bar | "30,000+ Active Users · $2M+ Paid to Users · 1M+ Offers Completed · 50+ Reward Options" | none of these figures exist |

Plus the hero's "30,000+ happy users" with its avatar stack and star row
(§18.4), and the two payment-brand tiles on the phone mockup (§18.5).

**The shapes are reproduced exactly; the contents are replaced.** Same band
order, same backgrounds, same gradients, same card anatomy — round plate, bold
heading, body, `border-t` footer row — same dark `rounded-3xl` slab with four
cells, same faint centred strip. What changed is what those cells say:

- the strip lists the pipeline every provider is put through, which is P1 stated
  in the shop window rather than a claim about who we have signed;
- the three cards state what the reward model guarantees (ARCHITECTURE.md
  §9–§11) instead of quoting people who do not exist;
- the four figures are properties of the product as built — free to join, six
  earning categories, three steps, a wall that is not on office hours;
- the hero's social-proof cluster becomes three statements about how the
  product works, in the same muted `text-sm` slot;
- the `PayPal` and `amazon` tiles keep their silhouette, rotation and colour
  contrast with generic labels. We have no relationship with either company,
  and another company's wordmark on a marketing page is a claim about them as
  well as about us.

**Why this is a design decision and not a content edit.** A landing page is the
one artefact whose job is to make assertions, and an invented user count is not
"placeholder copy" in the way that lorem ipsum is — it survives into production
precisely because it looks finished. Legacy's own source comments the phone and
its props as *"CSS/emoji placeholders, swap for real 3D renders"* and says
nothing of the sort about the statistics, which is how they were meant to be
read: as facts. They are not ours to state.

The rule this leaves behind, and the reason it is written here rather than in a
commit message: **nothing on the public page asserts a fact about GemOne that
is not true of the system as built.** It is enforced by nothing but this
paragraph and the note at the top of `landing/content.ts`, so it needs to be
findable when the testimonials are asked for again.

Two smaller departures in the same spirit, both of them things §18.16 already
flags as omissions rather than decisions:

- **Dead links are not reproduced.** Legacy's header and footer carry twenty
  `href="#"` links. The header's three now point at sections of the page and
  the footer keeps two columns that resolve; the rest wait for the pages
  (TODO T76).
- **The mobile menu legacy does not have.** Below `md` legacy hides every nav
  link and offers no hamburger, so a phone visitor cannot reach any section
  (§18.3, the same gap §22.3 records in the app). A disclosure button was added
  — `aria-expanded`, Escape to close, closes on choosing a link — rather than
  reproducing the gap.

---

## D83 — A dashboard panel that cannot load its data is a panel, not a logout
**Phase 4 — dashboard** · goes beyond the approved documents

Every page in `web` was written the same way: load everything the page needs in
parallel, and if *any* call fails, `redirect(303, '/login')`. It is in
`/dashboard`, `/earnings`, `/payouts` and the offer wall, and the comment on
each says the same thing — a 401 means the session is finished.

That reasoning is right about 401 and wrong about everything else. A 500 from
`/rewards/history`, a timeout, a restarted API container — all of them signed
the user out of a session that was perfectly valid, and did it silently, on a
page where their balance had already loaded.

The dashboard splits the two apart:

- **The session is the layout's business.** `(app)/+layout.server.ts` loads
  `/users/me`, and a failure there still redirects. That is the one call whose
  failure genuinely means "there is no session here".
- **Everything else is data.** `/rewards/history` resolves a
  `{ ok: true, items } | { ok: false }` result — never a rejection — and the
  activity card renders an `ErrorState` inside itself. Balances above it stay
  on screen, navigation still works, and a refresh is the whole remedy.

**The promise is returned unawaited**, which SvelteKit streams: the shell and
the balance cards paint as soon as the layout's calls are in, and the list
fills when the ledger answers. Two things fall out of that.

The first is that the loading state becomes real. Without streaming there is
nothing to be loading — the server has finished before the first byte, and
"loading" is a state the code can describe but never enter. Measured with the
API's history endpoint delayed by six seconds: balances rendered, the region
carried `aria-busy="true"` and an announcement, five skeleton rows stood in for
the list, and all of it was replaced when the call returned.

The second is why the result is discriminated rather than thrown. A streamed
promise that rejects takes the whole page to SvelteKit's error screen —
throwing away the balances that loaded perfectly well, which is the same defect
as the redirect wearing different clothes.

**This is not retroactive.** `/earnings`, `/payouts` and the offer wall still
redirect on any failure. Each is being rewritten in its own phase and each will
make the same split then; changing them here would mean touching four pages
this phase was not reviewing.

---

## D84 — The dashboard shows what the system can prove, and drops the rest
**Phase 4 — dashboard** · goes beyond the approved documents

DESIGN_SYSTEM.md §16 gives the dashboard eight blocks. Five of them are not
built, and not because of time:

| Legacy block | What is behind it |
|---|---|
| Daily bonus card, with its 7-dot streak | no bonus schedule, no streak, no claim |
| Recommended offers rail | no recommendation of any kind |
| Achievements teaser | no achievements |
| Referral card | no referral system (TODO T75) |
| Level card and XP bar | no levels, no XP |

The four that shipped — the balance row, the activity list, the earnings
overview and the account panel — are each a direct read of an endpoint that
exists. The two quick actions go to `/offers` and `/payouts`, both of which
work today.

**A dashboard is the wrong place to put a promise.** It is the first screen
after login and the one people learn the product from; a claim button that
claims nothing teaches them that the buttons here are decorative, which is
exactly what UI_AUDIT.md §9 records against legacy's eighteen-link admin
sidebar. The gap is left visible instead — a dashboard with four honest panels
reads as an early product, which is what it is.

**Two figures are missing rather than approximated.** Legacy prints `≈ $12.56
USD` under every points value; no user-facing endpoint exposes the rate, so the
cards show points only (T78). And every activity row says "Offer completed"
rather than naming the offer, because the ledger record carries a conversion id
and no title (T77). Both are recorded as API gaps, and neither is filled with a
plausible-looking guess: a made-up exchange rate on a balance screen is a
number someone plans a withdrawal around.

**What replaced the missing analytics** is built from figures the API already
returns: a stacked bar of available / pending / locked with its legend, and the
three lifetime totals from `/rewards/balance`. Three `<div>`s with percentage
widths — the phase brief rules out a charting dependency, and a library to draw
one rectangle would be several hundred kilobytes to say something the data
already says.

---

## D85 — The statement's offer name is recorded, not resolved
**Phase 5 — earnings** · goes beyond the approved documents

A statement line has to say *which* offer paid. `reward_transactions` carried
`source_type` and `source_id` and no name, and TODO T77 recorded the gap
without proposing a fix, because the obvious fix does not work.

**The obvious fix.** Join `reward_transactions → conversions → clicks` at read
time and return the click's offer-title snapshot alongside each row. No new
column, no migration, no denormalisation — everything the phase brief prefers.

**Why it is not available.** The module that owns `reward_transactions` states
its own constraint in its module comment: *"Depends on no other domain module,
deliberately and permanently. Everything that moves points calls in; this calls
nothing back out. That direction is what makes the service replaceable."* And
`conversions → rewards` is already an arrow in ARCHITECTURE.md §4.1 — so the
join is not a new dependency, it is a **cycle**, and the boundary lint would
refuse it. Nest would need `forwardRef`, which is the smell that names the
problem rather than solving it.

Two other placements were considered and are worse. A new read-side module
importing both would add a module, a route and a three-table join per page to
avoid one column. Resolving it in the BFF would need a user-facing conversions
endpoint built for the purpose, then a lookup per row across the network.

**And the join would be wrong even if it were allowed.** Offers are overwritten
by every catalog sync (DATABASE.md §3.2). A join to `offers.title` returns what
the offer is called *today*, printed on a line describing money that moved
months ago. That is not a smaller version of the right answer; it is a
different claim.

**So the name travels with the money.** One nullable column, `source_label`;
one optional field on `RewardSource` that the caller supplies; and
`conversions` — the module that already knows, because it is holding the click
— passes `click.offerTitleSnapshot` with the credit. `mature()` and
`reverse()` copy it from the transaction they act on, so a credit, its
maturation and its chargeback all read under one offer name instead of the
statement losing the thread halfway down.

This is denormalisation, and it is the same denormalisation this schema already
makes three times for the same reason: `clicks.offer_title_snapshot` freezes
what the user was shown, `conversions` copies `user_id`/`provider_id`/
`offer_id` off the click, and every conversion stores the *rate* that priced it
so the number can be explained later. The rule those share is the one this
follows: **the rule in force at the moment of the event is part of the event.**

Rows written before the column existed keep `null` and render without a name.
Nothing backfills them, for the reason above — the only title recoverable now
is the wrong one.

**What it does not fix.** Payout movements and manual adjustments still carry
no label, because their callers were not changed; a withdrawal line reads
"Withdrawal requested" with no method beside it. That is a one-line addition in
`payouts` whenever that screen is rebuilt, and the shape is now there for it.

---

## D86 — The withdrawal form reads its rules from the API, and the rate was never missing

**Context:** UI phase 6 (`/payouts`). Supersedes the "what it does not fix"
paragraph of [D85](#d85) and closes TODO **T78**.

The shipped withdrawal page held this:

```svelte
/*
 * The enabled methods are configuration (P3) and there is no public endpoint
 * that lists them, so this is the shipped default.
 */
const methods = ['paypal'];
```

Which is a direct contradiction of PROJECT.md §4.6 — *"adding a payment method
an admin can settle manually requires no deployment"* — written down in the file
that breaks it. The same page could show neither the minimum a withdrawal
starts at nor what the points were worth, because `payouts.minimum_points`,
`payouts.points_per_currency_unit` and `payouts.currency` were readable only
through `admin/configuration`.

**T78 was never a missing rate.** The audit recorded it as *"no public API value
exposing the points-to-currency conversion rate"*, and the temptation that
phrasing invites is to invent one. There was nothing to invent: the rate is
`payouts.points_per_currency_unit`, it has a default of 1000, `submit()` reads
it on every request and stamps it onto the row so a payout's cash value stays
explainable after the rate moves (D42). The gap was **exposure, not
arithmetic** — the one person the number prices could not see it.

**So: one read-only endpoint, `GET /payouts/options`,** returning the enabled
methods, the minimum, the maximum, the rate and the currency. It computes
nothing. It is the read side of settings that were always the source of truth,
on a surface the person they constrain may call.

Three things follow from that shape, and each was a choice:

- **The methods are filtered by `provider.supports()`.** `submit()` refuses a
  method the installed payout provider cannot settle, so listing one here would
  put a choice in a dropdown that the next click rejects. The manual provider
  supports everything, so today this removes nothing — it is the seam holding
  for the day an automated provider handles some methods and not others.
- **The BFF re-implements none of it.** The `min`/`max` attributes on the
  amount field are a courtesy that saves a round trip; the rule is the
  service's, and the page works with them ignored. A BFF that re-checked the
  minimum would be a second copy of a rule an admin thinks they changed in one
  place, and it would be the copy with no tests over real data.
- **When the call fails, the form is not rendered.** No methods, no minimum, no
  rate — nothing honest to build a form out of. The panel says so, and the
  Available card drops its cash line rather than falling back to a rate nobody
  configured. An invented rate on a withdrawal screen is a number people decide
  on.

**Payout movements now carry a `sourceLabel` too**, which is the paragraph D85
left open. `lock()` takes the method as its label and `resolveLock` copies it
onto the settle or the refund, so one withdrawal reads under one name from
request to outcome. The argument is D85's unchanged: methods are configuration,
and one an admin removes later would otherwise leave a settled withdrawal on the
statement with nothing to say about where the money went.

**What this is not.** It is not a payout provider. `PAYOUT_PROVIDER` is still
the manual implementation — an admin reads the destination, sends the money by
whatever means, and records the reference (ARCHITECTURE.md §11). Nothing in
this phase moves money, and the interface that would is untouched.

---

## D87 — The offer tile's colour is derived from the offer id

**Context:** UI phase 7 (`/offers`). Answers the blocking dependency
[UI_AUDIT.md §5.8](UI_AUDIT.md) raised and DESIGN_SYSTEM.md §3.5 named.

Legacy's offer card opens with a solid colour block carrying one white letter,
and the colour is a per-offer field: `color: string; // hex for the tile`,
supplied by the provider. §3.5 records the observed values — `#b91c1c` for RAID,
`#4f46e5` for Sofi, `#059669` for Quick Survey — and then states the problem
plainly: *"If the current API does not supply one, a deterministic colour must
be derived, or the tiles all collapse to one colour and the wall loses its
texture."*

Our `WallOffer` has `imageUrl` and no colour. Three options existed:

**Add `color` to the contract.** Rejected. It would put a colour on
`NormalizedOffer`, which means every adapter — including ones nobody has
written — inventing a palette in a provider folder. P1's whole point is that an
adapter translates a provider's dialect and holds no business rules; a colour
scheme is not a fact about a campaign, and no real network sends one.

**One colour for every tile.** Rejected for the reason §3.5 gives: a wall of
identical blocks is a wall you cannot scan.

**Derive it from the id.** Taken. `tileColor` hashes the offer id (FNV-1a) into
legacy's own eight observed values. Two properties are the whole design:

- **Stable.** The same offer is the same colour on every render, every process,
  and after a redeploy — it is a hash, not a counter or a random pick. A wall
  that reshuffled its colours on reload would read as broken.
- **Decoration only.** Nothing is communicated by which colour appears, so a
  collision costs nothing and needs no handling. It exists to give the grid
  texture and for no other purpose.

**The image, when there is one.** `imageUrl` is layered over the colour as a CSS
background rather than as an `<img>`, and only when it parses as `https:`. Two
reasons, and the first is not hypothetical: every URL in the mock fixture points
at `cdn.mock-offers.test`, an unreachable host, so an `<img>` shows the
browser's broken-image glyph on the majority of cards in development. A
background that fails to load leaves the colour underneath, which was the design
anyway. The scheme check is because this is the one field on the wall that
arrives from outside our system and is rendered as a URL rather than as text.

**What was not derived.** Legacy's card also carries a difficulty badge. There
is no difficulty in our catalog, and the obvious derivation — expensive means
hard — is a claim about how long something will take somebody, made from a
number that says what a provider pays. The badge is absent.

---

## D88 — Queue isolation is a key prefix, not a second Redis

**Context:** UI phase 8. Resolves TODO **T81**, which had cost a debugging
cycle in phase 5 and opened phase 6 with 57 failing tests.

A development machine runs `docker compose up`, which runs a `worker`
container. The integration suite runs against the same Postgres and the same
Redis — deliberately, because ARCHITECTURE.md §18.3 says the parts most likely
to be wrong are the parts where code meets the database.

**The suite is a consumer, not only a producer.** `worker-jobs.spec.ts` boots
`WorkerModule` in-process precisely to test the jobs only the worker runs. So
two processes consumed every queue, and the container usually won.

**It never presented as a queue problem**, which is what made it expensive.
It presented as assertions about work somebody else had done: a
`processingAttempts` of 2 where the test expected 1; a conversion the test had
just created already credited, by a container running an image built before the
column under test existed, so the column read `null`. Both look exactly like
application bugs. The workaround — `docker compose stop worker` — is not a
workaround anyone remembers, and a test suite whose correctness depends on
remembering something is not isolated.

Three options were on the table:

**A second Redis for tests.** Rejected: a second service to run, configure and
document, to solve a problem that is one configuration line — and it would not
have been the *architecture's* answer, since this codebase already namespaces
Redis by hand (`ow:1:invalidation`, `ow:1:public-throttle:*`).

**A test-only database.** Rejected *for this problem* — the failures were all
job-stealing, and a second database would not have stopped a single one. It
remains the answer to a different problem, noted below.

**A queue key prefix.** Taken. BullMQ keys every queue under a prefix, so
`bull:postbacks` and `bull-test:postbacks` are different queues on one Redis.

- `QUEUE_PREFIX` defaults to `bull`, **which is BullMQ's own default** — so no
  deployment changes, no migration, and not one existing queue moves. A
  resolved issue that requires an operator to do something is only half
  resolved.
- `test/integration/setup.ts` sets `bull-test` before the application boots,
  which is the only place it can be set: setup files run before any test file
  imports `AppModule`, so the env module validates a value already in place.
- Fixed rather than random. A random prefix per run isolates equally well and
  leaves a new key space behind every time, with nothing to grep when something
  does go wrong.

**Verified by measurement, which is the only verification that means anything
here.** The suite that produced 57 failures with the worker running now passes
28 files and 584 tests **with the worker running**. Nothing is stopped and
nothing is remembered.

**What is still shared: the database.** The worker's own scheduled jobs — a
catalog tick every 60 seconds, an hourly maturation sweep — read the same
development database the suite uses. No test has ever failed on that, and no
failure has ever been traced to it. It is left alone deliberately: it needs a
second database and a migration step, which is the "large infrastructure
rewrite" this change existed to avoid. T81 records it so the next person to see
an inexplicable failure starts there.
