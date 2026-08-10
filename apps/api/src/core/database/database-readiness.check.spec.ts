import { describe, expect, it, vi } from 'vitest';

import { HealthService } from '../health/health.service';
import { DatabaseReadinessCheck } from './database-readiness.check';
import type { PrismaService } from './prisma.service';

function prismaWith(ping: () => Promise<boolean>): PrismaService {
  return { ping } as unknown as PrismaService;
}

describe('DatabaseReadinessCheck', () => {
  it('identifies itself as postgres, the name that appears in readiness logs', () => {
    const check = new DatabaseReadinessCheck(
      prismaWith(async () => true),
      new HealthService(),
    );

    expect(check.name).toBe('postgres');
  });

  it('registers itself with health on init, so health never learns about databases', () => {
    const health = new HealthService();
    const check = new DatabaseReadinessCheck(prismaWith(async () => true), health);

    expect(health.registeredChecks()).toEqual([]);
    check.onModuleInit();
    expect(health.registeredChecks()).toEqual(['postgres']);
  });

  it('is ready when the database answers', async () => {
    const check = new DatabaseReadinessCheck(
      prismaWith(async () => true),
      new HealthService(),
    );

    await expect(check.isReady()).resolves.toBe(true);
  });

  it('is not ready when the database does not answer', async () => {
    const check = new DatabaseReadinessCheck(
      prismaWith(async () => false),
      new HealthService(),
    );

    await expect(check.isReady()).resolves.toBe(false);
  });

  it('asks the database every time rather than caching a past answer', async () => {
    const ping = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const check = new DatabaseReadinessCheck(prismaWith(ping), new HealthService());

    await check.isReady();
    await check.isReady();

    // A readiness check that answers from a cached result reports healthy
    // through an outage, which is the one moment it exists to catch.
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('reflects a database that goes away between polls', async () => {
    const ping = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const check = new DatabaseReadinessCheck(prismaWith(ping), new HealthService());

    await expect(check.isReady()).resolves.toBe(true);
    await expect(check.isReady()).resolves.toBe(false);
  });

  it('reports through HealthService once registered', async () => {
    const health = new HealthService();
    const check = new DatabaseReadinessCheck(prismaWith(async () => false), health);
    check.onModuleInit();

    // The end-to-end wiring: a failing database must make the endpoint that
    // gates traffic report not-ready.
    await expect(health.isReady()).resolves.toBe(false);
  });
});
