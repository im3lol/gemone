# DATABASE.md — Data Model

> **Companion to:** [PROJECT.md](PROJECT.md) (approved) and
> [ARCHITECTURE.md](ARCHITECTURE.md) (approved).
> **Status:** Draft — awaiting approval. Coding starts after this is approved.
> **Scope:** entities, responsibilities, relationships, and the rules that govern
> them. **No Prisma models, no SQL, no column types.** Those come with M1.

This document answers *what data exists, who owns it, and what guarantees it
carries*. It deliberately stops short of physical schema, because the useful
decisions here — ownership, transaction boundaries, what may never be deleted —
are the ones that are expensive to change later. Column types are not.

---

## 1. Two Corrections to ARCHITECTURE.md

Writing the data model surfaced two things worth fixing before code:

**1. `provider_credentials` is not a table.** ARCHITECTURE.md §4 lists it under
the `providers` module, but §5.1 of the same document places provider credentials
in environment variables. §5.1 is right: credentials are secrets that change with
a deploy, and a database table would put them in every backup and in the reach of
any SQL injection. **The table is removed.** `providers` holds configuration and
operational state; credentials are injected by the registry from environment.

**2. `support_tickets` has no owning module.** PROJECT.md §3.2 gives users the
ability to file a missing-credit ticket, but ARCHITECTURE.md §4 assigns that
table to nobody. It is added below under a small `support` module.
ARCHITECTURE.md §4's ownership table needs the corresponding one-line addition.

---

## 2. Entity Overview

Eighteen entities across nine modules. Grouped by what they are *for*, since
that is how they will be reasoned about.

| Group | Entities |
|---|---|
| **Identity & access** | `users`, `user_devices`, `refresh_tokens`, `verification_tokens` |
| **Supply** | `providers`, `offers`, `offer_sync_runs` |
| **Engagement** | `clicks` |
| **Conversion** | `provider_postbacks`, `conversions` |
| **Money** | `user_balances`, `reward_transactions`, `payout_requests` |
| **Risk** | `fraud_evaluations` |
| **Operations** | `configuration_values`, `configuration_history`, `admin_audit_log`, `email_log`, `support_tickets` |

### 2.1 The Spine

Most of the system is one chain. Understanding it is most of understanding the
data model:

```
  user  ──►  click  ──►  postback  ──►  conversion  ──►  reward transaction
                                                               │
                                                               ▼
                                                        balance bucket
                                                               │
                                                               ▼
                                                        payout request
```

Everything else either feeds this chain (offers, providers, configuration),
guards it (fraud), or records what happened to it (audit, support).

---

## 3. Entities and Their Responsibilities

Each entity below states **what it is responsible for**, **what it must never be
responsible for**, and the fields that carry meaning. Field lists are
descriptive, not exhaustive — audit fields (§8) are assumed on every entity and
not repeated.

### 3.1 Identity & Access

#### `users`

**Responsible for:** the identity and account state of an earner or admin.

**Never responsible for:** balances. A `points` column on `users` would be the
exact mutable-balance-in-the-wrong-place mistake that P2 and ARCHITECTURE.md §9
exist to prevent. Balance lives in `user_balances`, reachable only through
`RewardAccountingService`.

**Carries:** email (unique, case-insensitive), password hash, role, account
status (`active` / `suspended` / `banned` / `closed`), email verification state,
registration country and IP, locale, and the reserved-but-unused TOTP fields from
ARCHITECTURE.md §8.4.

**Note on role:** a single role enum (`USER` / `ADMIN`), not a permissions table.
Two roles do not need a permission system (P6); ARCHITECTURE.md §8.4 requires the
*guard* to resolve an authorization level, which is code, not schema.

---

#### `user_devices`

**Responsible for:** the set of devices and network identities a user has been
seen from — a fraud signal, not a session record.

**Never responsible for:** authentication. It does not gate login; it informs
scoring.

**Carries:** user reference, device fingerprint, user-agent, last IP, first-seen
and last-seen timestamps, and a seen-count.

**Why a table and not a Redis counter.** Multi-accounting detection asks "which
*other* users share this fingerprint?" — a question across users and across time,
which is a database query. The short-window velocity counters that fraud also
uses stay in Redis (§12).

---

#### `refresh_tokens`

**Responsible for:** revocable sessions, with rotation and reuse detection
(ARCHITECTURE.md §8.2).

**Carries:** user reference, token hash (never the token), family identifier,
issued/expires timestamps, used-at, revoked-at and reason, plus the issuing IP
and user-agent.

**The family identifier is what makes reuse detection possible.** Rotation
produces a chain of tokens; when a used token is presented again, the whole
family is revoked. Without a family, revocation would have to walk a
parent-pointer chain or revoke every session the user has.

---

#### `verification_tokens`

**Responsible for:** single-use, expiring tokens for email verification and
password reset.

**Carries:** user reference, purpose, token hash, expiry, used-at.

**One table, two purposes**, distinguished by a purpose field — the lifecycle is
identical and two tables would be the same schema twice (P6).

---

### 3.2 Supply

#### `providers`

**Responsible for:** the registry row and operational state of one offerwall
network. It is the join point between a code adapter (ARCHITECTURE.md §7.3) and
its runtime configuration.

**Never responsible for:** credentials (§1), and **not** for business rule values
either. Reward rate, revenue share, and hold period are *configuration*, scoped
to this provider, and live in `configuration_values` (§3.6). Putting them here
would create a second configuration mechanism and break P3's single audited path.

**Carries:** slug (unique, matches the adapter registry key), display name,
enabled flag, postback source IP ranges, catalog sync interval, health state
(`healthy` / `degraded` / `down`), last successful sync, consecutive failure
count.

**Why health state is persisted rather than computed.** It must survive a restart
and be visible in the admin panel without re-deriving it from sync history on
every page load.

---

#### `offers`

**Responsible for:** one normalized offer from one provider, as of the last sync.

**Never responsible for:** being a historical record. Offers are overwritten by
each sync. Anything that must survive — what a user was shown and promised — is
snapshotted onto the `click` (§3.3).

**Carries:** provider reference, external offer id (unique per provider),
normalized title/description/requirements, provider payout amount and currency,
user-facing reward in points, category, device and country targeting, active
flag, dedup fingerprint, dedup-group winner flag, admin pin/weight, last-seen-in-
sync timestamp.

**On the dedup fingerprint.** Deduplication (ARCHITECTURE.md §7.5) groups offers
by a fingerprint derived from normalized title, advertiser, and target
application. It is a stored column rather than a computed join because it is
computed once per sync and read on every wall render — and because the losers
must stay queryable so a runner-up can be promoted when a provider goes down.

**Offers are never hard-deleted.** An offer that disappears from a provider's
catalog is marked inactive. Clicks reference offers, and a click whose offer row
vanished is an unanswerable support ticket.

---

#### `offer_sync_runs`

**Responsible for:** the history of catalog synchronization attempts — the data
behind provider health.

**Carries:** provider reference, started/finished timestamps, outcome, counts
(fetched, normalized, rejected, deduplicated), error summary.

**Why keep it.** "Why did this provider's offers disappear at 3 a.m.?" is a
question that gets asked, and logs will have rotated. Retention is bounded (§7).

---

### 3.3 Engagement

#### `clicks`

**Responsible for:** the attribution record. A click is **the promise made to the
user** and the only thing that can later connect an incoming postback to an
account.

**Never responsible for:** conversion state. A click does not know whether it
converted; conversions point at clicks, not the reverse. One click can produce
several conversions (multi-event offers), so a `converted` boolean on the click
would be wrong as soon as the second event arrives.

**Carries:** user reference, offer reference, provider reference, the signed
`sub_id` (unique), **snapshot of the offer's title and promised reward at click
time**, IP, user-agent, device fingerprint, country, created-at, and the
attribution window expiry.

**Why the snapshot.** Offers are overwritten every sync (§3.2). Without a
snapshot, a dispute two weeks later cannot establish what the user was actually
shown — and disputes about promised-versus-paid amounts are the most common
support case on an offerwall. Denormalizing three fields removes an entire class
of unanswerable question.

**Why the attribution window is stored, not computed.** Same reasoning as the
hold period in ARCHITECTURE.md §9.4: an admin changing the window must not
retroactively invalidate clicks users already made.

---

### 3.4 Conversion

#### `provider_postbacks`

**Responsible for:** the immutable, verbatim archive of every postback received,
and — through one unique constraint — the system's idempotency guarantee.

**Never responsible for:** business meaning. It is what arrived, not what it
meant. Interpretation lives in `conversions`.

**Carries:** provider reference, **external transaction id**, raw payload as
received, source IP, headers subset, signature verification result, receipt
timestamp, processing state (`received` / `processed` / `duplicate` /
`quarantined` / `rejected` / `failed`), processing attempts, error detail,
resulting conversion reference (nullable).

> **The single most important constraint in the database:**
> **unique (provider_id, external_transaction_id)**
>
> This is what makes duplicate postbacks impossible to double-credit
> (ARCHITECTURE.md §10.1). It is a database constraint rather than an
> application check because a check-then-insert loses the race it exists to
> prevent. If one line of this schema must be right, it is this one.

**Rows are never deleted or edited** — they are the replay source when processing
has a bug, and the evidence in a provider dispute.

---

#### `conversions`

**Responsible for:** the interpreted, attributed result of a postback — the
business event that a user completed an offer.

**Never responsible for:** the balance effect. Crediting is a
`reward_transactions` row created by `RewardAccountingService`; the conversion
records *that a thing happened*, not *what the balance became*.

**Carries:** click reference, user reference, provider reference, offer reference,
originating postback reference, provider payout amount and currency, **points
awarded and the reward rate used to compute them**, status (`credited` /
`held` / `reversed` / `rejected`), fraud evaluation reference, reversal
reference (self-referencing, for chargebacks), timestamps.

**Why the reward rate is stored on the row.** Rates change (P3). Without the rate
used at the time, a conversion's point value cannot be explained later, and "why
did I get fewer points than my friend for the same offer?" becomes unanswerable.
The same reasoning as the click snapshot and the stored hold period — **the rule
in force at the moment of the event is part of the event.**

**Reversals are rows, not edits.** A chargeback creates a new conversion row of
reversal type pointing at the original, and marks the original reversed. Editing
the original away would destroy the record that the user did complete the offer —
which matters when disputing the reversal with the provider.

---

### 3.5 Money

#### `user_balances`

**Responsible for:** the authoritative current balance, in three buckets
(ARCHITECTURE.md §9.2): `pending`, `available`, `locked`.

**Never responsible for:** history. It holds current state only.

**Access rule (P2, enforced by the architecture test in ARCHITECTURE.md §4.4):**
**only `RewardAccountingService` reads or writes this table.** Not the admin
panel, not reporting, not a convenience join in another module.

**Carries:** user reference (one row per user, unique), the three bucket amounts,
lifetime totals (earned, withdrawn, reversed), and a version/updated-at for
diagnostics.

**Why one row per user and not a computed sum.** This is the deliberate P2
trade-off recorded in PROJECT.md R4: a mutable row is contended, which is why
every mutation takes a row lock (§10). The append-only alternative remains
available behind the service interface.

**The row is created with the user**, not lazily on first credit. A missing
balance row during a credit is an error path nobody tests; an always-present
zero row is one less branch.

---

#### `reward_transactions`

**Responsible for:** the complete history of every balance mutation — the
user-facing statement, the reconciliation input, and the replay source if P2's
ledger migration is ever exercised (ARCHITECTURE.md §9.6).

**Never responsible for:** being authoritative. Under the MVP's simple balance
model, `user_balances` is the source of truth and this table is the audit trail.
That relationship inverts if and when the ledger implementation lands — which is
precisely why the table is populated from day one.

**Append-only. Rows are never updated or deleted.**

**Carries:** user reference, type (`conversion_credit`, `chargeback_debit`,
`payout_lock`, `payout_settle`, `payout_refund`, `manual_adjustment`, `bonus`),
signed amount, affected bucket(s), source reference (conversion, payout, or admin
action), actor (user / system / admin id), reason, **resolved maturity timestamp
for credits**, and created-at.

**The maturity timestamp is what makes the hold period honest.** The maturation
job reads this stored value and never re-resolves configuration, which is what
structurally guarantees "hold period changes apply to new credits only"
(ARCHITECTURE.md §9.4).

**Why `updated_at` does not exist here.** An `updated_at` column on an
append-only table is a lie that invites someone to write to it (§8).

---

#### `payout_requests`

**Responsible for:** one withdrawal request and its state machine
(ARCHITECTURE.md §11.1).

**Carries:** user reference, amount in points and its cash equivalent, payout
method, **payment destination**, status (`pending_review` / `approved` / `paid` /
`rejected` / `failed`), the lock's reward-transaction reference, reviewing admin,
review timestamp and reason, external payment reference, status-change
timestamps.

**On the payment destination.** It is stored because an admin must read it to
send the money — that is the entire manual payout model. It is treated as
sensitive: never logged (ARCHITECTURE.md §16.4), never returned in list
responses, only on the detail view an admin explicitly opens, and that view is
audited.

**Status history:** the current status lives on the row; the transition history
lives in `admin_audit_log` for admin-driven transitions and in
`reward_transactions` for the money movements. A separate payout-status-history
table would be a third record of the same events (P6).

---

### 3.6 Risk

#### `fraud_evaluations`

**Responsible for:** the recorded outcome of scoring one conversion — score,
which rules fired, and the recommended action.

**Carries:** conversion reference, user reference, score, triggered rules with
their values, recommended action (`allow` / `hold` / `review` / `block`), the
action actually taken, **a snapshot of the thresholds in force**, and the
evaluation timestamp.

**Why the thresholds are snapshotted.** Thresholds are configuration and will be
tuned continuously (P3). Without the snapshot, a held conversion from last month
cannot be explained — "which rule held this, at what threshold?" is exactly what
an admin asks when reviewing, and re-reading current configuration answers a
different question.

**Why the evaluation is persisted at all**, given fraud is a pure function
(ARCHITECTURE.md §4.2): the function is pure, its *output* is a business record.
An admin clearing a hold needs to see what triggered it.

---

### 3.7 Operations

#### `configuration_values`

**Responsible for:** every business rule value (P3), scoped and typed.

**Carries:** key, scope type (`global` / `provider`), scope id (null for global),
value, value type, description, updated-by, updated-at.

**Unique on (key, scope_type, scope_id)** — the constraint that makes the
`provider → global` resolution chain unambiguous.

**Why a generic key-value table rather than a typed settings row per concern.** A
typed table would require a migration for every new business rule, and P3's whole
point is that rules change without deployment. The cost is that validation lives
in code rather than in column types — accepted deliberately, and mitigated by
validating on write (ARCHITECTURE.md §4.9). **This is the one place where a
generic shape beats a specific one**, and it is bounded by §5.2's rule that keys
must name a business need.

---

#### `configuration_history`

**Responsible for:** the append-only record of every configuration change.

**Carries:** key, scope, old value, new value, actor, reason, timestamp.

**Separate from `admin_audit_log`** because it is queried differently — "show me
this key's history" is a per-key timeline, and it must also capture changes made
by migrations or seed scripts, which have no admin actor.

---

#### `admin_audit_log`

**Responsible for:** every action an admin takes, immutably.

**Carries:** admin reference, action, target type and id, before/after summary,
reason, IP, timestamp.

**Written inside the same transaction as the action it records** (§10). An audit
entry written afterward can be lost precisely when it matters most — when the
action succeeded and something then failed.

**Never deleted, never expires** (§7).

---

#### `email_log`

**Responsible for:** which transactional emails were sent, to whom, and whether
delivery was accepted.

**Carries:** user reference, template, recipient, status, provider message id,
error, timestamp.

**Never carries the email body.** It answers "was the verification email sent?",
not "what did it say" — the template plus its parameters answer that, and storing
bodies means storing personal data with no retention story.

---

#### `support_tickets`

**Responsible for:** a user-reported problem, most often a missing credit
(PROJECT.md §3.2), and its resolution.

**Owned by a small `support` module** (§1).

**Carries:** user reference, type, related click/conversion reference, user's
description, status (`open` / `investigating` / `resolved` / `rejected`),
assigned admin, resolution notes, resolution type, timestamps.

**Never carries the resolution's money effect.** If an admin resolves a ticket by
granting points, that is a `manual_adjustment` reward transaction referencing the
ticket. The ticket records the decision; the transaction records the money.

---

## 4. High-Level ER Diagram

Cardinality reads left to right. `1─*` means one row on the left relates to many
on the right.

```
                              ┌──────────────────┐
                              │    providers     │
                              └────────┬─────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │ 1─*                    │ 1─*                    │ 1─*
              ▼                        ▼                        ▼
      ┌───────────────┐      ┌──────────────────┐    ┌────────────────────┐
      │    offers     │      │ offer_sync_runs  │    │ provider_postbacks │
      └───────┬───────┘      └──────────────────┘    └─────────┬──────────┘
              │ 1─*                                            │ 1─0..1
              ▼                                                ▼
      ┌───────────────┐  1─*                          ┌────────────────────┐
      │    clicks     │ ─────────────────────────────►│    conversions     │
      └───────▲───────┘                               └─────────┬──────────┘
              │ 1─*                                             │
              │                                                 │ 1─0..1
   ┌──────────┴───────────┐                          ┌──────────▼──────────┐
   │        users         │                          │ fraud_evaluations   │
   └──┬───┬───┬───┬───┬───┘                          └─────────────────────┘
      │   │   │   │   │
      │   │   │   │   │ 1─1        ┌──────────────────┐
      │   │   │   │   └───────────►│  user_balances   │
      │   │   │   │                └──────────────────┘
      │   │   │   │ 1─*            ┌──────────────────┐    conversions ──┐
      │   │   │   └───────────────►│reward_transactions│◄────────────────┘
      │   │   │                    └──────────────────┘◄──┐
      │   │   │ 1─*                ┌──────────────────┐   │ lock / settle
      │   │   └───────────────────►│  payout_requests │───┘
      │   │                        └──────────────────┘
      │   │ 1─*   ┌──────────────────┐   ┌────────────────────┐
      │   └──────►│  user_devices    │   │  support_tickets   │◄── users 1─*
      │           └──────────────────┘   └────────────────────┘
      │ 1─*   ┌──────────────────┐  ┌────────────────────┐  ┌───────────┐
      └──────►│  refresh_tokens  │  │verification_tokens │  │ email_log │
              └──────────────────┘  └────────────────────┘  └───────────┘

   Standalone (no user FK, or actor-only):
   ┌─────────────────────┐  ┌────────────────────────┐  ┌─────────────────┐
   │configuration_values │  │ configuration_history  │  │ admin_audit_log │
   └─────────────────────┘  └────────────────────────┘  └─────────────────┘
```

### 4.1 Relationships Worth Stating Explicitly

| Relationship | Cardinality | Why it is this way |
|---|---|---|
| `clicks` → `conversions` | 1 ─ many | Multi-event offers send several postbacks per click. A one-to-one assumption breaks on the second event |
| `provider_postbacks` → `conversions` | 1 ─ 0..1 | Duplicates and quarantined postbacks produce no conversion. The postback always exists; the conversion may not |
| `conversions` → `conversions` | self, 0..1 | A reversal points at the conversion it reverses |
| `users` → `user_balances` | 1 ─ 1 | Created with the user, never absent |
| `conversions` → `reward_transactions` | 1 ─ many | A credit, and possibly a later reversal debit |
| `payout_requests` → `reward_transactions` | 1 ─ many | Lock, then settle *or* refund |
| `offers` → `clicks` | 1 ─ many | Offers are overwritten by sync; clicks keep a snapshot (§3.3) |

---

## 5. Naming Conventions

Uniform and boring on purpose — a convention that requires thought at each use is
a convention that drifts.

| Element | Rule | Example |
|---|---|---|
| Tables | `snake_case`, **plural** | `reward_transactions` |
| Columns | `snake_case`, singular | `external_transaction_id` |
| Foreign keys | `<singular_entity>_id` | `user_id`, `provider_id` |
| Self-referencing FK | `<role>_<entity>_id` | `reverses_conversion_id` |
| Booleans | `is_` / `has_` prefix | `is_active`, `has_verified_email` |
| Timestamps | `_at` suffix, always UTC | `created_at`, `matures_at`, `revoked_at` |
| Durations | `_seconds` / `_days` suffix | `hold_period_days` |
| Amounts in points | `_points` suffix | `awarded_points` |
| Amounts in money | `_amount` + separate `_currency` | `payout_amount`, `payout_currency` |
| Enum columns | singular noun, no `_type` unless genuinely a type | `status`, `transaction_type` |
| Indexes | `idx_<table>_<columns>` | `idx_clicks_user_id_created_at` |
| Unique constraints | `uq_<table>_<columns>` | `uq_postbacks_provider_external_id` |
| Foreign key constraints | `fk_<table>_<referenced>` | `fk_clicks_offer` |

**Rules that are not naming but belong here:**

- **All timestamps are timezone-aware and stored in UTC.** Local time appears at
  the display layer only. A naive timestamp in a system that pays users across
  time zones is a bug waiting for a specific date.
- **Points are integers. Always.** Never a float, never a decimal. Floating-point
  points produce balances that do not sum, and the reconciliation job would spend
  its life reporting rounding drift.
- **Money from providers is stored in minor units** (integer) with a separate
  ISO-4217 currency code. Never a float.
- **Enums are database enums**, not free text with a check constraint. The
  closed sets here (transaction type, payout status) are genuinely closed, and a
  typo in a status string is a bug that a text column will not catch. Adding a
  value later is a routine migration; the rare removal is handled deliberately.
- **No abbreviations** except the universally understood (`id`, `ip`, `url`).
  `conv_txn_ref` saves eight characters and costs every reader a lookup.

---

## 6. ID Strategy

**Decision: UUIDv7 primary keys on every table, exposed directly in the API.**

| Option | Verdict |
|---|---|
| Auto-increment integers | **Rejected.** Sequential ids in URLs are enumerable — `/payouts/1042` invites walking the range, and the count leaks business volume |
| UUIDv4 | **Rejected.** Random ids scatter B-tree inserts across the index, which degrades insert performance on the high-volume tables (`clicks`, `provider_postbacks`) exactly where it hurts |
| **UUIDv7** | **Chosen.** Unguessable like v4, but time-ordered, so inserts stay local in the index and rows sort naturally by creation |
| Integer PK + separate public UUID | **Rejected.** Two identifiers per row means every query and every log line has to specify which one it means. That is a real cost paid on every table to solve a problem one identifier already solves (P6) |

**UUIDs are generated in the application, not by the database.** The application
often needs the id before the insert — to build a `sub_id`, to reference the row
in a job payload, to log it. Round-tripping to get a database-generated id makes
that awkward and rules out batch inserts with known ids.

**Natural keys exist as unique constraints, never as primary keys:**
`providers.slug`, `users.email`, `clicks.sub_id`,
`(provider_id, external_transaction_id)` on postbacks,
`(provider_id, external_offer_id)` on offers,
`(key, scope_type, scope_id)` on configuration. A natural key as a primary key
means every referencing row has to change when the natural key does — and slugs
and emails do change.

**The `sub_id` is not the click's primary key.** It is a separately generated,
signed, opaque value stored on the click. Using the primary key as the `sub_id`
would send our internal identifier to a third party and back, and would make the
signature scheme (ARCHITECTURE.md §19.2) harder to change independently.

---

## 7. Soft Delete Policy

**Default: no soft delete. Most rows are never deleted at all.**

Blanket soft-delete is rejected because it puts a `deleted_at IS NULL` predicate
on every query in the system, and the one place someone forgets it is a data
leak. Deletion is decided per entity, and most of the answer is "never."

### 7.1 Never Deleted — Hard or Soft

`reward_transactions`, `conversions`, `provider_postbacks`, `payout_requests`,
`admin_audit_log`, `configuration_history`, `fraud_evaluations`.

**Why.** These are financial and audit records. They answer disputes months
later, they are the reconciliation input, and — for postbacks — they are the
replay source when processing has a bug. There is no scenario where deleting one
is the correct response to anything.

### 7.2 Deactivated, Not Deleted

| Entity | Mechanism | Why not delete |
|---|---|---|
| `offers` | `is_active = false` | Clicks reference them; a click to a vanished offer is an unanswerable ticket (§3.3) |
| `providers` | `is_enabled = false` | Every conversion ever received references one |
| `configuration_values` | Superseded, with history | The old value explains old behavior |

### 7.3 Users — Anonymized, Never Removed

A user who requests deletion has their `status` set to `closed` and their
personal data (email, IP, device fingerprints, payment destinations)
**overwritten with anonymized placeholders**. The row and its identifier survive.

**Why not delete the row.** Conversions, reward transactions, and payouts
reference it. Cascading the delete would erase financial history that the
platform is obliged to keep and that reconciliation depends on; nulling the
references would orphan money records from any account.

**Why this satisfies a deletion request.** What the user is entitled to have
removed is personal data, not the fact that a payout was made. Anonymization
removes the former and preserves the latter. **The exact policy is a legal
question flagged in PROJECT.md R7, not a schema question — the schema's job is to
make anonymization possible, and it does.**

### 7.4 Genuinely Deleted, by Retention Job

| Entity | Retention | Why deletion is safe |
|---|---|---|
| `verification_tokens` | Deleted once used or expired | Single-use and short-lived; no historical value |
| `refresh_tokens` | Deleted a bounded period after expiry | Revocation is enforced while valid; expired rows are noise |
| `email_log` | Bounded retention | Operational, not financial |
| `offer_sync_runs` | Bounded retention | Operational history; provider health is on the provider row |
| `user_devices` | Stale rows pruned | Fraud signals have a useful life |

**No cascading deletes are configured anywhere.** Every parent in this model is
either never deleted or deactivated. A cascade is a loaded gun pointed at
financial history, and the fact that it would only fire on an operation we never
perform is not a reason to keep it.

---

## 8. Audit Fields

**Mutable entities** carry `created_at` and `updated_at`.

**Append-only entities** carry `created_at` only — `reward_transactions`,
`provider_postbacks`, `admin_audit_log`, `configuration_history`,
`fraud_evaluations`, `email_log`.

**Why append-only tables get no `updated_at`.** A column that must always equal
`created_at` is a claim that updating is expected. Someone eventually updates the
row and sets it, and the table's guarantee is gone with no error raised. Omitting
the column makes the intent visible in the schema.

**Actor attribution** is on rows where "who did this" is a real question:
`reward_transactions.actor`, `payout_requests.reviewed_by`,
`configuration_values.updated_by`, `admin_audit_log.admin_id`,
`support_tickets.assigned_to`.

**Actor is a discriminated reference — `user` / `admin` / `system` plus an
optional id — not a nullable foreign key to `users`.** Most mutations are made by
the system (maturation, postback processing, reconciliation), and a null
`user_id` cannot distinguish "the system did it" from "we forgot to record who
did it". That distinction matters in exactly the situation an audit trail exists
for.

**Not audit fields, deliberately:** a `version` column for optimistic locking
(ARCHITECTURE.md §9.5 chose pessimistic locking), and `created_by` on rows a user
obviously created themselves (`clicks`, `payout_requests` — the `user_id` *is*
the actor).

---

## 9. Indexing Strategy — High Level

Two categories, with different rules.

### 9.1 Correctness Indexes — Present From Day One

These enforce business rules and are not negotiable or deferrable:

| Constraint | Enforces |
|---|---|
| **unique `(provider_id, external_transaction_id)`** on `provider_postbacks` | **Postback idempotency.** The most important index in the database |
| unique `sub_id` on `clicks` | Attribution is unambiguous |
| unique `email` (case-insensitive) on `users` | One account per email |
| unique `slug` on `providers` | Registry resolution |
| unique `(provider_id, external_offer_id)` on `offers` | Sync upserts target one row |
| unique `(key, scope_type, scope_id)` on `configuration_values` | Resolution chain is unambiguous |
| unique `user_id` on `user_balances` | One balance per user |
| unique `token_hash` on `refresh_tokens`, `verification_tokens` | Lookup by presented token |

### 9.2 Performance Indexes — Only for Queries That Exist

**Every foreign key gets an index.** PostgreSQL does not create them
automatically, and their absence turns any referential check or join into a
sequential scan. This is the one blanket rule.

Beyond that, indexes are added **for queries that are actually written**, not for
queries someone imagines. The known access paths at design time:

| Access path | Roughly |
|---|---|
| Offer wall render | `offers` by provider + active + country + device |
| User's earnings history | `conversions` by user, newest first |
| User's statement | `reward_transactions` by user, newest first |
| Admin payout queue | `payout_requests` by status + age |
| Maturation job | `reward_transactions` by maturity, **partial** — only rows still pending |
| Postback processing | `provider_postbacks` by state, **partial** — only unprocessed |
| Multi-account detection | `user_devices` by fingerprint |

**Partial indexes for the job queues** because both scan a small, shrinking
working set inside a table that grows forever. Indexing the whole table to find
the few hundred unprocessed rows is the wrong shape.

### 9.3 What Is Deliberately Not Done Yet

No partitioning, no materialized views, no covering indexes, no read replicas, no
denormalized reporting tables.

**Why.** Every one of them is a real technique with a real cost, and none has a
present-tense problem to solve (P6). `provider_postbacks` and `clicks` will grow
fastest and are the first partitioning candidates — **the trigger is measured
query degradation, not table size in the abstract.**

**The rule going forward:** an index is added with the query that needs it and a
note of which query that is. An index nobody can attribute to a query is an index
nobody can safely remove.

---

## 10. Transaction Boundaries

The most implementation-critical section here. Each operation below is **exactly
one database transaction** — no more, no fewer.

### 10.1 The Boundaries

| Operation | One transaction covering | Notes |
|---|---|---|
| **Postback receipt** | Insert the raw postback row | A single statement. The unique constraint does the work. **Enqueue only after commit** |
| **Postback processing** | Create conversion → credit reward → mark postback processed | The critical one. Partial completion here is a missing or duplicated credit |
| **Chargeback** | Create reversal conversion → reverse reward → mark original reversed | Same shape as above |
| **Withdrawal submission** | Lock points → create payout request | A lock without a request strands points; a request without a lock allows double-spend |
| **Payout approve** | Status transition → audit entry | |
| **Payout settle** | Status → consume lock → audit entry | |
| **Payout reject / fail** | Status → release lock → audit entry | |
| **Maturation** | One transaction **per transaction row**, not per batch | §10.3 |
| **Manual adjustment** | Reward transaction → audit entry | |
| **Configuration write** | Value upsert → history row | Cache invalidation is published **after** commit |
| **Registration** | Create user → create balance row → create verification token | The balance row is never absent (§3.5) |
| **Catalog sync** | One transaction **per chunk** of offers, not per run | §10.3 |

### 10.2 Rules Inside a Transaction

1. **No external I/O.** No HTTP calls, no queue publishes, no emails, no cache
   writes. A provider call inside a transaction holds locks for the duration of
   someone else's network latency, and a queue publish inside one can enqueue a
   job for a row that then rolls back — producing a worker that processes data
   which does not exist.
2. **Side effects fire after commit.** Enqueue, invalidate, notify — all of it
   happens once the transaction has committed.
3. **Lock ordering is fixed: `user_balances` first, always.** When an operation
   touches the balance and other rows, the balance row is locked first. A
   consistent order across all code paths is what prevents deadlocks, and one
   documented rule is cheaper than debugging an intermittent one in production.
4. **Transactions stay short.** Configuration reads, rate conversion, validation,
   and fraud scoring all happen *before* the transaction opens
   (ARCHITECTURE.md §10.3).
5. **The audit entry is inside the transaction it audits** (§3.7). An audit
   written after the fact is missing exactly when the action succeeded and the
   audit write failed.

### 10.3 Why Some Operations Are Deliberately Not One Transaction

**Maturation and catalog sync are per-row and per-chunk.**

A single transaction over every maturing reward would hold locks on thousands of
balance rows while it ran, block every concurrent credit and withdrawal, and lose
all progress on any single failure. Per-row transactions mean a failure loses one
row's work, and the job's idempotency (ARCHITECTURE.md §12.2) makes the retry
safe. The same reasoning applies to syncing a provider's catalog in chunks.

**This is a correctness argument, not a performance one.** Long transactions on
contended rows are how a system that works in testing deadlocks under load.

---

## 11. Data Ownership Between Modules

The schema restates ARCHITECTURE.md §4's ownership, with one correction and one
addition (§1):

| Module | Owns |
|---|---|
| `auth` | `refresh_tokens`, `verification_tokens` |
| `users` | `users`, `user_devices` |
| `providers` | `providers` |
| `offers` | `offers`, `offer_sync_runs` |
| `clicks` | `clicks` |
| `conversions` | `conversions`, `provider_postbacks` |
| `rewards` | `user_balances`, `reward_transactions` |
| `payouts` | `payout_requests` |
| `fraud` | `fraud_evaluations` |
| `support` | `support_tickets` |
| `notifications` | `email_log` |
| `admin` | `admin_audit_log` |
| `core/config` | `configuration_values`, `configuration_history` |

### 11.1 The Rule That Is Easy to Get Wrong

**Foreign keys may cross module boundaries. Code access may not.**

`clicks.user_id` references `users.id` — that constraint belongs in the database,
because referential integrity is the database's job and enforcing it in
application code is how orphans appear. But the `clicks` module **does not query
the `users` table**. When it needs user data, it calls `UsersService`.

**Why both halves matter.** Dropping the foreign key to "respect boundaries"
trades a real guarantee for an architectural gesture. Querying across the
boundary because the foreign key exists dissolves the module boundary entirely —
and the first sign is a join that reads three tables from two modules, which
nobody can safely change afterward.

**The single hardest boundary:** nothing outside `rewards` touches
`user_balances` or `reward_transactions` — not the admin panel, not reporting,
not a "quick" join. This is P2's migration path, and ARCHITECTURE.md §4.4 tests
for it specifically.

### 11.2 Cross-Module Reads in Practice

| Wants | Does not | Does |
|---|---|---|
| `payouts` needs a user's balance | Query `user_balances` | Call `RewardAccountingService.getBalance()` |
| `admin` needs a user's statement | Join `reward_transactions` | Call `RewardAccountingService.getHistory()` |
| `conversions` needs the click | Query `clicks` | Call `ClicksService` |
| `fraud` needs velocity counters | Query `clicks` | Read Redis counters via `core/cache` (ARCHITECTURE.md §4.2) |
| `offers` needs a provider's reward rate | Query `configuration_values` | Call `ConfigurationService` |

### 11.3 Reporting and the Admin Panel

Admin screens compose from module services (ARCHITECTURE.md §4.3), not from
cross-module joins. This will occasionally mean several queries where one join
would do.

**Accepted deliberately.** At MVP volume the difference is unmeasurable, and the
alternative — an admin panel with direct SQL across every module — is how the
boundaries die. **If a specific admin screen ever becomes genuinely slow, the fix
is a purpose-built read query owned by the module that owns the data**, exposed
through its service. Not a join in `admin`.

---

## 12. What Is Deliberately Not in the Database

| Data | Where it lives | Why not Postgres |
|---|---|---|
| Fraud velocity counters (short window) | Redis | Ephemeral, high-write, expire naturally. Postgres would take the write load for data that is worthless in an hour |
| Rate-limit counters | Redis | Same |
| Rendered offer wall cache | Redis | Derived, reconstructible, TTL'd |
| Business configuration cache | In-process per replica | ARCHITECTURE.md §14.3 |
| Queue and job state | Redis (BullMQ) | Reconstructible from `provider_postbacks` and cron schedules |
| Feature flags | Nowhere — not built | ARCHITECTURE.md §5.2 |
| Sessions | Signed cookies in `web` | ARCHITECTURE.md §23, open question 4 |
| Metrics | Nowhere — not built | ARCHITECTURE.md §17.4 |

**The governing distinction:** Postgres holds what must survive, be audited, or
be queried across time. Redis holds what is derived, expiring, or reconstructible.
Anything that would be *expensive to be wrong about* goes in Postgres.

---

## 13. Open Questions for M1

Small and deliberately deferred to the schema work itself.

1. **Points-to-cash conversion representation.** Points are integers; the cash
   equivalent shown at withdrawal needs a rate. Leaning toward storing the rate
   used on the payout request (same reasoning as §3.4), decided when the
   withdrawal screen is built.
2. **How many device fingerprints to retain per user.** Unbounded growth is
   possible for a user on many networks. A cap or a pruning window, chosen from
   real data rather than guessed.
3. **Whether `offer_sync_runs` needs per-offer rejection detail** or a summary
   suffices. Start with a summary; expand only if debugging a provider actually
   requires it.
4. **Whether support tickets need threaded messages** or a single description
   plus resolution notes is enough. Start with the simpler shape (P6).

---

## 14. Approval

- [ ] Approved by: ____________  Date: ____________

On approval, M1 begins: the Prisma schema and initial migration implementing this
model, then the configuration service, then authentication (ARCHITECTURE.md §24).

**Two items above are corrections to an already-approved document** (§1) and
should be confirmed along with this one — `provider_credentials` removed, and a
`support` module added to ARCHITECTURE.md §4's ownership table.
