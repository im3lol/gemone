#!/bin/sh
#
# Restore a dump taken by `backup.sh` — ARCHITECTURE.md §20.3.
#
# A script rather than a page of instructions, because §20.3's requirement is
# that a restore is *performed*, and a procedure nobody has executed is a
# hypothesis. This is the thing that gets run in the drill and the thing that
# gets run at 3am; there is no second, hand-typed version to drift from it.
#
#   docker compose -f docker-compose.prod.yml run --rm --entrypoint sh backup \
#     /usr/local/bin/restore.sh /backups/daily/gemone-….dump gemone_check
#
# `--entrypoint sh` is not optional and the reason is worth a line: the service's
# entrypoint is `backup.sh`, so without it the dump path arrives as an argument
# to the *backup* script, which ignores it, takes a backup and sleeps until
# 02:00. Found by running the command this comment used to contain, in an
# emergency rehearsal that would otherwise have been a real emergency —
# `backup.sh` now refuses arguments outright so the mistake announces itself.
#
# Restoring *beside* the live database is the default and the safe order of
# operations: bring up a copy, look at it, and only then decide. Replacing the
# live database is possible and deliberately awkward.

set -u

DUMP=${1:-}
TARGET=${2:-}
MODE=${3:-}

usage() {
  echo "Usage: restore.sh <dump-file> <target-database> [--replace]" >&2
  echo >&2
  echo "  Without --replace the target must not already exist." >&2
  echo "  With --replace the target is DROPPED and recreated." >&2
  exit 2
}

[ -n "$DUMP" ] && [ -n "$TARGET" ] || usage

if [ ! -f "$DUMP" ]; then
  echo "No such dump: $DUMP" >&2
  exit 1
fi

# Read the archive before touching anything. A dump that cannot be listed cannot
# be restored, and finding that out *after* dropping the target is the worst
# possible ordering.
if ! pg_restore --list "$DUMP" >/dev/null 2>&1; then
  echo "Not a readable pg_dump archive: $DUMP" >&2
  exit 1
fi

exists=$(psql --dbname=postgres --tuples-only --no-align \
  --command="select 1 from pg_database where datname = '$TARGET'")

if [ "$exists" = "1" ]; then
  if [ "$MODE" != "--replace" ]; then
    echo "Database '$TARGET' already exists. Restore into a new name, or pass --replace to drop it." >&2
    exit 1
  fi

  echo "Dropping '$TARGET' …" >&2
  # Sessions still attached would make DROP fail, and the caller has already
  # said what they want to happen to this database.
  psql --dbname=postgres --quiet \
    --command="select pg_terminate_backend(pid) from pg_stat_activity where datname = '$TARGET' and pid <> pg_backend_pid()" >/dev/null
  dropdb "$TARGET"
fi

createdb "$TARGET"

started=$(date -u +%s)
echo "Restoring $DUMP into '$TARGET' …" >&2

# `--exit-on-error` so a partial restore is a failure rather than a database
# that is silently missing a constraint nobody looks at until it is violated.
if ! pg_restore --dbname="$TARGET" --exit-on-error "$DUMP"; then
  echo "Restore FAILED. '$TARGET' is incomplete and must not be used." >&2
  exit 1
fi

elapsed=$(( $(date -u +%s) - started ))

tables=$(psql --dbname="$TARGET" --tuples-only --no-align \
  --command="select count(*) from information_schema.tables where table_schema = 'public'")
users=$(psql --dbname="$TARGET" --tuples-only --no-align --command="select count(*) from users")
balances=$(psql --dbname="$TARGET" --tuples-only --no-align \
  --command="select coalesce(sum(pending_points + available_points), 0) from user_balances")

echo "Restored '$TARGET' in ${elapsed}s: ${tables} tables, ${users} users, ${balances} points held." >&2
