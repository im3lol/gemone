import type { RewardTransactionRecord, RewardTransactionType } from '@gemone/contracts';

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
 * ## Why the type names are written out rather than imported
 *
 * `@gemone/contracts` also exports `REWARD_TRANSACTION_TYPES`, a runtime
 * object, and importing it here **fails the production build**: the package
 * compiles to CommonJS and re-exports every module through `__exportStar`,
 * which Rollup cannot trace named values through when bundling this app's SSR
 * output. `svelte-check` and Vitest both resolve it happily, so the failure
 * arrives only at `vite build` — measured, not assumed. Recorded as TODO T79.
 *
 * Writing the literals costs nothing in safety. `Record<RewardTransactionType,
 * …>` is what actually guarantees these maps stay in step with the contract: a
 * new transaction type there is a compile error here, and a misspelt key is a
 * compile error too.
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
 * Every transaction type this module knows how to present.
 *
 * Derived from the map rather than written a third time, and correct by
 * construction: `Record<RewardTransactionType, …>` refuses a missing key and
 * an object literal refuses an extra one, so this array *is* the contract's
 * set. It exists so the tests can walk it — the alternative is a fourth copy
 * of the list that can rot.
 */
export const LEDGER_TYPES = Object.keys(LABELS) as RewardTransactionType[];

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
 * Which bucket these points are in **now**, derived from the record alone.
 *
 * The rules, and why each is what it is:
 *
 * - A credit that landed in `pending` is *Pending* — points exist but are
 *   inside the hold period. `maturesAt === null` means held indefinitely
 *   (ARCHITECTURE.md §9.4), which is still pending, not "never".
 * - A credit that landed straight in `available` is *Available*. That happens
 *   when the resolved hold period is zero.
 * - A maturation moved points between buckets and earned nobody anything; its
 *   amount is `0` and its status is *Cleared*.
 * - The three payout movements say what happened to a withdrawal.
 *
 * Nothing here consults the clock. A pending credit whose `maturesAt` has
 * passed is still shown as pending until a maturation transaction exists,
 * because the maturation is what actually moves the points — and a status that
 * disagreed with the balance would be the more confusing of the two lies.
 */
export function statusOf(record: RewardTransactionRecord): LedgerStatus {
  switch (record.type) {
    case 'CONVERSION_CREDIT':
    case 'BONUS':
      return record.pendingDelta > 0
        ? { label: 'Pending', tone: 'warning' }
        : { label: 'Available', tone: 'success' };

    case 'REWARD_MATURATION':
      return { label: 'Cleared', tone: 'success' };

    case 'CHARGEBACK_DEBIT':
      return { label: 'Reversed', tone: 'error' };

    case 'PAYOUT_LOCK':
      return { label: 'In review', tone: 'info' };

    case 'PAYOUT_SETTLE':
      return { label: 'Paid', tone: 'success' };

    case 'PAYOUT_REFUND':
      return { label: 'Returned', tone: 'neutral' };

    /*
     * An admin moved points by hand. It can add or remove, into any bucket,
     * so the status says only that a person did it — the amount's sign says
     * which way, and `reason` (mandatory on this type) says why.
     */
    case 'MANUAL_ADJUSTMENT':
      return { label: 'Adjusted', tone: 'neutral' };

    default:
      return { label: 'Recorded', tone: 'neutral' };
  }
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
