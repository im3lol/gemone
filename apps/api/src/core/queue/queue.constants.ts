/**
 * Queue names and job names — ARCHITECTURE.md §13.1.
 *
 * Queues are separated by **failure characteristic**, not by domain. The
 * failure this prevents: a burst of catalog syncs starving postback
 * processing, so conversions stop being credited because the offer catalog is
 * refreshing. Splitting further, per domain, would add queues nobody monitors
 * (P6).
 *
 * Queues are declared with their **producer**, not their consumer. §13.1 lists
 * five, and all five now exist: `notifications` arrived with email
 * verification, the work that fills it, because an empty queue is still a
 * thing to configure, monitor and reason about.
 */
export const QUEUES = {
  /**
   * Long-running, provider-rate-limited outbound HTTP. Low concurrency —
   * hammering a provider's API is how an integration gets throttled, and a
   * throttled provider looks exactly like a broken one.
   */
  CATALOG: 'catalog',

  /**
   * Latency-sensitive and the highest volume there will be. Never blocked by
   * anything else (§13.1) — a burst of catalog syncs sharing this queue would
   * stop conversions being credited because the offer catalog is refreshing.
   *
   * `provider_postbacks` remains the durable record regardless of what is in
   * this queue: the archive is what a replay reads, not Redis (TODO T21).
   */
  POSTBACKS: 'postbacks',

  /**
   * Touches balances, so contention benefits from serialization (§13.1).
   *
   * Every job on this queue takes a row lock on the user's balance. Running
   * many at once would not go faster — they would queue on the same locks —
   * and it would turn a bounded, predictable sweep into a source of lock waits
   * for live credits on the request path.
   */
  REWARDS: 'rewards',

  /**
   * Nightly heavy jobs, serialized deliberately (§13.1, concurrency 1).
   *
   * Separate from `rewards` even though reconciliation reads balances, because
   * the two have opposite failure characteristics: `rewards` carries short,
   * latency-relevant work on the maturation path, and a sweep over every
   * balance sharing it would sit in front of that work for as long as the sweep
   * takes. Serialized rather than parallel because these jobs are scans — two
   * at once contend for the same pages and neither finishes sooner.
   */
  MAINTENANCE: 'maintenance',

  /**
   * Outbound messages to people. Slow, external, and allowed to be late.
   *
   * Separate from everything else because its failure mode is unlike theirs:
   * a delivery service that is down or throttling means jobs that retry for
   * minutes, and nothing else in the system should wait behind an email. It is
   * also the only queue whose work is *not* idempotent in the strict sense —
   * a retried send can deliver twice, which is a nuisance rather than a
   * correctness failure, and the opposite trade from the balance queues.
   */
  NOTIFICATIONS: 'notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const CATALOG_JOBS = {
  /**
   * The single repeatable job. Asks which providers are due and enqueues work
   * for them.
   *
   * One tick rather than one repeatable job per provider, deliberately. A
   * per-provider schedule has to be re-registered whenever an interval
   * changes, a provider is added, or one is disabled — three ways for the
   * schedule in Redis to drift from the rows in Postgres. A tick reads the
   * rows every time, so the database stays the only source of truth about
   * what runs when.
   */
  TICK: 'catalog-tick',

  /** One provider's synchronization. Payload carries ids, never snapshots (§13.2). */
  SYNC: 'catalog-sync',
} as const;

/**
 * The raw Redis connection, for health checks and anything that is not a queue.
 *
 * Declared here rather than in `queue.module.ts` so that the readiness check
 * can inject it without importing the module that provides it — which would
 * be a file cycle, and §5 rule 9 forbids those inside a module as firmly as
 * between them.
 */
export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');

/** Payload for `catalog-sync`. Identifiers only — a snapshot would be stale on retry. */
export interface CatalogSyncJobData {
  providerId: string;
  mode: 'FULL' | 'INCREMENTAL';
  /** Who asked. `schedule` or an admin id — it ends up in the run's log context. */
  requestedBy: string;
}

export const POSTBACK_JOBS = {
  /** Turn one archived postback into a conversion. */
  PROCESS: 'postback-process',
} as const;

/**
 * Payload for `postback-process`. The row id and nothing else (§13.2).
 *
 * Carrying the payload here would put a second copy of the provider's data in
 * Redis — where it is neither the archive nor durable — and a retry five
 * minutes later would act on the copy rather than on whatever the row now
 * says.
 */
export interface PostbackProcessJobData {
  postbackId: string;
}

export const MAINTENANCE_JOBS = {
  /**
   * The nightly sweep asserting every balance is explainable by its own
   * history — §12.1, PROJECT.md R4's last mitigation and R5's evidence.
   */
  RECONCILIATION: 'reconciliation',
} as const;

/**
 * Payload for `reconciliation`. A keyset cursor and nothing else (§13.2).
 *
 * The nightly tick carries no cursor; a page that filled enqueues the next one
 * carrying the last user it checked. Identifiers only, and the identifier here
 * is a position rather than an entity, so there is nothing to go stale on a
 * retry — re-running a page re-reads whatever the rows now say.
 */
export interface ReconciliationJobData {
  /** Exclusive lower bound: reconcile users ordered after this one. */
  after?: string;
}

export const REWARD_JOBS = {
  /**
   * The single repeatable sweep: credits whose hold period has elapsed move
   * from `pending` to `available`.
   *
   * One sweep rather than a job per credit, because the work is discovered by
   * a query rather than triggered by an event — nothing *happens* when a hold
   * elapses except time passing, so there is no moment at which to enqueue.
   */
  MATURATION: 'reward-maturation',
} as const;

export const NOTIFICATION_JOBS = {
  /** Deliver one address-verification email. */
  VERIFICATION_EMAIL: 'verification-email',

  /** Deliver one password-reset email. */
  PASSWORD_RESET_EMAIL: 'password-reset-email',
} as const;

/**
 * Payload for `verification-email`.
 *
 * The token is carried here rather than looked up, and it is the **only**
 * place in this system where a secret travels through a queue. The reason is
 * that it cannot be recovered later: only its SHA-256 is stored, so a job that
 * carried an id would have nothing to put in the email. The cost is bounded by
 * the token's own short expiry and by `removeOnComplete`.
 *
 * The address is carried too, rather than re-read from the user row, so that a
 * retry sends to the address that registered — not to whatever the row says by
 * then.
 */
export interface VerificationEmailJobData {
  userId: string;
  email: string;
  token: string;
}

/**
 * Payload for `password-reset-email`. The same shape, and for the same reason.
 *
 * A separate type rather than a shared one, even though the fields match today:
 * they are payloads of two different jobs, and the moment one of them needs a
 * field the other does not, a shared interface becomes a set of optional
 * properties that neither job fully describes.
 */
export interface PasswordResetEmailJobData {
  userId: string;
  email: string;
  token: string;
}
