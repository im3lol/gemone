import { Inject, Injectable } from '@nestjs/common';
import type { AdminAction, AuditLogEntry, Paginated } from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { CLOCK, type Clock } from '../../core/time/clock';
import { Prisma } from '../../generated/prisma/client';

export interface AuditEntryInput {
  adminId: string;
  action: AdminAction;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

export interface AuditQuery {
  adminId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

/**
 * The immutable record of every administrative action — DATABASE.md §3.7.
 *
 * Rows are never updated or deleted (§7.1). "Who approved this payout and
 * why" is a question asked months later, usually about a dispute, and logs
 * will have rotated by then — which is why this is a table and not a log
 * stream (§16.5).
 */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Records an action.
   *
   * Takes the transaction client explicitly, because the entry must be
   * written inside the same transaction as the action it records
   * (DATABASE.md §10.2, rule 5). An audit entry written afterwards is missing
   * in exactly the situation an audit trail exists for: the action succeeded
   * and the audit write then failed.
   *
   * Passing the client rather than resolving an ambient one makes that
   * requirement visible at the call site.
   */
  async record(
    client: PrismaTransactionClient | PrismaService,
    entry: AuditEntryInput,
  ): Promise<void> {
    await client.adminAuditLog.create({
      data: {
        id: uuidv7(),
        adminId: entry.adminId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason ?? null,
        ip: entry.ip ?? null,
        createdAt: this.clock.now(),
      },
    });
  }

  async find(query: AuditQuery): Promise<Paginated<AuditLogEntry>> {
    const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
    const offset = Math.max(0, query.offset ?? 0);

    const where = {
      ...(query.adminId ? { adminId: query.adminId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.action ? { action: query.action } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        adminId: row.adminId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        before: row.before,
        after: row.after,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  }
}

/**
 * Prisma distinguishes "JSON null" from "SQL NULL" and rejects a bare
 * `undefined`. `DbNull` writes an actual SQL NULL, which is what "this action
 * had no prior state" means — as opposed to a JSON `null` value, which would
 * read as "the prior state was null".
 */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);
}
