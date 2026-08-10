import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration — used by `migrate`, `db` and `studio`.
 *
 * Prisma 7 no longer reads `.env` automatically and no longer accepts a `url`
 * in schema.prisma, so the connection string for migration commands is
 * resolved here. The runtime client does not use this file at all; it gets its
 * connection through a driver adapter (see core/database/database.module.ts).
 *
 * `.env` is loaded explicitly rather than implicitly, so a developer running a
 * migration against the wrong database has to have done something visible.
 */
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: ['.env.local', '.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
  },

  datasource: {
    // Deliberately not defaulted. A missing DATABASE_URL must fail loudly at
    // the CLI rather than silently target localhost — running a migration
    // against an unintended database is not a recoverable mistake.
    url: process.env.DATABASE_URL,
  },
});
