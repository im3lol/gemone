-- Baseline migration. Intentionally creates no tables.
--
-- Applying it establishes Prisma's `_prisma_migrations` bookkeeping table and
-- proves the migration pipeline works end to end before any schema depends on
-- it. Business tables arrive with the features that own them (DATABASE.md
-- §11), so that a table and the service allowed to touch it land together.
--
-- No extensions are enabled here on purpose: primary keys are
-- application-generated UUIDv7 (DATABASE.md §6), so pgcrypto/uuid-ossp are
-- not needed, and enabling an extension "just in case" is exactly the
-- speculative work P6 rejects.

SELECT 1;
