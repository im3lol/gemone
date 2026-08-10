#!/usr/bin/env bash
#
# Guards the deployment model — ARCHITECTURE.md §20.2.
#
# Renders `docker-compose.prod.yml` with a sample tag and asserts the four
# properties the rollback story rests on. Each one is a single careless line
# away, and none of them would fail any test of the application:
#
#   1. No application service builds. A `build:` here means production compiles
#      on the server again, and a deploy with no artefact has nothing to roll
#      back to.
#   2. Every application image is tagged with the requested tag — not `latest`,
#      not a branch. A tag whose contents change is not a rollback target.
#   3. `api`, `worker` and `migrate` carry the *same* tag. A deploy running one
#      commit's API against another commit's migrations is the failure that
#      turns a bad release into a bad schema.
#   4. `api` and `worker` are the same image (§1.2), differing only in command.
#   5. Every service bounds its logs (§16.1). Docker's default is unlimited, so
#      a service that omits this fills the host disk and stops Postgres — and
#      the omission is invisible until it happens.
#   6. Every service labelled for `autoheal` actually has a health check (§17.2).
#      The label is the whole mechanism: a container that never reports
#      `unhealthy` is one autoheal will never restart, and it looks identical to
#      a working one from the outside.
#   7. Only `socket-proxy` mounts the Docker socket (T71). The Docker API is
#      root on the host, so a second service quietly mounting it undoes the
#      proxy entirely — and nothing about the stack would look different.
#   8. The off-host backup service is present, health-checked and watched
#      (§20.3, T72). A stack that keeps its only backups on the disk it is
#      backing up has no backups; that is a deployment fact, and this is where
#      deployment facts are checked.
#
# Runs in CI on every pull request and locally with no arguments.

set -euo pipefail

cd "$(dirname "$0")/.."

TAG=${1:-0000000000000000000000000000000000000000}
REPOSITORY=${2:-ghcr.io/example/gemone}

# Values for everything else the file requires. They are never used — this only
# renders the configuration — but Compose refuses to render without them, which
# is itself the behaviour the secrets pass added.
rendered=$(
  GEMONE_IMAGE_REPOSITORY="$REPOSITORY" \
  GEMONE_IMAGE_TAG="$TAG" \
  POSTGRES_USER=check \
  POSTGRES_PASSWORD=check \
  DATABASE_URL=postgresql://check:check@postgres:5432/gemone \
  JWT_SECRET=check-jwt-secret-that-is-at-least-32-chars \
  CLICK_SIGNING_SECRET=check-click-secret-at-least-32-characters \
  PUBLIC_APP_URL=https://example.test \
  SITE_ADDRESS=example.test \
  SMTP_HOST=smtp.example.test \
  SMTP_FROM='gemone <no-reply@example.test>' \
  BACKUP_S3_ENDPOINT=https://s3.example.test \
  BACKUP_S3_BUCKET=check \
  BACKUP_S3_REGION=check \
  BACKUP_S3_ACCESS_KEY_ID=check \
  BACKUP_S3_SECRET_ACCESS_KEY=check \
  BACKUP_ENCRYPTION_PASSPHRASE=check-passphrase-at-least-32-characters \
  docker compose -f docker-compose.prod.yml config
)

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

image_of() {
  printf '%s' "$rendered" | python3 -c "
import sys, yaml
service = sys.argv[1]
config = yaml.safe_load(sys.stdin)
print(config['services'][service].get('image', ''))
" "$1"
}

builds=$(printf '%s' "$rendered" | python3 -c "
import sys, yaml
config = yaml.safe_load(sys.stdin)
print(' '.join(name for name, service in config['services'].items() if 'build' in service))
")

[ -z "$builds" ] || fail "these services still build on the host: $builds"
echo "ok: nothing in the production stack builds"

for service in api worker migrate web; do
  image=$(image_of "$service")

  [ -n "$image" ] || fail "$service has no image"
  case "$image" in
    *:"$TAG") ;;
    *) fail "$service is not tagged with the requested tag: $image" ;;
  esac
  case "$image" in
    *:latest | *:main | *:master) fail "$service uses a moving tag: $image" ;;
  esac

  echo "ok: $service -> $image"
done

[ "$(image_of api)" = "$(image_of worker)" ] ||
  fail "api and worker must be the same image: $(image_of api) vs $(image_of worker)"
echo "ok: api and worker share one image"

# Compared from the *rendered* references rather than by re-reading the
# variable: what matters is what the host would actually run.
api_image=$(image_of api)
api_tag=${api_image##*:}
migrate_tag=$(image_of migrate); migrate_tag=${migrate_tag##*:}
web_tag=$(image_of web); web_tag=${web_tag##*:}

[ "$api_tag" = "$migrate_tag" ] || fail "api and migrate are on different tags"
[ "$api_tag" = "$web_tag" ] || fail "api and web are on different tags"
echo "ok: api, worker, migrate and web are all on $api_tag"

# Every service, not a list maintained here: a new service added without
# `logging:` is exactly the case this catches, and a hardcoded list would not
# know about it. The anchor in the compose file makes complying one line.
unbounded=$(printf '%s' "$rendered" | python3 -c "
import sys, yaml
config = yaml.safe_load(sys.stdin)
bad = []
for name, service in config['services'].items():
    logging = service.get('logging') or {}
    options = logging.get('options') or {}
    if (
        logging.get('driver') != 'json-file'
        or not options.get('max-size')
        or not options.get('max-file')
    ):
        bad.append(name)
print(' '.join(bad))
")

[ -z "$unbounded" ] || fail "these services have unbounded logs: $unbounded"
echo "ok: every service bounds its logs (json-file, max-size, max-file)"

# Two failures, one of which is silent. A labelled service with no health check
# is never restarted; a service that serves traffic with no label is never
# restarted either. `web` is named explicitly because it is the one that serves
# every page — the rest of the rule is general, so a new labelled service cannot
# arrive without a check.
watched=$(printf '%s' "$rendered" | python3 -c "
import sys, yaml
config = yaml.safe_load(sys.stdin)
missing_check, unwatched = [], []
for name, service in config['services'].items():
    labelled = (service.get('labels') or {}).get('gemone.autoheal') == 'true'
    checked = bool((service.get('healthcheck') or {}).get('test'))
    if labelled and not checked:
        missing_check.append(name)
    if name == 'web' and not (labelled and checked):
        unwatched.append(name)
print(';'.join([' '.join(missing_check), ' '.join(unwatched)]))
")

[ -z "${watched%%;*}" ] ||
  fail "labelled for autoheal but with no health check: ${watched%%;*}"
[ -z "${watched##*;}" ] ||
  fail "web needs both a health check and the gemone.autoheal label"
echo "ok: every autoheal-labelled service has a health check, web included"

# The mount, not the flag: `:ro` is not treated as safer here, because the
# calls that matter are writes made through the socket rather than to the file.
holders=$(printf '%s' "$rendered" | python3 -c "
import sys, yaml
config = yaml.safe_load(sys.stdin)
holders = []
for name, service in config['services'].items():
    for volume in service.get('volumes') or []:
        source = volume.get('source') if isinstance(volume, dict) else str(volume).split(':')[0]
        if source == '/var/run/docker.sock':
            holders.append(name)
print(' '.join(sorted(set(holders))))
")

[ "$holders" = 'socket-proxy' ] ||
  fail "the Docker socket must be held by socket-proxy alone, not by: ${holders:-nothing}"
echo "ok: socket-proxy alone holds the Docker socket"

# Health here has to read the *receipts* the uploader writes, not the dumps
# `backup` writes: a stack whose uploads fail while its local dumps succeed
# must report unhealthy, and it is the health-check path that decides which of
# those two facts the stack is reporting.
offsite=$(printf '%s' "$rendered" | python3 -c "
import sys, yaml
config = yaml.safe_load(sys.stdin)
service = config['services'].get('backup-remote')
problems = []
if service is None:
    problems.append('there is no backup-remote service')
else:
    test = ' '.join((service.get('healthcheck') or {}).get('test') or [])
    if not test:
        problems.append('backup-remote has no health check')
    elif '/backups/remote' not in test:
        problems.append('backup-remote health does not read the upload receipts')
    if (service.get('labels') or {}).get('gemone.autoheal') != 'true':
        problems.append('backup-remote is not watched by autoheal')
    if service.get('ports'):
        problems.append('backup-remote publishes a port')
print('; '.join(problems))
")

[ -z "$offsite" ] || fail "$offsite"
echo "ok: backups are shipped off-host, and health reads the upload receipts"
