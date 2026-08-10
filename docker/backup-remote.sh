#!/bin/sh
#
# Ships verified dumps off the host — ARCHITECTURE.md §20.3, T72.
#
# `backup.sh` takes the dump, proves it is readable, and keeps it on a volume
# on this VPS. That recovers a bad migration, a `DELETE` without a `WHERE`, a
# dropped table — everything except the case the whole exercise is named for.
# **A backup on the same disk as the database is not a backup.** This is the
# other half: every dump is encrypted here, uploaded to S3-compatible object
# storage, read back to prove it decrypts to the same bytes, and only then
# recorded as safe.
#
# ## Why a second container and not ten lines in `backup.sh`
#
# `postgres:17-alpine` — the image `backup` runs in, deliberately, so `pg_dump`
# matches the server — ships no HTTP client and no crypto tooling: no `curl`,
# no `wget`, no `openssl`, no `gpg`. Checked, not assumed. Adding them means
# either installing packages at every container start, or building an image,
# and production deliberately runs only images CI published (§20.2). Neither is
# worth it when a pinned, stock 110 MB image does encryption, transfer and
# remote retention with one static binary and no framework.
#
# ## What "uploaded" is allowed to mean
#
# Only this: the object was written, read back through the same encryption, and
# hashed to the same SHA-256 as the local file. Anything less is a report that
# a copy exists somewhere, which is exactly the belief a disaster disproves.
# The receipt is written after that check and never before, and the health
# check reads receipts rather than dumps — so a stack whose uploads are failing
# goes unhealthy while its local backups keep succeeding, which is the true
# statement about it.
#
# **Local dumps are never deleted here.** Not on failure, not on success, not
# ever: `backup.sh` owns local retention. A remote outage must not be able to
# turn into local data loss.

set -u

# --- configuration ---------------------------------------------------------
#
# Provider-agnostic on purpose: any S3-compatible endpoint (AWS S3, Cloudflare
# R2, Backblaze B2, Wasabi, MinIO, Hetzner). No provider is chosen here, and no
# default endpoint or bucket exists to be silently wrong.

DIR=${BACKUP_DIR:-/backups}
ENDPOINT=${BACKUP_S3_ENDPOINT:-}
BUCKET=${BACKUP_S3_BUCKET:-}
PREFIX=${BACKUP_S3_PREFIX:-gemone}
REGION=${BACKUP_S3_REGION:-us-east-1}
ACCESS_KEY=${BACKUP_S3_ACCESS_KEY_ID:-}
SECRET_KEY=${BACKUP_S3_SECRET_ACCESS_KEY:-}
PASSPHRASE=${BACKUP_ENCRYPTION_PASSPHRASE:-}
KEEP_DAILY_DAYS=${BACKUP_REMOTE_KEEP_DAILY_DAYS:-30}
KEEP_WEEKLY_DAYS=${BACKUP_REMOTE_KEEP_WEEKLY_DAYS:-90}
INTERVAL=${BACKUP_REMOTE_INTERVAL:-300}
# Plaintext transport is refused unless something says otherwise in as many
# words. The only intended user of this is the local drill, which runs a
# throwaway MinIO on the loopback of a test network.
ALLOW_INSECURE=${BACKUP_S3_ALLOW_INSECURE:-false}

RECEIPTS="$DIR/remote"

# JSON to stdout like everything else (§16.1). Values are the script's own —
# no credential is ever passed through here.
log() {
  level=$1
  msg=$2
  extra=${3:-}
  printf '{"level":"%s","service":"backup-remote","time":"%s","msg":"%s"%s}\n' \
    "$level" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" "$extra"
}

fail_config() {
  log fatal "$1"
  exit 1
}

# Validated here, at startup, rather than at 02:00 on the night it matters. A
# missing bucket name is a configuration mistake; discovering it from a missing
# backup six weeks later is a disaster.
[ -n "$ENDPOINT" ] || fail_config 'BACKUP_S3_ENDPOINT is required'
[ -n "$BUCKET" ] || fail_config 'BACKUP_S3_BUCKET is required'
[ -n "$ACCESS_KEY" ] || fail_config 'BACKUP_S3_ACCESS_KEY_ID is required'
[ -n "$SECRET_KEY" ] || fail_config 'BACKUP_S3_SECRET_ACCESS_KEY is required'
[ -n "$PASSPHRASE" ] || fail_config 'BACKUP_ENCRYPTION_PASSPHRASE is required'

case "$PASSPHRASE" in
  # A passphrase short enough to guess protects a file that has left the
  # building, which is the one file an attacker can work on offline for as
  # long as they like.
  ?????????????????????????????????*) ;;
  *) fail_config 'BACKUP_ENCRYPTION_PASSPHRASE must be at least 32 characters' ;;
esac

case "$ENDPOINT" in
  https://*) ;;
  http://*)
    [ "$ALLOW_INSECURE" = 'true' ] ||
      fail_config 'BACKUP_S3_ENDPOINT must be https:// (set BACKUP_S3_ALLOW_INSECURE=true only for a local drill)'
    log warn 'Uploading over plaintext HTTP because BACKUP_S3_ALLOW_INSECURE is set'
    ;;
  *) fail_config 'BACKUP_S3_ENDPOINT must be an absolute http(s) URL' ;;
esac

# --- remotes ---------------------------------------------------------------
#
# Configured entirely through the environment: no config file is written, so no
# file on this host ever contains the secret key or the passphrase.
#
# `secure:` is a crypt remote layered over `store:`. Encryption happens **here**
# rather than in the bucket, so the provider stores ciphertext it cannot read —
# a bucket policy, a leaked read-only key or a subpoena all yield the same
# thing. Filenames stay readable, deliberately: at 3am an operator has to be
# able to see which night a file is from without decrypting anything.

export RCLONE_CONFIG_STORE_TYPE=s3
export RCLONE_CONFIG_STORE_PROVIDER=Other
export RCLONE_CONFIG_STORE_ENDPOINT="$ENDPOINT"
export RCLONE_CONFIG_STORE_REGION="$REGION"
export RCLONE_CONFIG_STORE_ACCESS_KEY_ID="$ACCESS_KEY"
export RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY="$SECRET_KEY"
# The upload credential should not need to create buckets, so do not probe for
# one: a write-only key is the right key for a machine that only ever adds.
export RCLONE_CONFIG_STORE_NO_CHECK_BUCKET=true

export RCLONE_CONFIG_SECURE_TYPE=crypt
export RCLONE_CONFIG_SECURE_REMOTE="store:$BUCKET/$PREFIX"
export RCLONE_CONFIG_SECURE_FILENAME_ENCRYPTION=off
export RCLONE_CONFIG_SECURE_DIRECTORY_NAME_ENCRYPTION=false
# rclone stores this obscured rather than plain. Obscuring it here means the
# operator supplies an ordinary passphrase and cannot accidentally supply an
# already-obscured one, which fails with an error about base64.
RCLONE_CONFIG_SECURE_PASSWORD=$(rclone obscure "$PASSPHRASE") || fail_config 'Could not prepare the encryption passphrase'
export RCLONE_CONFIG_SECURE_PASSWORD

# --- shipping --------------------------------------------------------------

# One dump: upload, read back through the decryption, compare, then record.
ship() {
  tier=$1
  file=$2
  name=$(basename "$file")
  receipt="$RECEIPTS/$tier/$name.json"
  remote="secure:$tier/$name"

  local_sha=$(sha256sum "$file" | cut -d' ' -f1)
  bytes=$(wc -c <"$file" | tr -d ' ')
  started=$(date -u +%s)

  if ! rclone copyto --quiet "$file" "$remote" 2>/tmp/remote.err; then
    log error "Upload failed" \
      ",\"tier\":\"$tier\",\"file\":\"$name\",\"err\":\"$(tr -d '"\n' </tmp/remote.err | tail -c 300)\""
    return 1
  fi

  # The check that makes the word "uploaded" mean something. Streamed, so a
  # dump larger than this container's disk still verifies, and routed through
  # `secure:` so it exercises the decryption an actual recovery would need.
  remote_sha=$(rclone cat "$remote" 2>/tmp/remote.err | sha256sum | cut -d' ' -f1)

  if [ "$remote_sha" != "$local_sha" ]; then
    log error "Uploaded copy does not match the local dump — not recording it as safe" \
      ",\"tier\":\"$tier\",\"file\":\"$name\""
    # Left in place rather than deleted: a mismatching object is evidence, and
    # deleting it needs a permission this key should not have.
    return 1
  fi

  elapsed=$(( $(date -u +%s) - started ))

  printf '{"file":"%s","tier":"%s","sha256":"%s","bytes":%s,"remote":"%s","uploaded_at":"%s"}\n' \
    "$name" "$tier" "$local_sha" "$bytes" "$BUCKET/$PREFIX/$tier/$name" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$receipt.partial"
  mv "$receipt.partial" "$receipt"

  log info "Backup shipped off-host and verified by round trip" \
    ",\"tier\":\"$tier\",\"file\":\"$name\",\"bytes\":$bytes,\"seconds\":$elapsed"
}

# Everything within the remote retention window that has no receipt. Older
# files are skipped rather than uploaded: an object written now carries now's
# modification time, so re-uploading one past its window would be deleted by
# the next sweep and uploaded again by the next scan, forever.
ship_tier() {
  tier=$1
  keep=$2
  failures=0
  shipped=0

  mkdir -p "$RECEIPTS/$tier"

  for file in $(find "$DIR/$tier" -name 'gemone-*.dump' -mtime "-$keep" 2>/dev/null | sort); do
    [ -f "$RECEIPTS/$tier/$(basename "$file").json" ] && continue

    if ship "$tier" "$file"; then
      shipped=$(( shipped + 1 ))
    else
      failures=$(( failures + 1 ))
    fi
  done

  [ "$shipped" -gt 0 ] && log info "Tier complete" ",\"tier\":\"$tier\",\"shipped\":$shipped"
  return "$failures"
}

# Remote retention mirrors §20.3's local windows: daily for a month, weekly for
# a quarter. The receipt goes with the object, so a restored-from-scratch host
# does not think it still holds something the bucket no longer has.
prune_tier() {
  tier=$1
  keep=$2

  if ! rclone delete --quiet --min-age "${keep}d" "secure:$tier" 2>/tmp/remote.err; then
    log warn "Remote retention sweep failed" \
      ",\"tier\":\"$tier\",\"err\":\"$(tr -d '"\n' </tmp/remote.err | tail -c 200)\""
    return 0
  fi

  # A receipt answers "has this dump been shipped?", so it is kept exactly as
  # long as the dump it is about. Ageing receipts out on their own clock would
  # eventually re-upload a file that is still here, or leave a claim about a
  # file that is not.
  for receipt in "$RECEIPTS/$tier"/*.json; do
    [ -e "$receipt" ] || continue
    dump=$(basename "$receipt" .json)
    [ -f "$DIR/$tier/$dump" ] || rm -f "$receipt"
  done
}

run_once() {
  failures=0

  ship_tier daily "$KEEP_DAILY_DAYS" || failures=$(( failures + $? ))
  ship_tier weekly "$KEEP_WEEKLY_DAYS" || failures=$(( failures + $? ))

  # Said before the retention sweep, not after: when the remote is unreachable
  # the sweep is going to spend its own timeout failing too, and the line that
  # matters should not be queued behind it.
  [ "$failures" -eq 0 ] ||
    log error "One or more backups are not off-host — the health check will report this" \
      ",\"failures\":$failures"

  prune_tier daily "$KEEP_DAILY_DAYS"
  prune_tier weekly "$KEEP_WEEKLY_DAYS"

  [ "$failures" -eq 0 ]
}

mkdir -p "$RECEIPTS/daily" "$RECEIPTS/weekly"

# The region is logged because it is signed into every request: when it does
# not match the endpoint's own, the provider rejects everything with a message
# about a malformed authorization header, and the first place anyone looks is
# this line.
log info "Remote backup service started" \
  ",\"bucket\":\"$BUCKET\",\"prefix\":\"$PREFIX\",\"region\":\"$REGION\",\"keep_daily_days\":$KEEP_DAILY_DAYS,\"keep_weekly_days\":$KEEP_WEEKLY_DAYS,\"interval\":$INTERVAL"

# A poll rather than a trigger: the two containers share a volume and nothing
# else, and a file appearing in it is the entire protocol. No socket, no queue,
# and nothing to keep in sync (P6).
while true; do
  run_once
  sleep "$INTERVAL"
done
