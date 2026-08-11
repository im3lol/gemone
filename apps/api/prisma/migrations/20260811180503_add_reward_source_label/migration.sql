-- Names the source of a reward movement, in the words the user was shown.
--
-- Additive and nullable: every existing row keeps a NULL, which is exactly
-- what it means — those movements were written before anything recorded a
-- name, and the system has no way to recover one for them. Backfilling from
-- `offers.title` would print today's catalog title on a line describing money
-- that moved months ago, which is the mistake this column exists to avoid.

-- AlterTable
ALTER TABLE "reward_transactions" ADD COLUMN     "source_label" TEXT;
