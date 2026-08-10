import { Logger } from '@nestjs/common';

/**
 * Loads `.env` into `process.env` for local development.
 *
 * Without this the two halves of the system disagree about where local
 * configuration lives: the Prisma CLI reads `apps/api/.env` (via
 * prisma.config.ts), so a developer sets DATABASE_URL there to run a
 * migration — and then `nest start` cannot see it. One file, both consumers.
 *
 * Uses Node's built-in `process.loadEnvFile` rather than the `dotenv` package,
 * so nothing is added to the runtime dependency tree for a development-only
 * convenience (P4, P6).
 *
 * Never runs in production. Production configuration comes from the container
 * environment (ARCHITECTURE.md §19.4), and silently reading a stray `.env`
 * file off a production disk is how a process ends up pointed at the wrong
 * database.
 *
 * Real environment variables win: `loadEnvFile` does not overwrite what is
 * already set, so `DATABASE_URL=... node dist/main.js` behaves as expected.
 */
export function loadDotenvForDevelopment(path = '.env'): void {
  if (process.env.NODE_ENV === 'production') return;

  try {
    process.loadEnvFile(path);
  } catch {
    // No .env file is the normal case in CI and in Docker, where the
    // environment is injected directly. Not an error.
    new Logger('Config').debug(`No ${path} file loaded`);
  }
}
