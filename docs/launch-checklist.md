# Launch Checklist (Phase 10)

## Technical (done / in code)
- [x] Public site with real content (landing, auth, dashboard, offerwall, withdraw).
- [x] Legal pages: `/terms`, `/privacy`, `/cookies` (footer-linked). ⚠️ have counsel review.
- [x] Kill-switch to halt withdrawals during an incident (`/admin/kill-switch`).
- [x] Incident-response runbook (`docs/incident-response.md`).
- [x] Load test for the postback path (`load/postback.js`, run with k6).
- [x] Monitoring + alerts (Prometheus, `/metrics`, `/health`).
- [ ] Run the k6 load test against staging; confirm p95 < 500ms, error rate < 1%.
- [ ] Restore a DB backup into a scratch instance (verify backups actually work).

## Network approvals (manual, external)
- [ ] Apply to offer networks (AdGem, CPX, Torox, …) — requires the live site + legal pages.
- [ ] Configure each network's postback URL → `https://<api>/postback/<provider>` and set the real secret.
- [ ] Swap each adapter's mock `fetchOffers` for the real Offer API call + credentials.

## Payments, legal & tax (manual, external)
- [ ] Set up receiving earnings from networks (bank / PayPal / Payoneer).
- [ ] Fund + configure payout providers (PayPal Payouts, Reloadly) with real credentials in Secret Manager.
- [ ] Confirm tax obligations (1099/VAT/etc.) and any KYC thresholds for payouts.

## Rollout
- [ ] Cloudflare in front (WAF + DDoS + CDN); point DNS.
- [ ] Limited **beta** (allowlist / invite codes) before full open.
- [ ] On-call rotation + alert routing (Alertmanager / PagerDuty).
- [ ] Go/no-go review against this list.
