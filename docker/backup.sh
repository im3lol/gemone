#!/bin/sh
#
# Nightly PostgreSQL backup — ARCHITECTURE.md §20.3.
#
# Runs in the `postgres:17-alpine` image, so `pg_dump` is exactly the version
# that wrote the data. A dump taken by an older client against a newer server is
# refused outright, and one taken by a newer client can contain syntax the
# server cannot read back — sharing the image removes the question.
#
# ## What this protects against, and what it does not
#
# It protects against the failures that actually happen: a bad migration, a
# DELETE without a WHERE, an application bug that corrupts rows, a dropped
# table. All of those are recovered from a dump on this host.
#
# It does **not** protect against losing the host. §20.3 is explicit that a
# backup on the same machine is not a backup, and shipping these files off the
# VPS is the other half — `backup-remote.sh`, which watches this volume and
# encrypts, uploads and verifies what appears in it. Nothing here does that.
#
# Note that `prune` below deletes by age alone: it does not ask whether a dump
# was ever shipped. A dump that failed to upload is therefore removed after
# `BACKUP_KEEP_DAILY_DAYS`, by which point the remote health check will have
# been reporting unhealthy for a month (T72).
#
# ## Why a loop and not cron
#
# One process, one log stream, and the schedule is arithmetic anyone can read.
# `crond` would mean a crontab file, a second place for the schedule to live,
# and its output going somewhere other than this container's stdout.

set -u

# This script takes no arguments, and being handed one means somebody typed
# `run --rm backup /usr/local/bin/restore.sh …` — forgetting `--entrypoint sh`.
# Silently ignoring it starts a backup and then sleeps until 02:00, so the
# operator watches a restore that is not happening. Say so instead.
if [ $# -gt 0 ]; then
  echo "backup.sh takes no arguments (given: $*)." >&2
  echo "To restore:  run --rm --entrypoint sh backup /usr/local/bin/restore.sh <dump> <database>" >&2
  exit 2
fi

DIR=${BACKUP_DIR:-/backups}
AT=${BACKUP_AT_UTC:-02:00}
KEEP_DAILY_DAYS=${BACKUP_KEEP_DAILY_DAYS:-30}
KEEP_WEEKLY_DAYS=${BACKUP_KEEP_WEEKLY_DAYS:-90}

# JSON to stdout, like every other process here (§16.1), so one log pipeline
# reads the application and its backups without a second format.
log() {
  level=$1
  msg=$2
  extra=${3:-}
  printf '{"level":"%s","service":"backup","time":"%s","msg":"%s"%s}\n' \
    "$level" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" "$extra"
}

seconds_into_day() {
  # Leading zeros must go: `08` is not a valid number in shell arithmetic, and
  # the failure would be a crash at 08:00 and 09:00 and nowhere else.
  h=$1
  m=$2
  h=${h#0}
  m=${m#0}
  echo $(( ${h:-0} * 3600 + ${m:-0} * 60 ))
}

backup_once() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  target="$DIR/daily/gemone-$stamp.dump"
  started=$(date -u +%s)

  # Written aside and moved into place. `mv` within one filesystem is atomic, so
  # a dump interrupted half-way — the container stopped, the disk filled — never
  # leaves a file that looks complete to the retention sweep or to an operator
  # reaching for the newest one in an emergency.
  if ! pg_dump --format=custom --compress=6 --file="$target.partial" 2>/tmp/backup.err; then
    log error "Backup failed" ",\"err\":\"$(tr -d '"\n' </tmp/backup.err | tail -c 300)\""
    rm -f "$target.partial"
    return 1
  fi

  mv "$target.partial" "$target"

  # An unreadable archive is worse than no archive: it is a recovery plan that
  # only fails on the day it is needed. Reading the table of contents back costs
  # milliseconds and proves the file is a dump rather than a truncated one.
  if ! pg_restore --list "$target" >/dev/null 2>/tmp/backup.err; then
    log error "Backup is unreadable and was discarded" ",\"file\":\"$target\""
    rm -f "$target"
    return 1
  fi

  size=$(wc -c <"$target" | tr -d ' ')
  elapsed=$(( $(date -u +%s) - started ))

  # Sunday's dump is also linked into `weekly/`, which is what makes the two
  # retention windows §20.3 asks for two `find` commands instead of date
  # arithmetic over filenames. A hard link costs no space, and deleting the
  # daily copy leaves the weekly one intact.
  if [ "$(date -u +%u)" = "7" ]; then
    ln "$target" "$DIR/weekly/gemone-$stamp.dump" 2>/dev/null ||
      cp "$target" "$DIR/weekly/gemone-$stamp.dump"
  fi

  log info "Backup complete" ",\"file\":\"$target\",\"bytes\":$size,\"seconds\":$elapsed"
}

prune() {
  daily=$(find "$DIR/daily" -name 'gemone-*.dump' -mtime "+$KEEP_DAILY_DAYS" -print -delete | wc -l)
  weekly=$(find "$DIR/weekly" -name 'gemone-*.dump' -mtime "+$KEEP_WEEKLY_DAYS" -print -delete | wc -l)

  kept_daily=$(find "$DIR/daily" -name 'gemone-*.dump' | wc -l)
  kept_weekly=$(find "$DIR/weekly" -name 'gemone-*.dump' | wc -l)

  log info "Retention applied" \
    ",\"removed_daily\":$daily,\"removed_weekly\":$weekly,\"kept_daily\":$kept_daily,\"kept_weekly\":$kept_weekly"
}

mkdir -p "$DIR/daily" "$DIR/weekly"

log info "Backup service started" \
  ",\"at_utc\":\"$AT\",\"keep_daily_days\":$KEEP_DAILY_DAYS,\"keep_weekly_days\":$KEEP_WEEKLY_DAYS"

# One immediately, before waiting for the hour. A deployment that came up at
# 02:01 would otherwise hold no backup at all for its first day, which is
# precisely the day a new deployment is most likely to need one.
backup_once
prune

while true; do
  now=$(seconds_into_day "$(date -u +%H)" "$(date -u +%M)")
  at=$(seconds_into_day "${AT%%:*}" "${AT##*:}")

  delta=$(( at - now ))
  [ "$delta" -le 0 ] && delta=$(( delta + 86400 ))

  sleep "$delta"

  # Failure is logged and the loop continues rather than exiting. Exiting would
  # crash-loop the container against a database that is briefly unavailable; the
  # health check notices a stale backup either way, and `autoheal` restarts this
  # container, which retries immediately.
  backup_once
  prune
done
