import { PAYOUT_STATUSES } from '@gemone/contracts';
import type { PayoutStatus } from '@gemone/contracts';

/**
 * The payout queue, in an administrator's vocabulary.
 *
 * Deliberately **not** `$lib/payouts/payout.ts`. That module says what a
 * withdrawal means to the person waiting for the money — `APPROVED` is "Being
 * paid" there, because telling a user "Approved" invites them to go looking
 * for a payment nobody has sent. An admin is the person who has not sent it
 * yet, and for them the state machine's own name is the accurate one.
 *
 * Two vocabularies for one enum is not duplication; it is the reason the enum
 * is not a label.
 *
 * The map keys stay literal so `Record<PayoutStatus, …>` can refuse an
 * incomplete map: a status added to the state machine has to be given an
 * admin's word for it here before this compiles.
 */

/** A `Badge` variant. Restated rather than imported, so this module depends on nothing. */
export type QueueTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export interface QueueState {
  label: string;
  tone: QueueTone;
  /** What the admin is expected to do next, or what already happened. */
  hint: string;
}

const STATES: Record<PayoutStatus, QueueState> = {
  PENDING_REVIEW: {
    label: 'Pending review',
    tone: 'warning',
    hint: 'Waiting for a decision. The points are reserved.',
  },
  APPROVED: {
    label: 'Approved',
    tone: 'info',
    hint: 'Approved and not yet sent. Send the money, then record the reference here.',
  },
  PAID: {
    label: 'Paid',
    tone: 'success',
    hint: 'Sent, with a reference on file. The reserved points were consumed.',
  },
  REJECTED: {
    label: 'Rejected',
    tone: 'error',
    hint: 'Refused. The points went back to the account.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'error',
    hint: 'The payment did not go through. The points went back to the account.',
  },
};

export const PAYOUT_STATUSES_IN_QUEUE_ORDER: PayoutStatus[] = Object.values(PAYOUT_STATUSES);

/**
 * The fallback exists because the status is a wire value — a newer server, a
 * replayed record. A lookup returning `undefined` would render "undefined"
 * beside somebody's money.
 */
export function queueState(status: PayoutStatus): QueueState {
  return STATES[status] ?? { label: 'Recorded', tone: 'neutral', hint: '' };
}

/**
 * One action an admin can take, mirroring one API endpoint.
 *
 * `action` is the SvelteKit form action, which is named after the endpoint it
 * posts to — `?/approve` → `POST /admin/payouts/:id/approve`. One name for one
 * transition, all the way through.
 */
export interface QueueAction {
  action: 'approve' | 'reject' | 'settle' | 'fail';
  label: string;
  /** The `Button` variant. Refusals are not primary actions. */
  variant: 'primary' | 'secondary' | 'danger';
  /** Named field the API requires, if any. */
  field?: { name: 'reason' | 'externalReference'; label: string; hint: string };
}

/**
 * What may be done from each state — **a mirror of the server's machine, not a
 * second copy of it.**
 *
 * `payout-state-machine.ts` is the authority: `PENDING_REVIEW → APPROVED |
 * REJECTED`, `APPROVED → PAID | FAILED`, and `PAID`, `REJECTED`, `FAILED` are
 * terminal. This renders the buttons for exactly those edges and no others.
 *
 * The distinction matters because it decides what happens when the two
 * disagree. This table never *permits* anything: a button it renders in error
 * still reaches `assertTransition`, which answers 409 and the page shows the
 * message. What it prevents is offering a button that is certain to fail —
 * which is a different job from enforcement, and the only one a browser can
 * honestly do.
 *
 * It is also the first line against a double submission: a request already
 * approved renders no Approve button on reload. The real guard is the row lock
 * and the machine behind it, because two admins can hold two open tabs.
 */
const ACTIONS: Record<PayoutStatus, QueueAction[]> = {
  PENDING_REVIEW: [
    {
      action: 'approve',
      label: 'Approve',
      variant: 'primary',
      field: {
        name: 'reason',
        label: 'Note (optional)',
        hint: 'Approving is the expected outcome and needs no defence. Anything here is kept on the audit entry.',
      },
    },
    {
      action: 'reject',
      label: 'Reject',
      variant: 'danger',
      field: {
        name: 'reason',
        label: 'Reason',
        hint: 'Required, and shown to the user. Refusing someone their money without saying why is the support ticket this field exists to prevent.',
      },
    },
  ],

  APPROVED: [
    {
      action: 'settle',
      label: 'Mark paid',
      variant: 'primary',
      field: {
        name: 'externalReference',
        label: 'Payment reference',
        hint: 'Required. The bank reference or transaction id the money actually moved under — it is the only evidence that exists when a user says they never received anything.',
      },
    },
    {
      action: 'fail',
      label: 'Payment failed',
      variant: 'secondary',
      field: {
        name: 'reason',
        label: 'What went wrong',
        hint: 'Required. Distinct from a rejection: a rejection is a decision about the account, a failure is a fact about the payment.',
      },
    },
  ],

  PAID: [],
  REJECTED: [],
  FAILED: [],
};

export function actionsFor(status: PayoutStatus): QueueAction[] {
  return ACTIONS[status] ?? [];
}

/** `019ff2b1…4642e60a` → `4642E60A`. The tail of a UUIDv7 is its random part. */
export function payoutReference(id: string): string {
  return id.replace(/-/g, '').slice(-8).toUpperCase();
}

/**
 * A handle for the account a request belongs to.
 *
 * **The queue carries no email and no name.** `AdminPayoutSummary` has a
 * `userId` and nothing else about the person, which is the same allowlisting
 * that keeps payment destinations out of list responses (DATABASE.md §3.5).
 * So the queue shows a short, quotable form of the id — enough to tell two
 * rows apart and to read out loud, and not an identity.
 *
 * What an admin actually decides on is on the detail view: account age, status,
 * conversion and chargeback counts, balances, and the fraud signals. Those are
 * facts about behaviour, which is what a payout review is about.
 */
export function accountReference(userId: string): string {
  return payoutReference(userId);
}
