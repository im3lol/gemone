import { Redis } from 'ioredis';

import { loadDotenvForDevelopment } from './core/config/load-dotenv';
import { WORKER_HEARTBEAT_KEY } from './jobs/worker-heartbeat.service';

/**
 * The worker's health check — ARCHITECTURE.md §17.2.
 *
 * Run by the container runtime, not by the application: it exits 0 while the
 * worker is writing its heartbeat and 1 once that key has expired. Deliberately
 * a standalone script rather than an HTTP endpoint, because giving the worker a
 * port to answer on would make it a second web-facing process to secure, for
 * one boolean.
 *
 * It builds no Nest context. A check that boots the application would take
 * seconds, hold connections, and fail for reasons that have nothing to do with
 * the thing it is checking.
 */
async function main(): Promise<void> {
  loadDotenvForDevelopment();

  const url = process.env.REDIS_URL;
  if (!url) {
    console.error('REDIS_URL is not set');
    process.exit(1);
  }

  const redis = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const beat = await redis.get(WORKER_HEARTBEAT_KEY);

    if (!beat) {
      // Either the worker never started, or it stopped writing long enough ago
      // for the key to expire. Both mean nothing is consuming the queues.
      console.error('No worker heartbeat');
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

void main();
