# Runbook — Operating gemone in Production

Procedures that exist in this repository and have been executed. Anything not
built is marked **Not implemented** rather than described, because a runbook
that documents a procedure nobody can run is worse than a missing page.

Companion documents: ARCHITECTURE.md §17 (health), §19 (security boundaries),
§20 (deployment, backups). TODO.md holds what is deliberately not done.

**Every command below runs on the production host, from the directory holding
`docker-compose.prod.yml`.** `docker compose -f docker-compose.prod.yml` is
written out each time on purpose: running one of these against the development
file is the mistake this repetition exists to prevent.

---

## 1. Deployment

### 1.1 Required environment

The production file uses `${VAR:?message}`, so a missing value stops the deploy
before anything starts. There are no silent defaults for these:

| Variable | What it is |
|---|---|
| `GEMONE_IMAGE_REPOSITORY` | `ghcr.io/<owner>/<repo>` |
| `GEMONE_IMAGE_TAG` | The commit SHA CI built. Never `latest` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database superuser |
| `DATABASE_URL` | What `api`, `worker` and `migrate` connect with |
| `JWT_SECRET` | ≥32 chars. Rotating it logs everyone out |
| `CLICK_SIGNING_SECRET` | ≥32 chars. **Rotating it invalidates every outstanding click** (T16) |
| `PUBLIC_APP_URL` | Public origin, e.g. `https://example.com` |
| `SITE_ADDRESS` | What Caddy serves. Must be the **same origin** as `PUBLIC_APP_URL` — §6.1 below |
| `SMTP_HOST`, `SMTP_FROM` | Mail. Without a host the API refuses to boot in production |
| `BACKUP_S3_ENDPOINT` | `https://…` — plaintext is refused |
| `BACKUP_S3_BUCKET` | |
| `BACKUP_S3_REGION` | Must match the endpoint's own region — §6.4 below |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | Object permissions only |
| `BACKUP_ENCRYPTION_PASSPHRASE` | ≥32 chars. **Losing it loses every off-host backup** |

Optional, with defaults that are correct as they stand: `POSTGRES_DB`,
`REDIS_URL`, `LOG_LEVEL`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`BACKUP_AT_UTC`, `BACKUP_KEEP_DAILY_DAYS`, `BACKUP_KEEP_WEEKLY_DAYS`,
`BACKUP_S3_PREFIX`, `BACKUP_REMOTE_KEEP_DAILY_DAYS`,
`BACKUP_REMOTE_KEEP_WEEKLY_DAYS`, `BACKUP_REMOTE_INTERVAL`.

Keep them in the host's env file, readable only by the deploying user. Nothing
in this repository contains a production secret.

### 1.2 Before deploying

```sh
# Renders the production file and asserts the deployment model: nothing builds,
# no moving tags, api/worker/migrate/web on one tag, every service's logs
# bounded, every autoheal-labelled service health-checked, and socket-proxy
# alone holding the Docker socket.
./docker/check-prod-images.sh
```

This also runs in CI on every pull request. If it fails, do not deploy.

### 1.3 Deploying a SHA

```sh
export GEMONE_IMAGE_REPOSITORY="ghcr.io/<owner>/<repo>"
export GEMONE_IMAGE_TAG="<commit SHA>"

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

`migrate` runs to completion first; nothing else starts if it fails. A tag that
was never built fails the `pull` and leaves the running stack untouched — the
production file contains no `build:`, so it cannot quietly compile instead.

### 1.4 After deploying

```sh
# Every service, its state, and its health.
docker compose -f docker-compose.prod.yml ps

# Which commit is actually running — read from the image, not the env file.
for s in api worker web; do
  printf '%-8s %s\n' "$s" "$(docker inspect -f \
    '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
    "$(docker compose -f docker-compose.prod.yml ps -q $s)")"
done

# Migrations for this deploy.
docker compose -f docker-compose.prod.yml logs migrate | tail -20
```

Expect `api`, `web`, `worker`, `backup`, `backup-remote`, `postgres`, `redis`
and `socket-proxy` running, `migrate` exited 0, and the three revisions equal to
the SHA you deployed. `backup-remote` reports `starting` for its first 10
minutes by design (§3.3).

Then from outside the host:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' "https://<site>/health"
curl -sS -o /dev/null -w '%{http_code}\n' "https://<site>/login"
```

---

## 2. Rollback

### 2.1 What is running now

```sh
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$(docker compose -f docker-compose.prod.yml ps -q api)"
```

### 2.2 Roll back

```sh
GEMONE_IMAGE_TAG="<previous SHA>" docker compose -f docker-compose.prod.yml up -d
```

One variable names the image for `api`, `worker` and `migrate`, so they cannot
land on different commits.

**The schema is not rolled back**, deliberately: migrations are
backward-compatible by rule (expand first), so the previous image runs against
the newer schema. A migration that is not backward-compatible cannot be rolled
back this way — restore from a backup instead (§3.5).

### 2.3 Verify

Repeat §1.4. All three revisions should read the previous SHA, the stack should
be healthy, and `/health` and `/login` should answer 200.

---

## 3. Backups

Two halves. `backup` takes and verifies the dump on this host;
`backup-remote` encrypts it, ships it off the host and proves it can be read
back. Neither deletes anything the other depends on.

### 3.1 Local backups

Automatic: one at container start and one at `BACKUP_AT_UTC` (02:00 by default),
into a volume separate from the database's own.

```sh
# What exists now.
docker compose -f docker-compose.prod.yml exec backup \
  sh -c 'ls -lh /backups/daily | tail -5; ls -lh /backups/weekly | tail -3'
```

Each dump is written aside and moved into place, then read back with
`pg_restore --list`; an unreadable archive is deleted rather than kept. Sunday's
dump is hard-linked into `weekly/`. Retention: daily for 30 days, weekly for 90.

**`prune` deletes by age alone.** It does not ask whether a dump was ever
shipped off-host — see §3.3.

### 3.2 Off-host backups

`backup-remote` polls the same volume every `BACKUP_REMOTE_INTERVAL` seconds
(300 by default). For each dump with no receipt it encrypts client-side,
uploads, **reads the object back through the same decryption and compares
SHA-256**, and only then writes a receipt. The storage provider holds ciphertext
it cannot read.

### 3.3 Verify a backup actually left the host

A dump on this disk proves nothing about surviving the host. The receipts do:

```sh
# Receipts — one per dump that was uploaded AND read back intact.
docker compose -f docker-compose.prod.yml exec backup \
  sh -c 'ls -l /backups/remote/daily | tail -5'

# What one says.
docker compose -f docker-compose.prod.yml exec backup \
  sh -c 'cat "$(ls -t /backups/remote/daily/*.json | head -1)"'

# The service's own view.
docker compose -f docker-compose.prod.yml logs backup-remote | tail -20
```

A receipt carries the file name, SHA-256, byte count, remote path and upload
time. **This is what the health check reads** — not the dumps — so a stack whose
uploads are failing while its local dumps keep succeeding reports `unhealthy`,
which is the true statement about it.

To look at the bucket itself (needs only `ListBucket`):

```sh
docker run --rm --entrypoint /bin/sh rclone/rclone:1.71 -c '
  export RCLONE_CONFIG_S_TYPE=s3 RCLONE_CONFIG_S_PROVIDER=Other
  export RCLONE_CONFIG_S_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_S_ENDPOINT="'"$BACKUP_S3_ENDPOINT"'"
  export RCLONE_CONFIG_S_REGION="'"$BACKUP_S3_REGION"'"
  export RCLONE_CONFIG_S_ACCESS_KEY_ID="'"$BACKUP_S3_ACCESS_KEY_ID"'"
  export RCLONE_CONFIG_S_SECRET_ACCESS_KEY="'"$BACKUP_S3_SECRET_ACCESS_KEY"'"
  rclone lsl "s:'"$BACKUP_S3_BUCKET"'/'"${BACKUP_S3_PREFIX:-gemone}"'"
'
```

### 3.4 Backblaze B2 — versions and lifecycle

**A deleted object is not deleted.** On a versioned bucket — B2's default —
`DeleteObject` hides the current version and keeps the data. Verified on the
real bucket: an object the retention sweep removed vanished from the listing and
remained as a non-current version.

Retention therefore makes old backups unreachable but does **not** stop them
costing money. **Manual prerequisite:** set a bucket lifecycle rule in the
Backblaze console to keep only the last version. No code here can do it, and the
backup key deliberately has no permission to.

Also note: `BACKUP_S3_REGION` must be the region in B2's endpoint hostname
(`s3.<region>.backblazeb2.com`). See §6.4.

### 3.5 Restore from a local dump

Restores **beside** the live database. The target must not already exist unless
you pass `--replace`, which drops it.

```sh
# 1. Pick a dump.
docker compose -f docker-compose.prod.yml exec backup ls /backups/daily

# 2. Restore it under a new name. `--entrypoint sh` is not optional: without it
#    the path is handed to backup.sh, which now refuses arguments and tells you
#    this.
docker compose -f docker-compose.prod.yml run --rm --entrypoint sh backup \
  /usr/local/bin/restore.sh "/backups/daily/gemone-<stamp>.dump" gemone_check

# 3. Look at it before deciding anything. The script prints table count, user
#    count and total points held.
```

The archive is listed before anything is dropped, so an unreadable dump cannot
cost you the database you still had. `pg_restore --exit-on-error` means a
partial restore is a failure, not a database quietly missing a constraint.

Promoting a restored copy to be the live database is a deliberate, manual
decision and is **not** scripted here.

### 3.6 Restore from the off-host copy

This is the procedure for having lost the host. It needs the endpoint, the key
and **the encryption passphrase** — which is why the passphrase must be stored
somewhere other than this VPS.

```sh
# 1. Download and decrypt one backup. Names are not encrypted, so the night is
#    readable in the listing; the `.bin` suffix is the crypt container.
docker run --rm -v "$PWD:/out" --entrypoint /bin/sh rclone/rclone:1.71 -c '
  export RCLONE_CONFIG_STORE_TYPE=s3 RCLONE_CONFIG_STORE_PROVIDER=Other
  export RCLONE_CONFIG_STORE_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_STORE_ENDPOINT="'"$BACKUP_S3_ENDPOINT"'"
  export RCLONE_CONFIG_STORE_REGION="'"$BACKUP_S3_REGION"'"
  export RCLONE_CONFIG_STORE_ACCESS_KEY_ID="'"$BACKUP_S3_ACCESS_KEY_ID"'"
  export RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY="'"$BACKUP_S3_SECRET_ACCESS_KEY"'"
  export RCLONE_CONFIG_SECURE_TYPE=crypt
  export RCLONE_CONFIG_SECURE_REMOTE="store:'"$BACKUP_S3_BUCKET"'/'"${BACKUP_S3_PREFIX:-gemone}"'"
  export RCLONE_CONFIG_SECURE_FILENAME_ENCRYPTION=off
  export RCLONE_CONFIG_SECURE_DIRECTORY_NAME_ENCRYPTION=false
  RCLONE_CONFIG_SECURE_PASSWORD=$(rclone obscure "'"$BACKUP_ENCRYPTION_PASSPHRASE"'")
  export RCLONE_CONFIG_SECURE_PASSWORD
  rclone lsf secure:daily
  rclone copyto "secure:daily/gemone-<stamp>.dump" "/out/gemone-<stamp>.dump"
'

# 2. Prove it is a dump before trusting it.
docker run --rm -v "$PWD:/d" postgres:17-alpine \
  pg_restore --list "/d/gemone-<stamp>.dump" >/dev/null && echo readable

# 3. Restore it, into a database that is not the live one.
```

Whole path — download, decrypt, byte-identical check, `pg_restore --list`,
restore into a separate database, balances unchanged — is what
`docker/backup-remote-drill.sh` executes. It has been run against the real
external bucket: 26 assertions, all passing.

### 3.7 Rehearse it

```sh
# Against a disposable local S3 server. Touches nothing real.
./docker/backup-remote-drill.sh

# Against the real bucket. Writes under the drill/ prefix only, never gemone/.
DRILL_S3_ENDPOINT=… DRILL_S3_BUCKET=… DRILL_S3_REGION=… \
DRILL_S3_ACCESS_KEY_ID=… DRILL_S3_SECRET_ACCESS_KEY=… \
  ./docker/backup-remote-drill.sh
```

§20.3 asks for a restore drill quarterly. This is it.

---

## 4. Health and incidents

### 4.1 What is watched, and by what

| Service | Health check | Restarted by autoheal |
|---|---|---|
| `api` | `GET /health` on loopback | **yes** |
| `worker` | Redis heartbeat, 60s TTL | **yes** |
| `web` | `GET /login` on loopback | **yes** |
| `backup` | A dump newer than 26h | **yes** |
| `backup-remote` | An upload **receipt** newer than 26h | **yes** |
| `postgres`, `redis` | yes | no — deliberate |
| `socket-proxy` | Socket file exists | no — restarting it from the thing that depends on it is a loop |
| `caddy` | none | no |
| `migrate` | none | n/a, runs once |

**Docker's `restart` policy reacts to a process exiting, never to a health check
failing.** An `unhealthy` container stays up forever on its own; `autoheal` is
what closes that loop. Verified: a container with `--restart unless-stopped` and
a failing check reported `Health=unhealthy Running=true RestartCount=0`.

### 4.2 First commands in an incident

```sh
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 100 api
docker compose -f docker-compose.prod.yml logs --tail 50 autoheal

# Why the last probe failed, for one service.
docker inspect -f '{{json .State.Health}}' \
  "$(docker compose -f docker-compose.prod.yml ps -q api)" | head -c 2000
```

### 4.3 Reading it

- **`api` unhealthy** — `/health` is liveness only and touches nothing external,
  so a failure means the process itself is wedged or gone. Check its logs for a
  crash loop; autoheal restarts it within ~15s of the third failed probe.
- **`worker` unhealthy** — the heartbeat it writes to Redis has expired: either
  the event loop is stuck or Redis is unreachable. A worker that is "running"
  but not consuming credits nobody and says nothing, which is what this exists
  to make visible. Check `redis` first.
- **`web` unhealthy** — `GET /login` no longer renders. It makes no API call, so
  this is `web` itself, not the API.
- **`backup` unhealthy** — no dump in 26 hours. Check its logs for the `pg_dump`
  error; a restart takes one immediately.
- **`backup-remote` unhealthy** — dumps are being taken and **not leaving the
  host**. Almost always configuration or the provider: see §6.4 and §6.5. Local
  backups are unaffected and are not deleted.
- **`autoheal` restart loop on one container** — restarting is not fixing it.
  Stop relying on the loop and read the container's logs.

### 4.4 If autoheal itself stops working

Nothing restarts unhealthy containers, and the stack degrades silently. Check,
in this order:

```sh
docker compose -f docker-compose.prod.yml ps autoheal socket-proxy
docker compose -f docker-compose.prod.yml logs --tail 30 autoheal
docker compose -f docker-compose.prod.yml logs --tail 30 socket-proxy
```

`autoheal` reaches Docker only through `socket-proxy` (§5). If the proxy is
down or its socket is missing, autoheal cannot see anything; its entrypoint
requires the socket file to exist at startup. Restart the proxy first, then
autoheal:

```sh
docker compose -f docker-compose.prod.yml restart socket-proxy autoheal
```

Meanwhile, restarting a wedged container by hand is always available:

```sh
docker compose -f docker-compose.prod.yml restart worker
```

---

## 5. The Docker socket proxy

`autoheal` does not hold the Docker socket. `socket-proxy` (HAProxy, rules in
`docker/docker-socket-proxy.cfg`) holds it and publishes a unix socket in a
volume shared with `autoheal` alone. There is no port — nothing on the host or
the internal network can reach it.

**Allowed, and nothing else:**

| Request | Why |
|---|---|
| `GET /containers/json?filters=…gemone.autoheal…` | Find unhealthy labelled containers. Health and state come from this response; autoheal never calls inspect |
| `POST /containers/<id>/restart` | The restart |

**Blocked** (verified by probe, all 403): `POST /containers/create` — the
privileged-container escape that turns Docker API access into host root —
`exec`, `kill`, `stop`, `DELETE /containers/<id>`, `GET /containers/<id>/json`,
`/images/json`, `/info`, `/version`, `/volumes/create`, and an unfiltered
`GET /containers/json`.

**If autoheal stops restarting things**, check the proxy's log: a denied request
is logged with its path. The rules are fitted to `willfarrell/autoheal:1.2.0`,
which is pinned — a different version issuing a different request shape **fails
closed**: healing stops and nothing raises an error. After changing that pin,
re-run the health drill.

**What this does not protect:** `socket-proxy` is now the root-equivalent
container, and a compromised `autoheal` can still restart any container by id
(the label is on the container, not in the request) — a denial of service, not a
host compromise. TODO.md T71 states the boundary in full.

---

## 6. Configuration failures

Each of these is enforced somewhere and fails in a specific way.

### 6.1 `SITE_ADDRESS` vs `PUBLIC_APP_URL`

They must be the **same origin**. `SITE_ADDRESS` is what Caddy serves and gets a
certificate for; `PUBLIC_APP_URL` goes into every emailed link and is passed to
`web` as SvelteKit's `ORIGIN`, which rejects any form post whose `Origin` header
does not match.

**Symptom if they disagree:** the site loads, every page renders, and every
login, registration and payout submission returns a bare 403 with nothing in
either service's log.

**It cannot happen unnoticed:** the API compares them at startup and refuses to
boot, naming both origins. Compared as origins, so a trailing slash, a path or
an explicit `:443` on `https` are all fine; a different scheme, host or port is
not. A bare hostname means HTTPS, which is what Caddy does with one.

```sh
docker compose -f docker-compose.prod.yml logs api | grep -i "same origin"
```

### 6.2 `JWT_SECRET`

Required, ≥32 characters, no default. The API refuses to start without it and
Compose refuses to render. Changing it invalidates every issued access token —
everyone is logged out. Not dangerous, but do it deliberately.

### 6.3 `CLICK_SIGNING_SECRET`

Required, ≥32 characters, and **separate from `JWT_SECRET` on purpose**: an
access token lives 15 minutes, a click's attribution window lives 30 days.
Rotating this invalidates every outstanding click and every conversion still to
arrive for them (T16). Not a routine rotation.

### 6.4 `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`

All required; there is no default endpoint or bucket.

- **Endpoint** must be `https://`. Plaintext is refused at startup unless
  `BACKUP_S3_ALLOW_INSECURE=true`, which exists for the local drill and has no
  place in production.
- **Region** is signed into every request by SigV4. If it disagrees with the
  endpoint the provider rejects everything with
  `AuthorizationHeaderMalformed: … the region is wrong; expecting '<x>'`. For
  Backblaze B2 it is the region inside the endpoint hostname,
  `s3.<region>.backblazeb2.com`. The value is logged at startup:

```sh
docker compose -f docker-compose.prod.yml logs backup-remote | head -3
```

**Symptom of any of these being wrong:** dumps keep being taken, no receipts
appear, `backup-remote` goes `unhealthy` after 10 minutes, and its log carries
the provider's own error.

### 6.5 The object-storage credentials

The key needs exactly `ListBucket`, `PutObject`, `GetObject`, `DeleteObject` on
the one bucket. It does **not** need `CreateBucket` and does not need to list
the account's buckets — verified: that call returns `403 AccessDenied`, and
nothing in the flow uses it.

### 6.6 `BACKUP_ENCRYPTION_PASSPHRASE`

Required, ≥32 characters. Encryption is client-side, so **this passphrase is the
only thing that can read the off-host backups**. Store it somewhere other than
this VPS: a passphrase kept only on the machine the backups protect protects
nothing.

### 6.7 `SMTP_HOST` / `SMTP_FROM`

Required in production. Without a host the API resolves the logging email
provider, which writes password-reset **links** into the application log — an
account-takeover path — so the API refuses to boot instead.

---

## 7. Logs

Every service logs JSON to stdout; Docker collects it. There are no log files
inside the containers to manage.

```sh
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs --since 1h --tail 200 worker

# One request end to end. Every line carries the correlation id, and jobs
# inherit the id of the request that enqueued them.
docker compose -f docker-compose.prod.yml logs api worker | grep "<correlation-id>"
```

**Retention is by size, not time:** `json-file`, `max-size: 10m`,
`max-file: 3` — 30 MB per service, under ~270 MB for the stack, whatever the
traffic. Under load that window is hours; idle it is months. Lines older than
the window are gone (T73).

**There is no log shipping and no external log store.** Losing the host loses
the logs.

### Not implemented

- **External uptime monitoring.** Nothing outside this host polls the health
  endpoints. Every check described in §4 runs *on* the machine whose failure it
  would report, so a host that is down reports nothing at all.
- **Alerting.** The conditions in ARCHITECTURE.md §17.3 are logged at `error`
  level and nothing delivers them. Noticing an incident is currently a person
  looking.
- **Metrics and tracing.** §17.4, §17.5 — deliberately future.
- **Edge rate limiting.** Caddy carries none (§19.5). The API bounds login,
  public endpoints and clicks; volumetric abuse in front of that is unhandled.
- **Replaying quarantined postbacks** (T21). The raw payloads are stored in
  `provider_postbacks` precisely so this is possible, and the replay code
  exists, but nothing drives it from outside. Do not improvise one during an
  incident.

**Disabling a provider is implemented**, through the admin API rather than a
script: `PATCH /admin/providers/:id/enabled` with `{ "enabled": false, "reason":
… }`, admin role required, and the change is audited. The reward rates, hold
periods and thresholds behind it are configuration (`PUT
/admin/configuration/:key`), changeable at runtime without a deploy. The admin
web UI covers payouts only, so this is an authenticated API call today. **Not
rehearsed as an operator procedure** — the endpoints and their guards are
covered by tests, but no drill has exercised them from an operator's seat.

---

## 8. Credential rotation

### 8.1 Object-storage key — safe, no re-upload

Rotating the access key changes nothing about the stored objects.

1. Create the new key on the same bucket with the same four permissions.
2. Update `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY` in the
   host's env file.
3. `docker compose -f docker-compose.prod.yml up -d backup-remote`
4. Confirm a new receipt appears within one `BACKUP_REMOTE_INTERVAL` after the
   next dump — `docker compose -f docker-compose.prod.yml logs --tail 20
   backup-remote` shows whether the poll succeeded.
5. Only then delete the old key.

### 8.2 Encryption passphrase — **not** safe on its own

Objects already in the bucket were encrypted with the old passphrase and
**cannot be read with the new one**. Changing the variable alone leaves you with
a bucket full of backups you cannot decrypt.

Either:

- **Keep the old passphrase archived** for as long as objects encrypted with it
  are inside the retention window (90 days for weekly), and record which is
  which; or
- **Re-upload the retained window** under the new passphrase, then delete the
  old objects.

Neither is scripted. Treat this as a planned maintenance task, not a routine
rotation. If the passphrase is believed compromised, remember the objects it
protects are already in someone else's storage.

### 8.3 `JWT_SECRET` — safe, logs everyone out

See §6.2. Update and `up -d api worker`.

### 8.4 `CLICK_SIGNING_SECRET` — destructive

See §6.3. Invalidates outstanding clicks and their pending conversions. T16
records the fix that would make this rotatable; it is not built.

### 8.5 Database password

Changing `POSTGRES_PASSWORD` requires changing it in Postgres as well —
the variable only sets it at first initialisation. Not scripted here.

---

## 9. What has actually been rehearsed

Not a list of what should work — a list of what has been executed at least once:

| Procedure | Where |
|---|---|
| Deploy, roll forward, roll back by SHA, with distinct image revisions | §1, §2 |
| A tag that was never built failing the deploy and leaving the stack untouched | §1.3 |
| Restore from a local dump into a separate database | §3.5 |
| Off-host upload, download, SHA-256 match, `pg_restore --list`, restore, balances unchanged — against the real external bucket | §3.6, §3.7 |
| Remote retention removing an aged object and keeping the current one | §3.7 |
| An upload failure leaving the verified local dump intact, with no receipt written | §3.7 |
| A healthy container made unhealthy, restarted by autoheal, returning healthy | §4 |
| An unlabelled unhealthy container **not** being restarted | §4.1 |
| The socket proxy refusing every call outside its two | §5 |
| Log rotation bounding a container's log under load | §7 |

Everything above was executed on development infrastructure except the off-host
backup verification, which ran against the real external bucket. **No procedure
in this runbook has been executed on a production host, because there is not one
yet.**
