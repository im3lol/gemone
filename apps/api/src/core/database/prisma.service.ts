import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env.schema';
import { InfrastructureError } from '../errors/app-error';

/**
 * A Prisma client scoped to an open transaction.
 *
 * Services that must participate in a caller's transaction take this instead
 * of injecting PrismaService. DATABASE.md §10.1 requires several operations —
 * a status change and its audit entry, a configuration write and its history
 * row — to be exactly one transaction, and that is only expressible if the
 * inner call can be handed the outer transaction's client.
 *
 * The alternative, an AsyncLocalStorage-based ambient transaction, hides
 * which calls are transactional. Passing the client makes it visible at the
 * call site, which is where the reader needs to know (P6).
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * The database client, with a managed lifecycle.
 *
 * Extending PrismaClient rather than wrapping it is deliberate: a wrapper
 * would have to re-expose every model delegate by hand, and each new table
 * would mean editing this file. There is no present-tense problem a wrapper
 * solves (P6) — and note that this is NOT the reward-accounting abstraction
 * (P2), which is a separate service that will own balance access on top of
 * this client.
 *
 * ARCHITECTURE.md §3.1: modules use PrismaService directly, restricted to the
 * tables they own. There is no repository layer, because Prisma already is
 * the data-access abstraction and a repository over it would exist only to
 * swap databases — a hypothetical problem.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Tracks whether `$connect` has completed. The readiness check reads it to
   * avoid reporting ready during startup, before the pool exists.
   */
  private connected = false;

  constructor(@Inject(ENV) env: Env) {
    // Prisma 7 connects through a driver adapter rather than a `url` in the
    // schema. The pool is configured here, in one place, instead of being
    // smuggled into the connection string as query parameters where nobody
    // looks for it.
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: env.DATABASE_POOL_MAX,
        connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT * 1000,
      }),
    });
  }

  /**
   * Connects eagerly at startup.
   *
   * Prisma would otherwise connect lazily on the first query, which means an
   * unreachable or misconfigured database surfaces as a failed user request
   * minutes after deploy instead of as a process that refuses to start. The
   * deploy gate (§20.2) can only catch what fails at startup.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.connected = true;
      this.logger.log('Database connection established');
    } catch (error) {
      this.connected = false;
      throw new InfrastructureError('Failed to connect to the database', {
        cause: error,
        retryable: false,
      });
    }
  }

  /**
   * Closes the pool on shutdown.
   *
   * Reached because both entrypoints call `enableShutdownHooks()`. Without a
   * clean disconnect, a rolling deploy leaves connections held until the
   * database times them out, and the replacement process can find the pool
   * exhausted.
   */
  async onModuleDestroy(): Promise<void> {
    this.connected = false;
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /** True once the initial connection has succeeded and before shutdown. */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Round-trips a trivial query to confirm the database is actually
   * answering.
   *
   * `isConnected()` alone is not enough: it reflects what happened at
   * startup, and a database that has since gone away would still report
   * connected. Readiness has to ask.
   */
  async ping(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Database ping failed',
      );
      return false;
    }
  }
}
