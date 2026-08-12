import {
  REWARD_STATUSES_IN_ORDER,
  REWARD_TRANSACTION_TYPES,
  rewardStatusOf,
} from '@gemone/contracts';
import type {
  RewardStatus,
  RewardTransactionRecord,
  RewardTransactionType,
} from '@gemone/contracts';

/**
 * Turning a ledger record into something a person can read.
 *
 * Pure functions, deliberately kept out of the components that call them. Every
 * one of these is a small judgement about what a movement of someone's money
 * *means*, and judgements about money belong somewhere they can be tested
 * against a record rather than eyeballed in a rendered table.
 *
 * **Nothing here invents a field.** `RewardTransactionRecord` carries a type,
 * an amount, three bucket deltas, a source, an optional reason, a maturity date
 * and a `sourceLabel` — and that is all this module is allowed to read.
 *
 * The label is what a movement was *called* when it happened: the offer's title
 * for a conversion credit, the payout method for a withdrawal (D85, D86). This
 * module never renders it — naming a movement's subject is the caller's, and
 * `StatementTable` does it — but it is why `describe` says only what *kind* of
 * thing happened.
 *
 * The keys below are still written out as literals rather than computed from
 * `REWARD_TRANSACTION_TYPES`, and that is not the old T79 workaround — it is
 * how `Record<RewardTransactionType, …>` earns its keep. A type added to the
 * contract becomes a compile error here, which is what forces someone to
 * *decide* what to call it. A map built by iterating the enum would silently
 * grow a row labelled with its own enum name.
 */

/** How a `Badge` should be toned for a derived status. */
export type LedgerTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface LedgerStatus {
  label: string;
  tone: LedgerTone;
}

/**
 * What happened, in the user's vocabulary.
 *
 * The enum names are the domain's ("CONVERSION_CREDIT"), and showing them raw
 * is what the pre-redesign page did. These are the same events said in the
 * words someone would use about their own account.
 *
 * **These say what happened, never to what.** "Offer completed" is the kind of
 * event; which offer is `sourceLabel`, rendered on its own line by whatever
 * lists the rows. Keeping the two apart is what lets a movement with no label —
 * a manual adjustment, or a row written before the column existed — still read
 * as a sentence.
 */
const LABELS: Record<RewardTransactionType, string> = {
  CONVERSION_CREDIT: 'Offer completed',
  CHARGEBACK_DEBIT: 'Reward reversed',
  REWARD_MATURATION: 'Points cleared',
  PAYOUT_LOCK: 'Withdrawal requested',
  PAYOUT_SETTLE: 'Withdrawal paid',
  PAYOUT_REFUND: 'Withdrawal returned',
  MANUAL_ADJUSTMENT: 'Manual adjustment',
  BONUS: 'Bonus',
};

/**
 * The icon glyph per movement — DESIGN_SYSTEM.md §16.4.
 *
 * Legacy keys its activity icons off an offer *category* (survey, video, app
 * install). We do not have the category on a ledger row, so these key off the
 * movement instead. Same treatment, different fact.
 */
const GLYPHS: Record<RewardTransactionType, string> = {
  CONVERSION_CREDIT: '🎯',
  CHARGEBACK_DEBIT: '↩️',
  REWARD_MATURATION: '✅',
  PAYOUT_LOCK: '🔒',
  PAYOUT_SETTLE: '💸',
  PAYOUT_REFUND: '↩️',
  MANUAL_ADJUSTMENT: '⚙️',
  BONUS: '🎁',
};

/**
 * Every transaction type, from the contract itself.
 *
 * `Object.keys(LABELS) as RewardTransactionType[]` is what this was while the
 * contracts package could not be imported for a value — an assertion that the
 * compiler took on trust, because `Object.keys` returns `string[]` no matter
 * what it is given. Reading the enum directly needs no cast: the array *is*
 * the contract's set, and the `Record` above still fails the build if a label
 * is missing for one of them.
 */
export const LEDGER_TYPES: RewardTransactionType[] = Object.values(REWARD_TRANSACTION_TYPES);

/**
 * The fallbacks exist because the type is a wire value.
 *
 * The union is closed in the contract, and a running API is still free to send
 * a value this build has never heard of — a newer server, a replayed record.
 * A lookup that returned `undefined` would render "undefined" into a table of
 * someone's money.
 */
export function describe(type: RewardTransactionType): string {
  return LABELS[type] ?? 'Account movement';
}

export function glyph(type: RewardTransactionType): string {
  return GLYPHS[type] ?? '✨';
}

/**
 * What each derived status is called, and how it is toned.
 *
 * The *rule* — which type and which bucket delta make a movement "Pending" —
 * lives in `@gemone/contracts`, because the API filters on it and a rule the
 * two sides each wrote for themselves is a rule they can disagree about
 * (TODO T80). What is left here is the vocabulary, which is this module's
 * business: `IN_REVIEW` is the domain's word and "In review" is the user's.
 */
const STATUSES: Record<RewardStatus, LedgerStatus> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  AVAILABLE: { label: 'Available', tone: 'success' },
  CLEARED: { label: 'Cleared', tone: 'success' },
  REVERSED: { label: 'Reversed', tone: 'error' },
  IN_REVIEW: { label: 'In review', tone: 'info' },
  PAID: { label: 'Paid', tone: 'success' },
  RETURNED: { label: 'Returned', tone: 'neutral' },
  /*
   * An admin moved points by hand. It can add or remove, into any bucket, so
   * the status says only that a person did it — the amount's sign says which
   * way, and `reason` (mandatory on this type) says why.
   */
  ADJUSTED: { label: 'Adjusted', tone: 'neutral' },
};

/** Every status, in the order the filter lists them. */
export const LEDGER_STATUSES: RewardStatus[] = REWARD_STATUSES_IN_ORDER;

export function statusLabel(status: RewardStatus): string {
  return STATUSES[status]?.label ?? 'Recorded';
}

/**
 * Which bucket these points are in **now**, derived from the record alone.
 *
 * The derivation is `rewardStatusOf` in the contract — the same function the
 * API's `where` clause is built from, so a row shown as "Pending" here is a row
 * `?status=PENDING` returns. Before T80 this was a `switch` in this file and
 * the API had no opinion at all, which is exactly why the filter could not be
 * server-side.
 *
 * `null` — a type this build has never heard of — becomes "Recorded". The
 * fallback stays because the type is a wire value: a newer server, a replayed
 * record. Rendering "undefined" into a table of someone's money is the
 * alternative.
 */
export function statusOf(record: RewardTransactionRecord): LedgerStatus {
  const status = rewardStatusOf(record);

  return (status && STATUSES[status]) ?? { label: 'Recorded', tone: 'neutral' };
}

/**
 * Points, grouped, with an explicit sign on anything that moved.
 *
 * `en-US` rather than the visitor's locale, matching the topbar's pill: the
 * whole interface is in English and a number formatted for one locale beside
 * labels written for another looks like a bug. A maturation is `0` and gets no
 * sign, because nothing was earned or lost.
 */
export function formatPoints(points: number, { signed = false } = {}): string {
  const body = Math.abs(points).toLocaleString('en-US');

  if (!signed || points === 0) return points < 0 ? `-${body}` : body;

  return `${points > 0 ? '+' : '-'}${body}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative time, hand-written — DESIGN_SYSTEM.md §16.4.
 *
 * Legacy writes its own and so does this: `Intl.RelativeTimeFormat` would be
 * the right tool for a localised product, and this one is English-only by
 * design, so a dependency-free ladder is both smaller and closer to the
 * documented strings.
 *
 * **`now` is a parameter, not `Date.now()`.** The page renders on the server
 * and then hydrates in the browser; a function that read its own clock would
 * produce "4 minutes ago" server-side and "5 minutes ago" a moment later,
 * which is a hydration mismatch on every row that happens to straddle a
 * boundary. The load passes one timestamp and both renders agree.
 *
 * Beyond a week it falls back to an absolute date: "6 days ago" is useful,
 * "83 days ago" is arithmetic homework.
 */
export function relativeTime(iso: string, now: string): string {
  const then = Date.parse(iso);
  const reference = Date.parse(now);

  if (Number.isNaN(then) || Number.isNaN(reference)) return '';

  const elapsed = reference - then;

  // A clock skew between the API and this process can put an event in the
  // future by a second or two. "in 2 seconds" is worse than "just now".
  if (elapsed < MINUTE) return 'just now';

  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(elapsed / DAY);

  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return absoluteDate(iso);
}

/** `11 Aug 2026` — unambiguous in both date conventions, unlike `08/11`. */
export function absoluteDate(iso: string): string {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) return '';

  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
