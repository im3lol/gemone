# Infrastructure & Deployment

Target: **GCP Cloud Run** (API + worker + web), **Cloud SQL Postgres 16** (+ read
replica + PITR backups), **Memorystore Redis**, all defined in Terraform. Not
Kubernetes — Cloud Run scales the stateless containers and the worker runs as an
always-on service.

## Layout
- `terraform/` — IaC for the whole stack (network, DB + replica, Redis, Artifact
  Registry, Secret Manager, Cloud Run api/worker/web).
- CI/CD lives in `.github/workflows/`: `ci.yml` (test + build) and `deploy.yml`
  (build/push → staging → **manual-approval** production).

## Worker separation
Same image, two run modes (see `docker-compose.yml` locally and the Cloud Run
services in Terraform):
- **api** → `node dist/main.js`, `RUN_WORKERS=false` (enqueues only).
- **worker** → `node dist/worker.js`, `RUN_WORKERS=true`, CPU always allocated
  (`cpu_idle=false`), min 1 instance. Scales independently of the API.

## Migrations
`prisma migrate deploy` runs as a one-shot Cloud Run **job** before each rollout
(never on the worker). The api container also runs it on boot for local/compose.

## First-time apply (manual, once)
```
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in project + secrets
terraform init
terraform apply
```
Then set the GitHub repo secrets/vars used by `deploy.yml`:
`GCP_PROJECT`, `GCP_REGION` (vars); `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA` (secrets),
and configure the **production** environment with required reviewers.

## Still external (not in code)
Cloudflare (WAF/DDoS/CDN) in front, DNS, Grafana dashboards, and populating the
real provider/PayPal/Reloadly secrets in Secret Manager.
