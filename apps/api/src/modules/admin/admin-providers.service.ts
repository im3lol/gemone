import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_ACTIONS,
  type CreateProviderRequest,
  type ListProvidersQuery,
  type ProviderCapabilityReport,
  type ProviderSummary,
  type UpdateProviderRequest,
} from '@gemone/contracts';

import { PrismaService } from '../../core/database/prisma.service';
import { ProviderHealthService } from '../providers/provider-health.service';
import { ProvidersService } from '../providers/providers.service';
import { ProviderRegistry } from '../providers/registry/provider-registry';
import { AdminAuditService } from './admin-audit.service';
import type { AdminActionContext } from './admin-users.service';

/**
 * Administrative operations on providers.
 *
 * A composition layer (ARCHITECTURE.md §4.3), and it holds no provider logic
 * of its own: `ProvidersService` decides what a valid provider is,
 * `ProviderRegistry` decides what the running build can serve,
 * `ProviderHealthService` owns health, and this shapes the result and records
 * who did it.
 *
 * The `providers` module has no HTTP surface (§4). That is not an oversight —
 * an admin panel that grows its own implementation of the same rules is how
 * the two paths drift, and the admin path is the one that is wrong.
 */
@Injectable()
export class AdminProvidersService {
  private readonly logger = new Logger(AdminProvidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly registry: ProviderRegistry,
    private readonly health: ProviderHealthService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: ListProvidersQuery): Promise<{ items: ProviderSummary[] }> {
    const rows = await this.providers.findAll(query);
    return { items: rows.map((row) => this.providers.toSummary(row)) };
  }

  async get(id: string): Promise<ProviderSummary> {
    return this.providers.toSummary(await this.providers.requireById(id));
  }

  /**
   * Capability discovery for the admin panel — what this *build* can support,
   * whether or not a row exists for it.
   *
   * The screen someone uses before adding a provider: which slugs are
   * available, what each can do, and which environment variables are still
   * unset. Without it, adding a provider means reading the source to find the
   * adapter map.
   */
  describeAdapters(): { items: ProviderCapabilityReport[] } {
    return { items: this.registry.describeAdapters() };
  }

  async create(
    input: CreateProviderRequest,
    context: AdminActionContext,
  ): Promise<ProviderSummary> {
    const created = await this.prisma.$transaction(async (tx) => {
      const provider = await this.providers.create(input, tx);

      await this.audit.record(tx, {
        adminId: context.adminId,
        action: ADMIN_ACTIONS.PROVIDER_CREATED,
        targetType: 'provider',
        targetId: provider.id,
        after: { slug: provider.slug, displayName: provider.displayName },
        ip: context.ip ?? null,
      });

      return provider;
    });

    // After the commit, never inside it. A reload inside a transaction that
    // then rolled back would leave the registry serving a provider the
    // database does not have — and since §14.3, would invite every other
    // process to load the same phantom.
    await this.providers.reloadAndBroadcast();

    return this.providers.toSummary(created);
  }

  async update(
    id: string,
    changes: UpdateProviderRequest,
    context: AdminActionContext,
  ): Promise<ProviderSummary> {
    const before = await this.providers.requireById(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const provider = await this.providers.update(id, changes, tx);

      await this.audit.record(tx, {
        adminId: context.adminId,
        action: ADMIN_ACTIONS.PROVIDER_UPDATED,
        targetType: 'provider',
        targetId: id,
        before: {
          displayName: before.displayName,
          syncIntervalMinutes: before.syncIntervalMinutes,
          postbackIpRanges: before.postbackIpRanges,
        },
        after: {
          displayName: provider.displayName,
          syncIntervalMinutes: provider.syncIntervalMinutes,
          postbackIpRanges: provider.postbackIpRanges,
        },
        ip: context.ip ?? null,
      });

      return provider;
    });

    await this.providers.reloadAndBroadcast();

    return this.providers.toSummary(updated);
  }

  /**
   * The switch, and the record of who flipped it.
   *
   * Both in one transaction (DATABASE.md §10.1). Partial completion is the
   * failure that matters: a provider cut off with no audit entry is a
   * platform that stopped paying out through a network, with nothing to
   * explain why — and that question arrives from the provider, not from us.
   */
  async setEnabled(
    id: string,
    enabled: boolean,
    reason: string,
    context: AdminActionContext,
  ): Promise<ProviderSummary> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const provider = await this.providers.setEnabled(id, enabled, tx);

      await this.audit.record(tx, {
        adminId: context.adminId,
        action: enabled ? ADMIN_ACTIONS.PROVIDER_ENABLED : ADMIN_ACTIONS.PROVIDER_DISABLED,
        targetType: 'provider',
        targetId: id,
        before: { isEnabled: !enabled },
        after: { isEnabled: enabled },
        reason,
        ip: context.ip ?? null,
      });

      return provider;
    });

    await this.providers.reloadAndBroadcast();

    this.logger.warn(
      { adminId: context.adminId, providerId: id, slug: updated.slug, enabled },
      'Admin changed provider enabled state',
    );

    return this.providers.toSummary(updated);
  }

  /**
   * Clears a provider's failure streak.
   *
   * The operational counterpart to health being recorded rather than probed:
   * when a provider confirms their side is fixed, an operator should not have
   * to wait for the next scheduled sync to find out.
   */
  async resetHealth(
    id: string,
    reason: string,
    context: AdminActionContext,
  ): Promise<ProviderSummary> {
    const before = await this.providers.requireById(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const provider = await this.health.reset(id, tx);

      await this.audit.record(tx, {
        adminId: context.adminId,
        action: ADMIN_ACTIONS.PROVIDER_HEALTH_RESET,
        targetType: 'provider',
        targetId: id,
        before: {
          healthState: before.healthState,
          consecutiveFailureCount: before.consecutiveFailureCount,
        },
        after: { healthState: provider.healthState, consecutiveFailureCount: 0 },
        reason,
        ip: context.ip ?? null,
      });

      return provider;
    });

    return this.providers.toSummary(updated);
  }
}
