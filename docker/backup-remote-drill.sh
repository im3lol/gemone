#!/usr/bin/env bash
#
# Proves the off-host backup path end to end — ARCHITECTURE.md §20.3, T72.
#
# Runs the **production** `backup.sh` and `backup-remote.sh` against a
# disposable S3-compatible server (MinIO) on a throwaway network, and asserts
# the things a disaster would test:
#
#   1. a dump is taken and verified locally
#   2. it is uploaded
#   3. the object exists remotely
#   4. it can be downloaded
#   5. the download is byte-identical, and it is ciphertext in the bucket
#   6. a database restores from the downloaded copy
#   7. remote retention deletes what is past its window and nothing else
#   8. an upload failure leaves the verified local dump untouched, records no
#      receipt, and shows up as unhealthy
#
# **This is not a test of anybody's production storage.** MinIO here is a
# stand-in that speaks the same protocol; it runs on this machine, so nothing
# it proves is evidence that a backup has left a production server. It proves
# the code path is real. Point it at a real endpoint by exporting
# `DRILL_S3_ENDPOINT`, `DRILL_S3_BUCKET`, `DRILL_S3_ACCESS_KEY_ID` and
# `DRILL_S3_SECRET_ACCESS_KEY` before running.
#
#   ./docker/backup-remote-drill.sh
#
# Credentials for the disposable server are generated per run and never
# printed. Nothing here is a secret worth keeping, and nothing here is reused.

set -uo pipefail

PROJECT=gemone-backupdrill
NETWORK="$PROJECT-net"
PASSPHRASE='drill-only-passphrase-at-least-32-characters'
BUCKET=${DRILL_S3_BUCKET:-gemone-backups}
PREFIX=drill
# SigV4 signs the region into the credential scope, so a provider whose region
# is not `us-east-1` rejects every request when this is left at the default.
# Backblaze B2's is in its own endpoint host: s3.<region>.backblazeb2.com.
REGION=${DRILL_S3_REGION:-us-east-1}

pass=0
fail=0

ok() { printf '  \033[32mok\033[0m   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail + 1)); }
step() { printf '\n== %s ==\n' "$1"; }

cleanup() {
  docker rm -f "$PROJECT-minio" "$PROJECT-pg" "$PROJECT-backup" "$PROJECT-remote" >/dev/null 2>&1
  docker volume rm "$PROJECT-data" >/dev/null 2>&1
  docker network rm "$NETWORK" >/dev/null 2>&1
}
trap cleanup EXIT

cleanup
docker network create "$NETWORK" >/dev/null
docker volume create "$PROJECT-data" >/dev/null

REPO=$(cd "$(dirname "$0")/.." && pwd)

# --- the stand-in for object storage ---------------------------------------

if [ -n "${DRILL_S3_ENDPOINT:-}" ]; then
  ENDPOINT=$DRILL_S3_ENDPOINT
  ACCESS_KEY=${DRILL_S3_ACCESS_KEY_ID:?DRILL_S3_ACCESS_KEY_ID is required with DRILL_S3_ENDPOINT}
  SECRET_KEY=${DRILL_S3_SECRET_ACCESS_KEY:?DRILL_S3_SECRET_ACCESS_KEY is required with DRILL_S3_ENDPOINT}
  # A real endpoint is expected to be https, exactly as production requires.
  # The opt-out exists so this branch — the one a real run takes — can itself
  # be exercised against a plaintext endpoint on this machine.
  INSECURE=${DRILL_S3_ALLOW_INSECURE:-false}
  # The bucket is not created here: the credential for this is meant to carry
  # object permissions only, and creating buckets is not one of them.
  step "Using the S3 endpoint from the environment"
else
  step "Disposable MinIO (local stand-in — proves the path, not the destination)"
  ACCESS_KEY=drill$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
  SECRET_KEY=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  ENDPOINT="http://$PROJECT-minio:9000"
  INSECURE=true

  docker run -d --name "$PROJECT-minio" --network "$NETWORK" \
    -e MINIO_ROOT_USER="$ACCESS_KEY" -e MINIO_ROOT_PASSWORD="$SECRET_KEY" \
    minio/minio:RELEASE.2025-04-22T22-12-26Z server /data >/dev/null

  for _ in $(seq 1 30); do
    docker run --rm --network "$NETWORK" --entrypoint sh minio/mc:RELEASE.2025-04-16T18-13-26Z -c \
      "mc alias set d $ENDPOINT $ACCESS_KEY $SECRET_KEY >/dev/null 2>&1 && mc mb --ignore-existing d/$BUCKET >/dev/null 2>&1" && break
    sleep 1
  done
  ok "object storage is up and bucket '$BUCKET' exists"
fi

# What the storage provider sees: the bucket without the decryption layer.
#
# `rclone` rather than `mc`, deliberately. `mc alias set` validates a new alias
# by asking the endpoint to list *all* buckets, which is an account-level
# permission and not one of the four object permissions this credential is
# meant to carry. Checking the bucket with the same tool that writes to it
# keeps the drill inside the permission set a real run is given.
s3() {
  docker run --rm --network "$NETWORK" --entrypoint /bin/sh rclone/rclone:1.71 -c "
    export RCLONE_CONFIG_STORE_TYPE=s3 RCLONE_CONFIG_STORE_PROVIDER=Other
    export RCLONE_CONFIG_STORE_ENDPOINT='$ENDPOINT' RCLONE_CONFIG_STORE_REGION='$REGION'
    export RCLONE_CONFIG_STORE_ACCESS_KEY_ID='$ACCESS_KEY' RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY='$SECRET_KEY'
    export RCLONE_CONFIG_STORE_NO_CHECK_BUCKET=true
    $*
  "
}

# --- a database with something in it ----------------------------------------

step "A database with data to lose"
docker run -d --name "$PROJECT-pg" --network "$NETWORK" \
  -e POSTGRES_USER=gemone -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=gemone \
  postgres:17-alpine >/dev/null

for _ in $(seq 1 30); do
  docker exec "$PROJECT-pg" pg_isready -U gemone -d gemone >/dev/null 2>&1 && break
  sleep 1
done

docker exec "$PROJECT-pg" psql -U gemone -d gemone -q -c "
  create table user_balances (user_id int primary key, pending_points int, available_points int);
  create table users (id int primary key);
  insert into users select generate_series(1, 500);
  insert into user_balances select generate_series(1, 500), 10, 25;
" >/dev/null 2>&1
BEFORE=$(docker exec "$PROJECT-pg" psql -U gemone -d gemone -tA -c \
  "select sum(pending_points + available_points) from user_balances")
ok "seeded: 500 users, $BEFORE points held"

# --- the production backup script, unmodified -------------------------------

step "The production backup script takes and verifies a dump"
docker run -d --name "$PROJECT-backup" --network "$NETWORK" \
  -e PGHOST="$PROJECT-pg" -e PGUSER=gemone -e PGPASSWORD=drill -e PGDATABASE=gemone \
  -e BACKUP_AT_UTC=23:59 \
  -v "$REPO/docker/backup.sh:/usr/local/bin/backup.sh:ro" \
  -v "$REPO/docker/restore.sh:/usr/local/bin/restore.sh:ro" \
  -v "$PROJECT-data:/backups" \
  --entrypoint /bin/sh postgres:17-alpine /usr/local/bin/backup.sh >/dev/null

for _ in $(seq 1 30); do
  DUMP=$(docker exec "$PROJECT-backup" sh -c 'ls /backups/daily/gemone-*.dump 2>/dev/null | head -1')
  [ -n "$DUMP" ] && break
  sleep 1
done

if [ -n "$DUMP" ]; then
  LOCAL_SHA=$(docker exec "$PROJECT-backup" sha256sum "$DUMP" | cut -d' ' -f1)
  ok "local dump taken: $(basename "$DUMP")"
else
  no "no local dump was produced"
  exit 1
fi

# Also exercise the weekly tier, which `backup.sh` only fills on a Sunday — so
# on a Sunday the hard link is already there and this is a no-op.
docker exec "$PROJECT-backup" sh -c "cp -n $DUMP /backups/weekly/$(basename "$DUMP") 2>/dev/null" || true

# --- configuration is refused before anything is promised -------------------
#
# Each of these is a way to end up with a backup service that runs, looks fine,
# and ships nothing — so each has to be a startup failure with the variable
# named in it.

step "Configuration that must not start"
refuses() {
  what=$1
  shift
  out=$(docker run --rm --entrypoint /bin/sh "$@" \
    -v "$REPO/docker/backup-remote.sh:/usr/local/bin/backup-remote.sh:ro" \
    rclone/rclone:1.71 /usr/local/bin/backup-remote.sh 2>&1)
  code=$?

  if [ "$code" -ne 0 ] && printf '%s' "$out" | grep -q '"level":"fatal"'; then
    ok "$what — $(printf '%s' "$out" | sed -n 's/.*"msg":"\([^"]*\)".*/\1/p' | tail -1)"
  else
    no "$what was accepted (exit $code)"
  fi
}

FULL='-e BACKUP_S3_ENDPOINT=https://s3.example.test -e BACKUP_S3_BUCKET=b -e BACKUP_S3_ACCESS_KEY_ID=k -e BACKUP_S3_SECRET_ACCESS_KEY=s'
# shellcheck disable=SC2086
refuses "no bucket" $FULL -e BACKUP_S3_BUCKET= -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE"
# shellcheck disable=SC2086
refuses "no credentials" $FULL -e BACKUP_S3_SECRET_ACCESS_KEY= -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE"
# shellcheck disable=SC2086
refuses "no passphrase" $FULL
# shellcheck disable=SC2086
refuses "a guessable passphrase" $FULL -e BACKUP_ENCRYPTION_PASSPHRASE=short-passphrase
# shellcheck disable=SC2086
refuses "plaintext transport without an explicit opt-out" $FULL \
  -e BACKUP_S3_ENDPOINT=http://s3.example.test -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE"
# shellcheck disable=SC2086
refuses "an endpoint that is not a URL" $FULL \
  -e BACKUP_S3_ENDPOINT=s3.example.test -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE"

# --- upload failure comes first, on purpose ---------------------------------
#
# The dangerous bug is a pipeline that loses the local copy when the remote is
# unreachable, so that case is proven before the happy path.

step "An upload that cannot succeed"
docker run --rm --name "$PROJECT-remote" --network "$NETWORK" \
  -e BACKUP_S3_ENDPOINT="http://$PROJECT-nowhere:9000" \
  -e BACKUP_S3_BUCKET="$BUCKET" -e BACKUP_S3_PREFIX="$PREFIX" \
  -e BACKUP_S3_ACCESS_KEY_ID="$ACCESS_KEY" -e BACKUP_S3_SECRET_ACCESS_KEY="$SECRET_KEY" \
  -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE" -e BACKUP_S3_REGION="$REGION" \
  -e BACKUP_S3_ALLOW_INSECURE=true -e BACKUP_REMOTE_INTERVAL=1 \
  -v "$REPO/docker/backup-remote.sh:/usr/local/bin/backup-remote.sh:ro" \
  -v "$PROJECT-data:/backups" \
  --entrypoint /bin/sh rclone/rclone:1.71 -c \
  '/usr/local/bin/backup-remote.sh & sleep 45; kill %1' >/tmp/drill-fail.log 2>&1

grep -q '"msg":"Upload failed"' /tmp/drill-fail.log &&
  ok "the failure is reported, at error level" || no "an upload failure was not reported"
grep -q 'not off-host' /tmp/drill-fail.log &&
  ok "the run reports that backups are not off-host" || no "the run did not report the backup as unsafe"

docker exec "$PROJECT-backup" test -f "$DUMP" &&
  ok "the verified local dump is still there" || no "the local dump was destroyed by a remote failure"
[ "$(docker exec "$PROJECT-backup" sha256sum "$DUMP" | cut -d' ' -f1)" = "$LOCAL_SHA" ] &&
  ok "and is byte-for-byte what it was" || no "the local dump changed"

RECEIPTS=$(docker exec "$PROJECT-backup" sh -c 'ls /backups/remote/daily/*.json 2>/dev/null | wc -l')
[ "$RECEIPTS" = "0" ] &&
  ok "no receipt was written, so health cannot claim a remote copy exists" ||
  no "a receipt was written for an upload that failed"

# --- the happy path ---------------------------------------------------------

step "The same script against reachable storage"
docker run --rm --name "$PROJECT-remote" --network "$NETWORK" \
  -e BACKUP_S3_ENDPOINT="$ENDPOINT" \
  -e BACKUP_S3_BUCKET="$BUCKET" -e BACKUP_S3_PREFIX="$PREFIX" \
  -e BACKUP_S3_ACCESS_KEY_ID="$ACCESS_KEY" -e BACKUP_S3_SECRET_ACCESS_KEY="$SECRET_KEY" \
  -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE" -e BACKUP_S3_REGION="$REGION" \
  -e BACKUP_S3_ALLOW_INSECURE="$INSECURE" -e BACKUP_REMOTE_INTERVAL=1 \
  -v "$REPO/docker/backup-remote.sh:/usr/local/bin/backup-remote.sh:ro" \
  -v "$PROJECT-data:/backups" \
  --entrypoint /bin/sh rclone/rclone:1.71 -c \
  '/usr/local/bin/backup-remote.sh & sleep 30; kill %1' >/tmp/drill-ok.log 2>&1

grep -q '"msg":"Backup shipped off-host and verified by round trip"' /tmp/drill-ok.log &&
  ok "upload reported complete and round-trip verified" || no "the upload did not complete"

NAME=$(basename "$DUMP")
OBJECT="$BUCKET/$PREFIX/daily/$NAME.bin"

s3 "rclone lsf --format sp 'store:$BUCKET/$PREFIX/daily'" >/tmp/drill-stat.log 2>&1
REMOTE_BYTES=$(grep "$NAME" /tmp/drill-stat.log | head -1 | cut -d';' -f1)

[ -n "$REMOTE_BYTES" ] &&
  ok "the object exists in the bucket: $OBJECT ($REMOTE_BYTES bytes)" ||
  no "no object in the bucket"

# --- is it actually encrypted? ---------------------------------------------

step "What the storage provider can read"
s3 "rclone cat 'store:$OBJECT' | head -c 8 | tr -d '\\0'" >/tmp/drill-head.log 2>&1
if grep -q 'RCLONE' /tmp/drill-head.log; then
  ok "the stored object is a crypt container, not the dump (magic: RCLONE\\0\\0)"
else
  no "the stored object does not look encrypted"
fi
s3 "rclone cat 'store:$OBJECT'" 2>/dev/null | head -c 4096 | grep -q 'PGDMP' &&
  no "the plaintext pg_dump header is readable in the bucket" ||
  ok "no pg_dump header is readable in the bucket"

# --- download, verify, restore ---------------------------------------------

step "Recovering from the remote copy alone"
docker run --rm --network "$NETWORK" \
  -e BACKUP_S3_ENDPOINT="$ENDPOINT" -e BACKUP_S3_BUCKET="$BUCKET" -e BACKUP_S3_PREFIX="$PREFIX" \
  -e BACKUP_S3_ACCESS_KEY_ID="$ACCESS_KEY" -e BACKUP_S3_SECRET_ACCESS_KEY="$SECRET_KEY" \
  -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE" -e BACKUP_S3_REGION="$REGION" \
  -v "$PROJECT-data:/backups" \
  --entrypoint /bin/sh rclone/rclone:1.71 -c "
    export RCLONE_CONFIG_STORE_TYPE=s3 RCLONE_CONFIG_STORE_PROVIDER=Other
    export RCLONE_CONFIG_STORE_ENDPOINT='$ENDPOINT' RCLONE_CONFIG_STORE_REGION='$REGION'
    export RCLONE_CONFIG_STORE_ACCESS_KEY_ID='$ACCESS_KEY' RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY='$SECRET_KEY'
    export RCLONE_CONFIG_SECURE_TYPE=crypt RCLONE_CONFIG_SECURE_REMOTE='store:$BUCKET/$PREFIX'
    export RCLONE_CONFIG_SECURE_FILENAME_ENCRYPTION=off RCLONE_CONFIG_SECURE_DIRECTORY_NAME_ENCRYPTION=false
    RCLONE_CONFIG_SECURE_PASSWORD=\$(rclone obscure '$PASSPHRASE'); export RCLONE_CONFIG_SECURE_PASSWORD
    mkdir -p /backups/recovered
    rclone copyto --quiet 'secure:daily/$NAME' '/backups/recovered/$NAME'
  " >/tmp/drill-download.log 2>&1

DOWNLOADED_SHA=$(docker exec "$PROJECT-backup" sh -c "sha256sum /backups/recovered/$NAME 2>/dev/null" | cut -d' ' -f1)
[ -n "$DOWNLOADED_SHA" ] && ok "downloaded from the bucket" || no "could not download the object"
[ "$DOWNLOADED_SHA" = "$LOCAL_SHA" ] &&
  ok "downloaded copy is byte-identical to the dump that was taken" ||
  no "downloaded copy does not match ($DOWNLOADED_SHA vs $LOCAL_SHA)"

docker exec "$PROJECT-backup" pg_restore --list "/backups/recovered/$NAME" >/dev/null 2>&1 &&
  ok "it passes pg_restore's integrity check" || no "the downloaded file is not a readable dump"

# The real test of a backup: not that it exists, but that a database comes back
# out of it. Restored beside the original, as the runbook prescribes.
docker exec "$PROJECT-backup" sh /usr/local/bin/restore.sh \
  "/backups/recovered/$NAME" gemone_from_remote >/tmp/drill-restore.log 2>&1
RESTORE_RC=$?

AFTER=$(docker exec "$PROJECT-pg" psql -U gemone -d gemone_from_remote -tA -c \
  "select sum(pending_points + available_points) from user_balances" 2>/dev/null)

[ "$RESTORE_RC" = "0" ] && ok "restore from the remote copy succeeded" || no "restore failed"
[ "$AFTER" = "$BEFORE" ] &&
  ok "money survived the round trip: $AFTER points, unchanged" ||
  no "balances differ after restore: $AFTER vs $BEFORE"

# --- retention --------------------------------------------------------------

step "Remote retention"
# An old dump, aged on disk, shipped through the real pipeline so the object
# carries that age — which is what `rclone delete --min-age` reads. Copying an
# object sideways in the bucket would give it today's timestamp and prove
# nothing.
OLD=gemone-19990101T000000Z.dump
docker exec "$PROJECT-backup" sh -c \
  "cp $DUMP /backups/daily/$OLD && touch -t 199901010000 /backups/daily/$OLD"

# First with a window wide enough to accept it…
docker run --rm --network "$NETWORK" \
  -e BACKUP_S3_ENDPOINT="$ENDPOINT" -e BACKUP_S3_BUCKET="$BUCKET" -e BACKUP_S3_PREFIX="$PREFIX" \
  -e BACKUP_S3_ACCESS_KEY_ID="$ACCESS_KEY" -e BACKUP_S3_SECRET_ACCESS_KEY="$SECRET_KEY" \
  -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE" -e BACKUP_S3_ALLOW_INSECURE="$INSECURE" \
  -e BACKUP_S3_REGION="$REGION" \
  -e BACKUP_REMOTE_KEEP_DAILY_DAYS=36500 -e BACKUP_REMOTE_INTERVAL=1 \
  -v "$REPO/docker/backup-remote.sh:/usr/local/bin/backup-remote.sh:ro" \
  -v "$PROJECT-data:/backups" \
  --entrypoint /bin/sh rclone/rclone:1.71 -c \
  '/usr/local/bin/backup-remote.sh & sleep 20; kill %1' >/tmp/drill-seed.log 2>&1

s3 "rclone lsf 'store:$BUCKET/$PREFIX/daily'" >/tmp/drill-ls-before.log 2>&1
BEFORE_N=$(grep -c 'gemone-' /tmp/drill-ls-before.log)
grep -q "19990101" /tmp/drill-ls-before.log &&
  ok "an aged backup is in the bucket to sweep ($BEFORE_N objects)" ||
  no "the aged backup was never uploaded, so retention cannot be tested"

# …then with the window that should remove it.
docker run --rm --network "$NETWORK" \
  -e BACKUP_S3_ENDPOINT="$ENDPOINT" -e BACKUP_S3_BUCKET="$BUCKET" -e BACKUP_S3_PREFIX="$PREFIX" \
  -e BACKUP_S3_ACCESS_KEY_ID="$ACCESS_KEY" -e BACKUP_S3_SECRET_ACCESS_KEY="$SECRET_KEY" \
  -e BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE" -e BACKUP_S3_ALLOW_INSECURE="$INSECURE" \
  -e BACKUP_S3_REGION="$REGION" \
  -e BACKUP_REMOTE_KEEP_DAILY_DAYS=1 -e BACKUP_REMOTE_INTERVAL=1 \
  -v "$REPO/docker/backup-remote.sh:/usr/local/bin/backup-remote.sh:ro" \
  -v "$PROJECT-data:/backups" \
  --entrypoint /bin/sh rclone/rclone:1.71 -c \
  '/usr/local/bin/backup-remote.sh & sleep 20; kill %1' >/tmp/drill-prune.log 2>&1

s3 "rclone lsf 'store:$BUCKET/$PREFIX/daily'" >/tmp/drill-ls-after.log 2>&1
AFTER_N=$(grep -c 'gemone-' /tmp/drill-ls-after.log)

grep -q "gemone-19990101" /tmp/drill-ls-after.log &&
  no "the object past its retention window is still in the bucket" ||
  ok "the object past its retention window was deleted ($BEFORE_N -> $AFTER_N objects)"
grep -q "$NAME" /tmp/drill-ls-after.log &&
  ok "the current backup was left alone" || no "retention deleted the current backup"

docker exec "$PROJECT-backup" test -f "$DUMP" &&
  ok "and remote retention deleted nothing locally" || no "a local dump disappeared"

# --- verdict ----------------------------------------------------------------

printf '\n%s\n' "----------------------------------------"
printf 'passed %s, failed %s\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
