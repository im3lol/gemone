import { describe, expect, it, vi } from 'vitest';

import { HealthService } from './health.service';
import type { ReadinessCheck } from './readiness-check';

function check(name: string, result: boolean | Error, delayMs = 0): ReadinessCheck {
  return {
    name,
    isReady: vi.fn(async () => {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

function serviceWith(...checks: ReadinessCheck[]): HealthService {
  const service = new HealthService();
  checks.forEach((c) => service.register(c));
  return service;
}

describe('HealthService', () => {
  describe('liveness', () => {
    it('checks nothing external — that is the whole point', () => {
      const dependency = check('postgres', false);
      const service = serviceWith(dependency);

      expect(service.isAlive()).toBe(true);
      expect(dependency.isReady).not.toHaveBeenCalled();
    });
  });

  describe('registration', () => {
    it('starts empty and knows nothing about any dependency', () => {
      expect(new HealthService().registeredChecks()).toEqual([]);
    });

    it('records each registered dependency by name', () => {
      const service = serviceWith(check('postgres', true), check('redis', true));

      expect(service.registeredChecks()).toEqual(['postgres', 'redis']);
    });

    it('ignores a repeat registration of the same dependency', () => {
      const service = serviceWith(check('postgres', true), check('postgres', false));

      // Module re-initialisation happens in tests and on hot reload. A second
      // registration must not double-count the dependency.
      expect(service.registeredChecks()).toEqual(['postgres']);
    });
  });

  describe('readiness', () => {
    it('is ready when nothing is registered', async () => {
      await expect(new HealthService().isReady()).resolves.toBe(true);
    });

    it('is ready when every dependency is reachable', async () => {
      const service = serviceWith(check('postgres', true), check('redis', true));

      await expect(service.isReady()).resolves.toBe(true);
    });

    it('is not ready when any single dependency is unreachable', async () => {
      const service = serviceWith(check('postgres', true), check('redis', false));

      await expect(service.isReady()).resolves.toBe(false);
    });

    it('treats a throwing check as not ready rather than letting it 500', async () => {
      const service = serviceWith(check('postgres', new Error('ECONNREFUSED')));

      await expect(service.isReady()).resolves.toBe(false);
    });

    it('still evaluates the others when one check throws', async () => {
      const redis = check('redis', true);
      const service = serviceWith(check('postgres', new Error('boom')), redis);

      await expect(service.isReady()).resolves.toBe(false);
      expect(redis.isReady).toHaveBeenCalled();
    });

    it('re-evaluates on every call rather than caching a past answer', async () => {
      const dependency = check('postgres', true);
      const service = serviceWith(dependency);

      await service.isReady();
      await service.isReady();

      expect(dependency.isReady).toHaveBeenCalledTimes(2);
    });

    it('runs checks concurrently, not in series', async () => {
      const service = serviceWith(
        check('a', true, 60),
        check('b', true, 60),
        check('c', true, 60),
      );

      const started = Date.now();
      await service.isReady();
      const elapsed = Date.now() - started;

      // Serial execution would take ~180ms. Allow generous headroom for a
      // loaded CI machine while still failing if the calls are sequential.
      expect(elapsed).toBeLessThan(150);
    });
  });
});
