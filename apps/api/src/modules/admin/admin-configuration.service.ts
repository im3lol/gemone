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
} from '../../core/config/configuration.service';
import { PrismaService } from '../../core/database/prisma.service';
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
      .filter((definition) => !query.overriddenOnly || (counts.get(definition.key) ?? 0) > 0)
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
    options: { scope?: ConfigScopeName; scopeId?: string; reason: string },
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
    options: { scope?: ConfigScopeName; scopeId?: string; reason: string },
    context: AdminActionContext,
  ): Promise<AdminConfigurationKeyDetail> {
    this.requireDefinition(key);

    const scope = (options.scope ?? CONFIG_SCOPES.GLOBAL) as ConfigScope;
    await this.assertScopeTargetExists(key, scope, options.scopeId);

    const written = await this.prisma.$transaction(async (tx) => {
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
    counts: Map<string, number>,
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
      overrideCount: counts.get(definition.key) ?? 0,
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
