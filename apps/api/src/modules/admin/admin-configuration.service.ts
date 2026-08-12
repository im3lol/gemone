import {
  ADMIN_ACTIONS,
  CONFIG_SCOPES,
  ERROR_CODES,
  type AdminConfigurationKeyDetail,
  type AdminConfigurationKeyList,
  type AdminConfigurationKeySummary,
  type AdminListConfigurationQuery,
  type ConfigScopeName,
  type ConfigurationHistoryEntry,
  type ConfigurationOverride,
} from '@gemone/contracts';
import { Injectable, Logger } from '@nestjs/common';

import type { ConfigScope, ConfigurationKeyDefinition } from '../../core/config/configuration-key';
import {
  ConfigurationService,
  GLOBAL_SCOPE_ID,
  type ConfigurationHistoryRecord,
  type ConfigurationRowCounts,
} from '../../core/config/configuration.service';
import { PrismaService, type PrismaTransactionClient } from '../../core/database/prisma.service';
import { DomainError, ValidationError } from '../../core/errors/app-error';
import { ProvidersService } from '../providers/providers.service';
import { AdminAuditService } from './admin-audit.service';
import type { AdminActionContext } from './admin-users.service';

/**
 * The administrative surface over `ConfigurationService` — P3's second half.
 *
 * Everything below is composition (ARCHITECTURE.md §4.3). No value is read,
 * written, validated or resolved here: `ConfigurationService` has done all four
 * since Feature 4, and duplicating any of them would create a second path to
 * the values every business rule reads.
 *
 * ## What this layer actually adds
 *
 * 1. **An admin actor.** The service takes a `ConfigActor`; the HTTP layer
 *    knows who is calling.
 * 2. **The `admin_audit_log` entry.** `configuration_history` is the per-key
 *    timeline and captures migrations and scripts too; the audit log is the
 *    per-admin index (DATABASE.md §3.7 keeps them separate deliberately, and
 *    `ADMIN_ACTIONS.CONFIGURATION_CHANGED` has existed unused since Feature 3).
 * 3. **The transaction that holds both.** §3.7: an audit entry written after
 *    the action it records can be lost exactly when it matters.
 * 4. **Cache invalidation after the commit** — see D51. This is the one piece
 *    of ordering the layer is responsible for getting right.
 */
@Injectable()
export class AdminConfigurationService {
  private readonly logger = new Logger(AdminConfigurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
    private readonly providers: ProvidersService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * Every registered key, with the value in force at GLOBAL scope.
   *
   * Reads the registry rather than the table: a key with nothing stored is
   * still a key an admin can set, and listing only stored rows would hide
   * exactly the settings nobody has touched yet.
   */
  async list(query: AdminListConfigurationQuery): Promise<AdminConfigurationKeyList> {
    const counts = await this.configuration.overrideCounts();

    const definitions = this.configuration
      .definitionsList()
      .filter((definition) => matchesSearch(definition, query.search))
      // Anything stored at any scope: a key with only a provider override has
      // been changed by somebody, and hiding it would answer "what has anybody
      // changed" with a list that omits exactly that.
      .filter((definition) => !query.overriddenOnly || (counts.get(definition.key)?.stored ?? 0) > 0)
      .sort((a, b) => a.key.localeCompare(b.key));

    const items = await Promise.all(
      definitions.map((definition) => this.toSummary(definition, counts)),
    );

    return { items, total: items.length };
  }

  /**
   * One key in full: its definition, every explicit setting, and its timeline.
   *
   * `scopeId` asks the effective-value question for a particular provider —
   * §4.9's *"configuration nobody can read confidently is configuration nobody
   * will change safely"*. Without it an admin editing a provider override has
   * to work out the chain in their head.
   */
  async detail(key: string, scopeId?: string): Promise<AdminConfigurationKeyDetail> {
    const definition = this.requireDefinition(key);
    const counts = await this.configuration.overrideCounts();

    const [summary, stored, history] = await Promise.all([
      this.toSummary(definition, counts),
      this.configuration.storedValues(key),
      this.configuration.history(key, { limit: 50 }),
    ]);

    const resolved =
      scopeId === undefined
        ? null
        : await this.configuration.resolve(key, scopeId).then((result) => ({
            scopeId,
            value: result.value,
            source: result.source,
          }));

    return {
      ...summary,
      overrides: stored.map(toOverride),
      history: history.map(toHistoryEntry),
      resolvedForScope: resolved,
    };
  }

  /**
   * Writes a value.
   *
   * The write, its history row and the audit entry commit together; the cache
   * is dropped afterwards. Validation, scope checking and the history row all
   * belong to `ConfigurationService` and are not repeated here — a second
   * validator would be a second opinion about what a valid reward rate is.
   */
  async set(
    key: string,
    value: unknown,
    options: {
      scope?: ConfigScopeName;
      scopeId?: string;
      reason: string;
      /** See `assertNotStale`. Omitted means an unconditional write. */
      expectedUpdatedAt?: string | null;
    },
    context: AdminActionContext,
  ): Promise<AdminConfigurationKeyDetail> {
    /*
     * Checked here so that an unknown key is a 404 on every verb.
     *
     * `ConfigurationService` also refuses it — as a 422, which is right for a
     * service call where the key is an argument. On this surface the key is
     * the URL, and `GET /admin/configuration/invented.key` answering 404 while
     * `PUT` on the same URL answers 422 would be two answers about one
     * resource. Not a second validator: the same registry lookup, given the
     * status its own surface implies.
     */
    this.requireDefinition(key);

    const scope = (options.scope ?? CONFIG_SCOPES.GLOBAL) as ConfigScope;
    await this.assertScopeTargetExists(key, scope, options.scopeId);

    const written = await this.prisma.$transaction(async (tx) => {
      // Before the write and inside its transaction, so the check and the
      // write cannot be separated by another writer.
      await this.assertNotStale(tx, key, scope, scopeIdFor(scope, options.scopeId), options.expectedUpdatedAt);

      const result = await this.configuration.set(
        key,
        value,
        {
          scope,
          scopeId: options.scopeId ?? null,
          reason: options.reason,
          actor: { type: 'admin', id: context.adminId },
        },
        tx,
      );

      await this.audit.record(tx, {
        adminId: context.adminId,
        action: ADMIN_ACTIONS.CONFIGURATION_CHANGED,
        targetType: 'configuration',
        /*
         * The key plus its scope, not the row id. An admin asking "who changed
         * the hold period for this provider?" knows the key and the provider;
         * they have never seen the primary key of a row that may not have
         * existed before the change.
         */
        targetId: auditTargetId(key, result.scope, result.scopeId),
        before: { value: result.previousValue },
        after: { value: result.value },
        reason: options.reason,
        ip: context.ip,
      });

      return result;
    });

    /*
     * After the commit, never inside it (D51). The value is only visible to
     * other connections now, so this is the first moment a re-read — this
     * process's own, or another process's in response to the broadcast — is
     * guaranteed to see it.
     */
    await this.configuration.invalidateAndBroadcast(
      written.key,
      written.scope,
      written.scopeId,
    );

    this.logger.log(
      {
        key,
        scope: written.scope,
        scopeId: written.scopeId,
        adminId: context.adminId,
      },
      'Configuration changed by an admin',
    );

    return this.detail(key, scope === CONFIG_SCOPES.PROVIDER ? options.scopeId : undefined);
  }

  /**
   * Refuses a write whose caller read a different value — TODO T88.
   *
   * A configuration change alters economics with no deployment behind it, and
   * `PUT`/`reset` are read-modify-write from a screen: an administrator loads a
   * key, thinks, and submits. Another administrator can change the same key in
   * between, and without this the second submission wins silently — the first
   * change is gone, the timeline records both, and neither operator is told.
   *
   * ## The token is `updated_at`, which already existed
   *
   * `ConfigurationValue.updatedAt` is `@updatedAt`, so Postgres moves it on
   * every write and `ConfigurationOverride.updatedAt` has always carried it to
   * the client. No column was added and there is no version number to keep in
   * step with the value it describes.
   *
   * ## `null` is a state, not "no opinion"
   *
   * "I read a key with nothing stored" is a real thing to have read, and the
   * first write against a defaulted key is a decision (§4.9). Two
   * administrators making it at once is exactly the case worth catching, so
   * `null` asserts absence — while **omitting** the field asks for no check at
   * all, which is what a seed script wants.
   *
   * ## Why the row is locked
   *
   * `SELECT … FOR UPDATE` inside the caller's transaction, which is the same
   * mechanism `assertTransition` and `resolveHold` already use for "two admins
   * in the same second". Without it this is a check-then-act: both writers read
   * the same `updated_at`, both pass, and both upsert.
   *
   * The lock is held for the length of one write transaction, never across an
   * operator's thinking time — the precondition is what covers that, and it is
   * the optimistic half. When no row exists there is nothing to lock, so two
   * first-writes are serialised by the unique index on
   * `(key, scope_type, scope_id)` instead: one inserts, and the other finds a
   * row where it asserted absence.
   */
  private async assertNotStale(
    tx: PrismaTransactionClient,
    key: string,
    scope: ConfigScope,
    scopeId: string,
    expectedUpdatedAt: string | null | undefined,
  ): Promise<void> {
    if (expectedUpdatedAt === undefined) return;

    const rows = await tx.$queryRaw<{ updated_at: Date }[]>`
      SELECT updated_at FROM configuration_values
       WHERE key = ${key}
         AND scope_type = ${scope}::config_scope_type
         AND scope_id = ${scopeId}
       FOR UPDATE`;

    const current = rows[0]?.updated_at?.toISOString() ?? null;

    if (current === expectedUpdatedAt) return;

    throw new DomainError(
      ERROR_CODES.CONFIG_STALE_WRITE,
      current === null
        ? 'This setting was reset by someone else while you were editing it. Reload the page to see the value in force.'
        : 'This setting was changed by someone else while you were editing it. Reload the page to see the value in force.',
      409,
      { key, scope, scopeId, expectedUpdatedAt: expectedUpdatedAt ?? null, currentUpdatedAt: current },
    );
  }

  /**
   * Removes an explicit setting, returning the key to its resolution chain.
   *
   * A no-op when nothing was stored — and deliberately not an error, because
   * "use the default" is already true and failing would make the reset button
   * depend on a state the admin cannot see. Nothing is audited in that case:
   * an audit entry for a change that did not happen is noise in the one log
   * that must stay readable.
   */
  async reset(
    key: string,
    options: {
      scope?: ConfigScopeName;
      scopeId?: string;
      reason: string;
      /** See `assertNotStale`. Omitted means an unconditional reset. */
      expectedUpdatedAt?: string | null;
    },
    context: AdminActionContext,
  ): Promise<AdminConfigurationKeyDetail> {
    this.requireDefinition(key);

    const scope = (options.scope ?? CONFIG_SCOPES.GLOBAL) as ConfigScope;
    await this.assertScopeTargetExists(key, scope, options.scopeId);

    const written = await this.prisma.$transaction(async (tx) => {
      await this.assertNotStale(tx, key, scope, scopeIdFor(scope, options.scopeId), options.expectedUpdatedAt);

      const result = await this.configuration.unset(
        key,
        {
          scope,
          scopeId: options.scopeId ?? null,
          reason: options.reason,
          actor: { type: 'admin', id: context.adminId },
        },
        tx,
      );

      if (result) {
        await this.audit.record(tx, {
          adminId: context.adminId,
          action: ADMIN_ACTIONS.CONFIGURATION_CHANGED,
          targetType: 'configuration',
          targetId: auditTargetId(key, result.scope, result.scopeId),
          before: { value: result.previousValue },
          // Null, not the default it will now resolve to. The record is of
          // what was removed, and the default is not a stored fact.
          after: { value: null },
          reason: options.reason,
          ip: context.ip,
        });
      }

      return result;
    });

    if (written) {
      await this.configuration.invalidateAndBroadcast(
        written.key,
        written.scope,
        written.scopeId,
      );

      this.logger.log(
        { key, scope: written.scope, scopeId: written.scopeId, adminId: context.adminId },
        'Configuration override removed by an admin',
      );
    }

    return this.detail(key, scope === CONFIG_SCOPES.PROVIDER ? options.scopeId : undefined);
  }

  /** A key's timeline on its own, for a screen that only wants the history. */
  async history(
    key: string,
    options: { limit?: number; scope?: ConfigScopeName; scopeId?: string },
  ): Promise<ConfigurationHistoryEntry[]> {
    this.requireDefinition(key);

    const rows = await this.configuration.history(key, {
      limit: options.limit,
      scope: options.scope as ConfigScope | undefined,
      scopeId: options.scopeId,
    });

    return rows.map(toHistoryEntry);
  }

  // --- Internals ------------------------------------------------------------

  private requireDefinition(key: string): ConfigurationKeyDefinition {
    const definition = this.configuration.getDefinition(key);

    if (!definition) {
      /*
       * §5.2's boundary, enforced at the edge. A caller cannot invent a key:
       * the store is typed because every key is declared by the module that
       * owns the rule, and an admin API that accepted arbitrary keys would
       * turn it back into a settings bag.
       */
      throw new DomainError(
        ERROR_CODES.CONFIG_UNKNOWN_KEY,
        `Unknown configuration key "${key}"`,
        404,
        { key },
      );
    }

    return definition;
  }

  /**
   * A PROVIDER-scoped value must name a provider that exists.
   *
   * `ConfigurationService` checks that the *scope* is permitted for the key; it
   * has no idea what a provider is and should not. Without this check a typo
   * writes a row that resolves for nobody — an override that silently never
   * applies, which looks identical to one that does.
   */
  private async assertScopeTargetExists(
    key: string,
    scope: ConfigScope,
    scopeId: string | undefined,
  ): Promise<void> {
    if (scope !== CONFIG_SCOPES.PROVIDER) {
      if (scopeId) {
        throw new ValidationError(
          'A scope id is only meaningful at PROVIDER scope',
          [{ field: 'scopeId', message: 'must be omitted for GLOBAL scope' }],
          { key, scope },
        );
      }

      return;
    }

    if (!scopeId) {
      throw new ValidationError(
        'A provider must be named when setting a value at PROVIDER scope',
        [{ field: 'scopeId', message: 'is required for PROVIDER scope' }],
        { key },
      );
    }

    const provider = await this.providers.findById(scopeId);

    if (!provider) {
      throw new DomainError(
        ERROR_CODES.PROVIDER_NOT_FOUND,
        'No provider with that id',
        404,
        { scopeId },
      );
    }
  }

  private async toSummary(
    definition: ConfigurationKeyDefinition,
    counts: Map<string, ConfigurationRowCounts>,
  ): Promise<AdminConfigurationKeySummary> {
    const effective = await this.configuration.resolve(definition.key);

    return {
      key: definition.key,
      description: definition.description,
      valueType: definition.valueType,
      scopes: definition.scopes as ConfigScopeName[],
      defaultValue: definition.defaultValue,
      effectiveValue: effective.value,
      source: effective.source,
      // Provider rows only — the contract says "provider-scoped overrides",
      // and the screen turns this into "N providers have their own value".
      overrideCount: counts.get(definition.key)?.provider ?? 0,
    };
  }
}

function matchesSearch(definition: ConfigurationKeyDefinition, search?: string): boolean {
  if (!search) return true;

  const needle = search.trim().toLowerCase();

  // The description too — an admin looking for "hold period" should not have
  // to know it is spelled `rewards.hold_period_days`.
  return (
    definition.key.toLowerCase().includes(needle) ||
    definition.description.toLowerCase().includes(needle)
  );
}

/**
 * The scope id as the table stores it.
 *
 * GLOBAL rows use the empty-string sentinel rather than null, because in
 * PostgreSQL two NULLs are never equal and a nullable column would let one key
 * hold unlimited GLOBAL rows (see the schema comment on
 * `ConfigurationValue.scopeId`). The precondition query has to match on the
 * same value the write will, or it would look for a row that is there under a
 * different key.
 */
function scopeIdFor(scope: ConfigScope, scopeId: string | undefined): string {
  return scope === 'GLOBAL' ? GLOBAL_SCOPE_ID : (scopeId ?? '');
}

function auditTargetId(key: string, scope: ConfigScope, scopeId: string): string {
  return scopeId === GLOBAL_SCOPE_ID ? `${key}@${scope}` : `${key}@${scope}:${scopeId}`;
}

function toOverride(row: {
  scope: ConfigScope;
  scopeId: string;
  value: unknown;
  valid: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}): ConfigurationOverride {
  return {
    scope: row.scope as ConfigScopeName,
    scopeId: row.scopeId,
    value: row.value,
    valid: row.valid,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const __testing = { matchesSearch, auditTargetId };

function toHistoryEntry(row: ConfigurationHistoryRecord): ConfigurationHistoryEntry {
  return {
    scope: row.scope as ConfigScopeName,
    scopeId: row.scopeId,
    oldValue: row.oldValue,
    newValue: row.newValue,
    actorType: row.actorType,
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
