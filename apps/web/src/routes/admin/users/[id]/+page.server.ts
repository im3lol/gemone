import { fail, redirect } from '@sveltejs/kit';
import type {
  AdminConversionSummary,
  AdminPayoutSummary,
  AdminUserSummary,
  AuditLogEntry,
  Paginated,
  UserFraudSignals,
  UserStatus,
} from '@gemone/contracts';

import type { AccountActivity } from '$lib/components/admin';
import { USER_STATUSES_IN_ORDER } from '$lib/admin/users';
import { apiAuthed, apiAuthedJson, apiPath, readFailure, type ApiFailure } from '$lib/server/api';
import { failedDetailLoad } from '$lib/server/detail';
import { nowIso } from '$lib/time';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** Enough of each list to see a pattern. The dedicated screens hold the rest. */
const ACTIVITY_LIMIT = 5;

/** What a bad account id is told — TODO T86, and the same two sentences. */
const NOT_FOUND = {
  malformed: 'That is not an account id. Check the value you pasted into the address bar.',
  missing: 'No account has that id.',
};

/**
 * One account, and what an administrator decides on — ARCHITECTURE.md §8.4.
 *
 * ## Composed from existing endpoints, and no new one
 *
 * `admin` is a composition layer (§4.3) and so is this page. The account
 * itself is `GET /admin/users/:id`; the rest is what other admin surfaces
 * already expose about a user, asked for with the `userId` filter each of them
 * already has — payouts, conversions, fraud signals, and the audit trail of
 * what administrators have done to this account. Nothing was added to the API
 * for this screen.
 *
 * ## What is not here, and why
 *
 * **The balance.** No admin endpoint returns an arbitrary user's three
 * buckets: `GET /rewards/balance` is the owner's own, and the only admin path
 * to somebody else's is `PayoutReviewContext`, bundled into a payout detail.
 * The number is therefore absent rather than approximated from the conversions
 * below — a sum of reward amounts is not a balance, it ignores maturation,
 * chargebacks and locks. Recorded as TODO T84.
 *
 * ## Awaited, not streamed
 *
 * Unlike the queue screens, the account *is* the page: there is no frame to
 * paint around it and nothing useful to show while it is missing. The five
 * calls go out together, and the four secondary ones degrade to `null` on
 * failure rather than taking the page down — an audit-log endpoint having a
 * bad minute should not stop an admin suspending an account.
 */
export const load: PageServerLoad = async (event) => {
  const { params } = event;

  /*
   * Built with `URLSearchParams` rather than interpolated — TODO T86. An id
   * containing `&` or `#` would otherwise add or truncate parameters on four of
   * these five calls, and `apiPath` only guards the path.
   */
  const forAccount = (extra: Record<string, string>) =>
    new URLSearchParams({ ...extra, limit: String(ACTIVITY_LIMIT) }).toString();

  const [account, payouts, conversions, signals, auditLog] = await Promise.all([
    apiAuthedJson<AdminUserSummary>(event, apiPath`/admin/users/${params.id}`),
    apiAuthedJson<Paginated<AdminPayoutSummary>>(
      event,
      `/admin/payouts?${forAccount({ userId: params.id })}`,
    ),
    apiAuthedJson<Paginated<AdminConversionSummary>>(
      event,
      `/admin/conversions?${forAccount({ userId: params.id })}`,
    ),
    apiAuthedJson<UserFraudSignals>(event, apiPath`/admin/fraud/users/${params.id}/signals`),
    apiAuthedJson<Paginated<AuditLogEntry>>(
      event,
      `/admin/audit-log?${forAccount({ targetType: 'user', targetId: params.id })}`,
    ),
  ]);

  if (!account.ok) failedDetailLoad(account.failure, NOT_FOUND);

  const activity: AccountActivity = {
    payouts: payouts.ok ? payouts.value : null,
    conversions: conversions.ok ? conversions.value : null,
    signals: signals.ok ? signals.value : null,
    auditLog: auditLog.ok ? auditLog.value : null,
  };

  return { account: account.value, activity, now: nowIso() };
};

/**
 * Two actions, because the API has two.
 *
 * `PATCH /admin/users/:id/status` and `POST /admin/users/:id/revoke-sessions`,
 * both taking a mandatory reason of at least eight characters. Neither rule is
 * restated here: the minimum length, the closed set of statuses and the
 * refusal to let an admin change their own standing all live in the API, and
 * its message is what the operator reads.
 *
 * **There is deliberately no role change.** `ADMIN_ACTIONS.USER_ROLE_CHANGED`
 * exists in the audit vocabulary and no endpoint writes it — promoting an
 * account is `create-admin.js`, by design (§8.4). A screen that offered it
 * would have to invent what it means. Recorded as TODO T85.
 */
async function call(
  event: RequestEvent,
  action: 'status' | 'revoke',
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  message: string,
) {
  const result = await apiAuthed(event, path, { method, body: JSON.stringify(body) });

  if (!result.ok) {
    if (result.failure.status === 401) redirect(303, '/login');
    return fail(result.failure.status, {
      ok: false as const,
      action,
      message: reason(result.failure),
    });
  }

  if (!result.value.ok) {
    const failure = await readFailure(result.value);

    if (failure.status === 401) redirect(303, '/login');
    return fail(failure.status, { ok: false as const, action, message: reason(failure) });
  }

  return { ok: true as const, action, message };
}

/**
 * The most specific thing the API said.
 *
 * A validation failure's envelope message is "Validation failed" and the
 * sentence worth reading is on the field — a short reason is answered with
 * *"must explain the change in at least 8 characters"*, and showing the
 * envelope instead tells an operator something was wrong without saying what.
 * The same helper the provider screen uses, for the same reason.
 */
function reason(failure: ApiFailure): string {
  const fields = failure.fields ?? [];
  if (fields.length === 0) return failure.message;

  return fields.map((field) => `${field.field}: ${field.message}`).join('; ');
}

const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

/** Only a status the contract defines is forwarded; anything else is a 422 worth avoiding. */
function readStatus(raw: string): UserStatus | null {
  return USER_STATUSES_IN_ORDER.includes(raw as UserStatus) ? (raw as UserStatus) : null;
}

export const actions = {
  status: async (event) => {
    const form = await event.request.formData();
    const status = readStatus(field(form, 'status'));

    if (!status) {
      return fail(422, {
        ok: false as const,
        action: 'status' as const,
        message: 'That is not a status this build knows about.',
      });
    }

    return call(
      event,
      'status',
      apiPath`/admin/users/${event.params.id}/status`,
      'PATCH',
      { status, reason: field(form, 'reason') },
      `The account is now ${status.toLowerCase()}. Any session it held has been ended.`,
    );
  },

  revoke: async (event) => {
    const form = await event.request.formData();

    return call(
      event,
      'revoke',
      apiPath`/admin/users/${event.params.id}/revoke-sessions`,
      'POST',
      { reason: field(form, 'reason') },
      'Every session was ended. The account can sign in again.',
    );
  },
} satisfies Actions;

export const __testing = { readStatus, reason, ACTIVITY_LIMIT };
