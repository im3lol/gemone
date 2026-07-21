# Incident Response Runbook

Fast reference for suspected fraud, exploitation, or payout incidents. When in
doubt, **halt withdrawals first, investigate second** — points can be re-credited,
money sent out cannot be recalled.

## 1. Halt withdrawals immediately (kill-switch)

The kill-switch blocks new withdrawal requests and pauses the payout queue
(shared via Redis, so it applies to every api + worker instance at once).

```bash
# engage (admin token required)
curl -X POST https://<api>/admin/kill-switch \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"halted": true}'

# check state
curl https://<api>/admin/kill-switch -H "authorization: Bearer $ADMIN_TOKEN"

# release once safe
curl -X POST https://<api>/admin/kill-switch -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" -d '{"halted": false}'
```

While halted: `POST /withdrawals` returns 503; queued payout jobs wait (they are
not lost) and resume when released.

## 2. Triage

- **Metrics** (`/metrics`, Prometheus/alerts): `gemone_payout_failures_total`,
  `gemone_reversals_total`, `gemone_payout_queue_depth`.
- **Fraud**: `GET /admin/fraud/logs` and `/admin/fraud/flagged`. Suspend abusers
  via `POST /admin/fraud/users/:id/status {"status":"SUSPENDED"}`.
- **Withdrawals**: `GET /admin/withdrawals` — reject suspicious pending payouts
  (refunds the points).

## 3. Contain

- Suspend implicated accounts (blocks their withdrawals; flagged accounts are
  already forced to manual review).
- If a provider integration is compromised, rotate its postback secret in Secret
  Manager and redeploy — signature verification then rejects old/forged calls.

## 4. Recover

- Reconcile: the nightly job asserts `wallet.balance == Σ ledger`. Run/inspect it
  after cleanup; investigate any drift.
- Release the kill-switch only after the root cause is contained.

## 5. Post-incident

- Write a short timeline + root cause.
- Add/adjust a fraud rule or Prometheus alert so it is caught automatically next time.
