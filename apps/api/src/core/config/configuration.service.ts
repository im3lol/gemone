import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ERROR_CODES } from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService, type PrismaTransactionClient } from '../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { DomainError } from '../errors/app-error';
import { InvalidationBus } from '../events/invalidation.bus';
import { INVALIDATION_DOMAINS } from '../events/invalidation-message';
import { CLOCK, type Clock } from '../time/clock';
import type {
  ConfigScope,
  ConfigurationKeyDefinition,
  ResolvedConfiguration,
} from './configuration-key';

/** Who changed a value. Discriminated, not a nullable user id (DATABASE.md §8). */
export type ConfigActor =
  | { type: 'admin'; id: string }
  | { type: 'system' }
  | { type: 'migration' };

export interface SetConfigurationOptions {
  scope?: ConfigScope;
  scopeId?: string | null;
  reason?: string;
  actor: ConfigActor;
}

/**
 * What a write actually did.
 *
 * Returned rather than `void` so a caller that owns the transaction knows
 * exactly what to invalidate after committing, and so an audit entry can record
 * the before and after without re-reading a row it just wrote.
 */
export interface WrittenConfiguration {
  key: string;
  scope: ConfigScope;
  scopeId: string;
  previousValue: unknown;
  /** Null when the write removed an override. */
  value: unknown;
}

export interface ConfigurationHistoryRecord {
  scope: ConfigScope;
  scopeId: string;
  oldValue: unknown;
  newValue: unknown;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  createdAt: Date;
}

/**
 * The mechanism that makes "everything configurable" real rather than
 * aspirational — ARCHITECTURE.md §4.9, P3.
 *
 * Database-backed, typed, validated on write, versioned with a full audit
 * trail, and cached in-process because configuration is read on nearly every
 * business operation but written rarely.
 *
 * SCOPE OF THIS IMPLEMENTATION: the machinery only. No business keys are
 * registered — those arrive with the features that own each rule.
 *
 * BOUNDARY (§4.9): this is a typed key-value store with two-level scoping and
 * an audit trail. It is NOT a rules engine, a feature-flag platform, or a DSL.
 * Adding a key requires naming the business need it serves; a key that exists
 * to hide half-finished code is an unfinished branch, and the right tool for
 * that is a branch (§5.2).
 */
@Injectable()
export class ConfigurationService implements OnModuleInit {
  private readonly logger = new Logger(ConfigurationService.name);

  /** Registered key definitions, by key. */
  private readonly definitions = new Map<string, ConfigurationKeyDefinition>();

  /**
   * In-process cache of stored rows, keyed by `key|scope|scopeId`.
   *
   * Every process holds its own. §14.3's Redis channel is what keeps them in
   * agreement: a write drops the entry here and broadcasts, and the other
   * processes drop theirs on receipt. See `invalidate` and
   * `invalidateAndBroadcast` — the distinction between them is what stops a
   * received message from being rebroadcast forever.
   */
  private readonly cache = new Map<string, unknown>();

  /**
   * Bumped by every invalidation, local or remote.
   *
   * Not a version of the data — a version of the *cache's* state, which is all
   * a read in flight needs in order to notice that what it is about to store
   * has already been superseded. See `remember` and D65.
   *
   * A double counts to 2^53 exactly; at one invalidation per nanosecond that is
   * a little over a century, so it does not need to wrap.
   */
  private generation = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly invalidations: InvalidationBus,
  ) {}

  /**
   * Listens for changes made by other processes.
   *
   * Registered in `onModuleInit`, which Nest runs for every module before the
   * bus subscribes to Redis in `onApplicationBootstrap` — so no message can
   * arrive before there is something to receive it.
   */
  onModuleInit(): void {
    this.invalidations.subscribe(INVALIDATION_DOMAINS.CONFIGURATION, (entry) => {
      if (!entry) {
        // "Everything" — a resync after a disconnect, or a message this build
        // could not read. Cheap: the cache refills from the next read.
        this.invalidateAll();
        return;
      }

      this.invalidate(entry.key, entry.scope as ConfigScope, entry.scopeId);
    });
  }

  /**
   * Declares a key. Called by the owning module at startup.
   *
   * Re-registering the same definition is a no-op; re-registering a
   * *different* definition for the same key throws, because two modules
   * disagreeing about a key's schema is a bug that would otherwise surface as
   * a validation failure on whichever registered last.
   */
  register<T>(definition: ConfigurationKeyDefinition<T>): void {
    const existing = this.definitions.get(definition.key);

    if (existing && existing !== (definition as ConfigurationKeyDefinition)) {
      throw new Error(
        `Configuration key "${definition.key}" is already registered by another definition`,
      );
    }

    this.definitions.set(definition.key, definition as ConfigurationKeyDefinition);
  }

  /** Every registered definition — powers the admin configuration screen. */
  definitionsList(): ConfigurationKeyDefinition[] {
    return [...this.definitions.values()];
  }

  getDefinition(key: string): ConfigurationKeyDefinition | undefined {
    return this.definitions.get(key);
  }

  /**
   * Resolves the value in force, most-specific scope first.
   *
   * Chain: PROVIDER → GLOBAL → the definition's default (§4.9). Ordered and
   * extensible: adding a third level later is a change here, not at every
   * call site.
   */
  async get<T>(key: string, scopeId?: string | null): Promise<T> {
    return (await this.resolve<T>(key, scopeId)).value;
  }

  /**
   * Effective-value inspection — resolves and reports where the value came
   * from. Configuration nobody can read confidently is configuration nobody
   * will change safely (§4.9).
   */
  async resolve<T>(key: string, scopeId?: string | null): Promise<ResolvedConfiguration<T>> {
    const definition = this.requireDefinition(key);

    if (scopeId != null && definition.scopes.includes('PROVIDER')) {
      const scoped = await this.readStored(key, 'PROVIDER', scopeId, definition);
      if (scoped !== undefined) {
        return { key, value: scoped as T, source: 'PROVIDER', scopeId };
      }
    }

    const global = await this.readStored(key, 'GLOBAL', GLOBAL_SCOPE_ID, definition);
    if (global !== undefined) {
      return { key, value: global as T, source: 'GLOBAL', scopeId: null };
    }

    return {
      key,
      value: definition.defaultValue as T,
      source: 'default',
      scopeId: null,
    };
  }

  /**
   * Writes a value, validating it and recording history in one transaction.
   *
   * The history row is written inside the same transaction as the value. A
   * history entry written afterwards can be lost exactly when it matters —
   * when the change succeeded and something then failed — leaving a value in
   * force that nobody can attribute.
   */
  async set<T>(
    key: string,
    value: T,
    options: SetConfigurationOptions,
    client?: PrismaTransactionClient,
  ): Promise<WrittenConfiguration> {
    const definition = this.requireDefinition(key);
    const scope = options.scope ?? 'GLOBAL';
    // GLOBAL rows use the empty-string sentinel, never null — see the schema
    // comment on ConfigurationValue.scopeId for why.
    const scopeId = scope === 'GLOBAL' ? GLOBAL_SCOPE_ID : (options.scopeId ?? '');

    if (!definition.scopes.includes(scope)) {
      throw new DomainError(
        ERROR_CODES.CONFIG_INVALID_SCOPE,
        `Configuration key "${key}" cannot be set at ${scope} scope`,
        422,
      );
    }

    if (scope === 'PROVIDER' && scopeId === GLOBAL_SCOPE_ID) {
      throw new DomainError(
        ERROR_CODES.CONFIG_INVALID_SCOPE,
        'A scope id is required when setting a value at PROVIDER scope',
        422,
      );
    }

    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      // Rejected at the boundary, not discovered in production (§4.9).
      throw new DomainError(
        ERROR_CODES.CONFIG_INVALID_VALUE,
        `Invalid value for "${key}": ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        422,
      );
    }

    const validated = parsed.data;

    /*
     * `previous` is read inside the transaction, not from the cache.
     *
     * It becomes the history row's `oldValue` and the admin audit entry's
     * "before", so it has to be what was actually stored — a cache entry this
     * process happens to hold can be stale, and an audit trail that records a
     * change from a value that was not there is worse than one that records
     * nothing.
     *
     * This narrows the window rather than closing it: two writes landing in
     * the same instant still both report the value they each read, because
     * there is no row lock here. That residual is recorded in TODO T38 — it
     * costs audit precision, never the value in force, which the upsert
     * settles atomically.
     */
    const write = async (tx: PrismaTransactionClient): Promise<unknown | undefined> => {
      const existing = await tx.configurationValue.findUnique({
        where: { key_scopeType_scopeId: { key, scopeType: scope, scopeId } },
      });

      const previous = existing ? existing.value : undefined;

      await tx.configurationValue.upsert({
        where: {
          key_scopeType_scopeId: { key, scopeType: scope, scopeId },
        },
        create: {
          id: uuidv7(),
          key,
          scopeType: scope,
          scopeId,
          value: validated as Prisma.InputJsonValue,
          valueType: definition.valueType,
          updatedBy: options.actor.type === 'admin' ? options.actor.id : options.actor.type,
        },
        update: {
          value: validated as Prisma.InputJsonValue,
          valueType: definition.valueType,
          updatedBy: options.actor.type === 'admin' ? options.actor.id : options.actor.type,
        },
      });

      await tx.configurationHistory.create({
        data: {
          id: uuidv7(),
          key,
          scopeType: scope,
          scopeId,
          oldValue:
            previous === undefined
              ? Prisma.DbNull
              : (previous as Prisma.InputJsonValue),
          newValue: validated as Prisma.InputJsonValue,
          actorType: options.actor.type,
          actorId: options.actor.type === 'admin' ? options.actor.id : null,
          reason: options.reason ?? null,
          createdAt: this.clock.now(),
        },
      });

      return previous;
    };

    let previous: unknown | undefined;

    if (client) {
      /*
       * The caller owns the transaction, so it also owns the moment of commit
       * — and therefore the invalidation.
       *
       * Invalidating here would be worse than not invalidating at all. The
       * write is not visible to other connections yet, so a concurrent read
       * between this point and the commit would load the *old* value into the
       * freshly-emptied cache and leave it there permanently. Stale
       * configuration that survives a restart is the one failure this cache
       * must never produce. See D51.
       *
       * Since §14.3 landed the same argument applies with more force: the
       * caller's `invalidateAndBroadcast` also *tells other processes to
       * re-read*, and inviting them to do that before the commit would spread
       * the old value to all of them instead of one.
       */
      previous = await write(client);
    } else {
      previous = await this.prisma.$transaction(write);
      await this.invalidateAndBroadcast(key, scope, scopeId);
    }

    this.logger.log(
      { key, scope, scopeId, actor: options.actor.type },
      'Configuration value changed',
    );

    return { key, scope, scopeId, previousValue: previous ?? null, value: validated };
  }

  /**
   * Removes an explicit setting, returning the key to its resolution chain.
   *
   * The half of CRUD the service never had. Without it a value could be
   * changed but never *unset*: a provider override, once written, would shadow
   * GLOBAL forever, and a GLOBAL row would shadow the default forever. That is
   * not a hypothetical — it is what "reset to default" means on the screen this
   * feature builds, and there was no way to do it.
   *
   * Removing an override is a configuration change like any other, so it writes
   * a history row with a null `newValue`. Null there means "returned to the
   * chain", which is a different fact from any value it could have stored.
   */
  async unset(
    key: string,
    options: Omit<SetConfigurationOptions, 'scope'> & { scope?: ConfigScope },
    client?: PrismaTransactionClient,
  ): Promise<WrittenConfiguration | null> {
    const definition = this.requireDefinition(key);
    const scope = options.scope ?? 'GLOBAL';
    const scopeId = scope === 'GLOBAL' ? GLOBAL_SCOPE_ID : (options.scopeId ?? '');

    if (!definition.scopes.includes(scope)) {
      throw new DomainError(
        ERROR_CODES.CONFIG_INVALID_SCOPE,
        `Configuration key "${key}" cannot be set at ${scope} scope`,
        422,
      );
    }

    /**
     * Returns the removed value, or null when there was nothing to remove.
     *
     * **Everything here reads and writes through `tx`, never through the cache
     * and never outside the transaction.** An earlier version checked the cache
     * first and then called `delete`, which was wrong in both directions: a
     * stale cache entry saying "nothing stored" made a reset silently do
     * nothing, and two concurrent resets both saw a value, both called
     * `delete`, and the loser hit Prisma's record-not-found and surfaced as a
     * 500 to whichever admin clicked second.
     */
    const write = async (tx: PrismaTransactionClient): Promise<unknown | null> => {
      const existing = await tx.configurationValue.findUnique({
        where: { key_scopeType_scopeId: { key, scopeType: scope, scopeId } },
      });

      if (!existing) return null;

      /*
       * `deleteMany`, not `delete`.
       *
       * `delete` throws when the row is already gone; `deleteMany` reports a
       * count. Under two concurrent resets the second transaction blocks on
       * the first one's row lock, then re-evaluates its predicate against the
       * committed state, matches nothing, and returns zero — the race resolves
       * itself into an ordinary no-op instead of an exception.
       *
       * Catching the exception instead would not work: in PostgreSQL a failed
       * statement aborts the whole transaction, so the history row that
       * follows could not be written anyway.
       */
      const { count } = await tx.configurationValue.deleteMany({
        where: { key, scopeType: scope, scopeId },
      });

      if (count === 0) return null;

      await tx.configurationHistory.create({
        data: {
          id: uuidv7(),
          key,
          scopeType: scope,
          scopeId,
          /*
           * Read inside the transaction, so it is what was actually removed
           * rather than what this process last cached.
           */
          oldValue: existing.value as Prisma.InputJsonValue,
          // Absent, not JSON null. The row records a removal.
          newValue: Prisma.DbNull,
          actorType: options.actor.type,
          actorId: options.actor.type === 'admin' ? options.actor.id : null,
          reason: options.reason ?? null,
          createdAt: this.clock.now(),
        },
      });

      return existing.value;
    };

    const previous = client ? await write(client) : await this.prisma.$transaction(write);

    if (previous === null) {
      /*
       * Nothing was stored, or a concurrent reset got there first. Not an
       * error either way — "make this key use its default" is already true.
       *
       * Returns null so the caller can tell a no-op from a change and skip
       * writing an audit entry for something that did not happen.
       */
      return null;
    }

    if (!client) {
      await this.invalidateAndBroadcast(key, scope, scopeId);
    }

    this.logger.log(
      { key, scope, scopeId, actor: options.actor.type },
      'Configuration override removed',
    );

    return { key, scope, scopeId, previousValue: previous, value: null };
  }

  /**
   * Every explicit setting for a key, across scopes.
   *
   * Distinct from `resolve()`, which answers "what value is in force?". This
   * answers "what has somebody actually set?" — and the difference between the
   * two is exactly what an admin needs to see before changing either.
   */
  async storedValues(key: string): Promise<
    {
      scope: ConfigScope;
      scopeId: string;
      value: unknown;
      valid: boolean;
      updatedBy: string | null;
      updatedAt: Date;
    }[]
  > {
    const definition = this.requireDefinition(key);

    const rows = await this.prisma.configurationValue.findMany({
      where: { key },
      orderBy: [{ scopeType: 'asc' }, { scopeId: 'asc' }],
    });

    return rows.map((row) => ({
      scope: row.scopeType,
      scopeId: row.scopeId,
      /*
       * The raw stored value, deliberately — this is the "what has somebody
       * actually set?" view, and an admin cannot fix a row they cannot see.
       */
      value: row.value,
      /*
       * Whether the resolution chain will actually use it.
       *
       * A row that no longer satisfies its key's schema is ignored on read
       * (see `readStored`) and logged, but the log is the only signal — and on
       * this screen the row would otherwise appear as a live override while
       * the effective value came from somewhere else entirely. Two facts that
       * contradict each other, with nothing saying which is true.
       */
      valid: definition.schema.safeParse(row.value).success,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    }));
  }

  /** How many keys have something stored, by key. Powers the list screen. */
  async overrideCounts(): Promise<Map<string, number>> {
    const rows = await this.prisma.configurationValue.groupBy({
      by: ['key'],
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.key, row._count._all]));
  }

  /**
   * A key's change history, newest first.
   *
   * **Carries the scope of each entry.** DATABASE.md §3.7 keeps this table
   * separate from `admin_audit_log` because "show me this key's history" is a
   * per-key timeline — and a per-key timeline spans every scope that key is
   * set at. Without the scope on each row, a key with a GLOBAL value and three
   * provider overrides produces a list of "30 → 60" entries with no way to
   * tell which of the four moved.
   */
  async history(
    key: string,
    options: { limit?: number; scope?: ConfigScope; scopeId?: string } = {},
  ): Promise<ConfigurationHistoryRecord[]> {
    const rows = await this.prisma.configurationHistory.findMany({
      where: {
        key,
        ...(options.scope ? { scopeType: options.scope } : {}),
        ...(options.scopeId !== undefined ? { scopeId: options.scopeId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(options.limit ?? 50, 200),
    });

    return rows.map((row) => ({
      scope: row.scopeType,
      scopeId: row.scopeId,
      /*
       * Prisma returns SQL NULL as JS null for a nullable Json column, which
       * is exactly the distinction both ends of this row need: a null
       * `oldValue` means nothing was stored before, and a null `newValue`
       * means the override was removed.
       */
      oldValue: row.oldValue ?? null,
      newValue: row.newValue ?? null,
      actorType: row.actorType,
      actorId: row.actorId,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Drops a cached entry **on this process only**.
   *
   * This is the receiving half: it is what the §14.3 subscriber calls when
   * another process reports a change, and what tests call to force a re-read.
   * A write path wants `invalidateAndBroadcast` instead.
   *
   * The two are separate methods rather than a boolean parameter because the
   * failure they prevent is a loop — a received message that rebroadcasts is
   * received again, forever, by every process including the one that sent it.
   * A parameter defaulting either way puts that loop one forgotten argument
   * away; two names cannot be confused at a call site.
   */
  invalidate(key: string, scope: ConfigScope, scopeId: string): void {
    this.cache.delete(cacheKey(key, scope, scopeId));

    // Deleting is not enough on its own: a read already in flight would write
    // the pre-invalidation value straight back. See `remember` and D65.
    this.generation += 1;
  }

  /** Drops everything on this process only. Same halves as `invalidate`. */
  invalidateAll(): void {
    this.cache.clear();
    this.generation += 1;
  }

  /**
   * Drops an entry here and tells every other process to drop theirs — §14.3.
   *
   * **Call this after the commit, never before it** (D51). The ordering that
   * mattered for the local cache matters more for the broadcast: a message sent
   * before the transaction commits invites every other process to read the row
   * *and cache the old value*, turning one stale copy into as many as there are
   * processes. Both existing callers already own that ordering — `set`/`unset`
   * when they own the transaction, and `AdminConfigurationService` when it does.
   *
   * Local first, then the broadcast, and the broadcast cannot fail the caller:
   * this process is correct either way, and a notification that did not go out
   * is a degradation (§14.4), not a failed write.
   */
  async invalidateAndBroadcast(
    key: string,
    scope: ConfigScope,
    scopeId: string,
  ): Promise<void> {
    this.invalidate(key, scope, scopeId);
    await this.invalidations.publish(INVALIDATION_DOMAINS.CONFIGURATION, {
      key,
      scope,
      scopeId,
    });
  }

  private requireDefinition(key: string): ConfigurationKeyDefinition {
    const definition = this.definitions.get(key);

    if (!definition) {
      // A value cannot be written or read for an unregistered key. This is
      // what keeps the store typed rather than free-form.
      throw new DomainError(
        ERROR_CODES.CONFIG_UNKNOWN_KEY,
        `Unknown configuration key "${key}"`,
        422,
      );
    }

    return definition;
  }

  /**
   * Reads one stored row, caching both hits and misses.
   *
   * Misses are cached as a sentinel rather than left absent: without it, a key
   * with no row at PROVIDER scope would hit the database on every single read,
   * which is the common case for a chain that usually resolves to GLOBAL.
   *
   * ## The stored value is re-validated here, not trusted
   *
   * ARCHITECTURE.md §14.4: *"Cached values are typed on read, not trusted. A
   * stale shape from a previous deploy is treated as a miss."* That rule was
   * written about the cache and applies with more force to the row behind it,
   * because a row outlives every deploy.
   *
   * `set()` validates on write, so nothing written through the service can be
   * malformed. Two things get past it: **a key whose schema changes in a later
   * release while a value is stored under the old shape**, and a migration or
   * seed script writing a row directly. Both are ordinary events.
   *
   * Without this check the malformed value is handed to a business rule as
   * though it were valid, and the failures are silent and specific. A fraud
   * rule stored under an older shape produced a `NaN` score — which Postgres
   * refuses on an integer column, failing the conversion job and eventually
   * losing a user their credit — while simultaneously reporting `ALLOW` for a
   * rule that had fired, because an `undefined` action compares as less severe
   * than every real one. Neither failure logs anything on its own.
   *
   * Treated as a miss, so the chain falls through: a bad PROVIDER value yields
   * the GLOBAL one, and a bad GLOBAL value yields the default that code
   * declares. Logged at `error`, because a value somebody set is not being
   * applied — §17.1's level for "a thing that should have happened did not".
   */
  private async readStored(
    key: string,
    scope: ConfigScope,
    scopeId: string,
    definition: ConfigurationKeyDefinition,
  ): Promise<unknown | undefined> {
    const entry = cacheKey(key, scope, scopeId);

    if (this.cache.has(entry)) {
      const cached = this.cache.get(entry);
      return cached === MISS ? undefined : cached;
    }

    /*
     * Read before the query, compared after it — see `remember` and D65.
     *
     * Everything from here to the `remember` call is one read attempt, and the
     * only thing that can happen in the middle of it is an invalidation.
     */
    const generation = this.generation;

    const row = await this.prisma.configurationValue.findUnique({
      where: { key_scopeType_scopeId: { key, scopeType: scope, scopeId } },
    });

    if (!row) {
      this.remember(entry, MISS, generation);
      return undefined;
    }

    const parsed = definition.schema.safeParse(row.value);

    if (!parsed.success) {
      this.logger.error(
        {
          key,
          scope,
          scopeId,
          issues: parsed.error.issues.map((issue) => issue.message),
        },
        'Stored configuration value no longer satisfies its schema; ignoring it and falling back',
      );

      /*
       * Cached as a miss so the parse is not repeated on every read of a hot
       * key. The entry is dropped by any write to it and by a restart, which
       * are the only two ways the row gets fixed.
       */
      this.remember(entry, MISS, generation);
      return undefined;
    }

    /*
     * The parsed value, not the raw row. Consistent with `set()`, which stores
     * `parsed.data` — so a schema carrying a coercion or a default behaves the
     * same whether the value has just been written or read back later.
     */
    this.remember(entry, parsed.data, generation);
    return parsed.data;
  }

  /**
   * Caches what a read found — unless the read was overtaken — D65.
   *
   * ## The failure this exists to prevent
   *
   * A read is not atomic: it checks the cache, awaits a query, then writes the
   * result back. An invalidation landing in that gap deletes an entry that has
   * not been written yet, and the write-back then reinstates the value the
   * invalidation was about. Nothing further is coming to correct it, so the
   * process serves that value until the key is written again or it restarts —
   * which is exactly what D51 calls the one failure this cache must never
   * produce, arriving by a route D51 did not close.
   *
   * The window is the query's own duration, and it is widest immediately after
   * a resync (D60, D61, D64), because those drop every entry at once and leave
   * every key's next read a query.
   *
   * ## Why a counter and not something cleverer
   *
   * The read has to detect that the world moved under it. A generation number
   * is the whole of that: read it before the query, compare after, and decline
   * to cache if it changed. `invalidate` stays a delete plus an increment, so
   * it is still O(1) and takes no lock; a cache *hit* never touches the counter
   * at all, so the hot path is byte-for-byte what it was.
   *
   * **Declining to cache is always safe.** The value is still returned to the
   * caller — a read that began before a write legitimately observes what was
   * there when it began, which is ordinary read timing and not staleness. Only
   * the persistence is refused, and the cost of refusing wrongly is one extra
   * query on the next read.
   *
   * The counter is deliberately global rather than per entry. An invalidation
   * of any key therefore discards the write-back of every read in flight, not
   * just that key's. That is conservative in the safe direction, costs one
   * query per discarded read, and keeps this to a single integer with no second
   * map to keep in step with the first — see TODO T53.
   */
  private remember(entry: string, value: unknown, generation: number): void {
    /*
     * Node runs this synchronously with the comparison, so there is no window
     * between deciding and acting. That is what makes a plain counter
     * sufficient here and a lock unnecessary.
     */
    if (generation !== this.generation) return;

    this.cache.set(entry, value);
  }
}

/** The sentinel scope id for GLOBAL rows. */
export const GLOBAL_SCOPE_ID = '';

/** Distinguishes "cached: no row" from "not cached". */
const MISS = Symbol('CONFIG_MISS');

function cacheKey(key: string, scope: ConfigScope, scopeId: string): string {
  return `${key}|${scope}|${scopeId}`;
}

export type { PrismaTransactionClient };
