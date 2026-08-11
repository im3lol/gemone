import type { PayoutStatus } from '@gemone/contracts';

/**
 * Turning a withdrawal into something a person can read.
 *
 * The counterpart of `$lib/rewards/ledger.ts`, and pure for the same reason:
 * every function here is a small judgement about someone's money, and those
 * belong somewhere a test can hold them to a record instead of somewhere they
 * get eyeballed in a rendered table.
 *
 * **Nothing here invents a number.** The rate, the currency and the limits all
 * arrive from `GET /payouts/options`, which reads the configuration the API
 * itself enforces. This module multiplies and formats; it never supplies a
 * default for a value the server did not send.
 *
 * ## Why the status names are written out rather than imported
 *
 * `@gemone/contracts` exports `PAYOUT_STATUSES` as a runtime object, and
 * importing it breaks `vite build` — the package compiles to CommonJS and
 * re-exports through `__exportStar`, which Rollup cannot trace named values
 * through (TODO T79, re-confirmed in phase 5). `Record<PayoutStatus, …>` is
 * what keeps these maps honest anyway: a status added to the contract is a
 * compile error here, and a misspelt one is too.
 */

/** A `Badge` variant. Restated rather than imported, so this module depends on nothing. */
export type PayoutTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface PayoutState {
  label: string;
  tone: PayoutTone;
  /** One line saying what happens next, or what happened. */
  hint: string;
}

/**
 * The five states of ARCHITECTURE.md §11.1, in the user's vocabulary.
 *
 * `APPROVED` is the one worth being careful with: internally it means an admin
 * said yes and the money has **not** moved yet, and calling it "Approved" on a
 * user's screen invites them to check their account for a payment nobody has
 * sent. "Being paid" is what is actually true between approval and settlement.
 */
const STATES: Record<PayoutStatus, PayoutState> = {
  PENDING_REVIEW: {
    label: 'In review',
    tone: 'info',
    hint: 'Waiting for a person to check it. Your points stay reserved until then.',
  },
  APPROVED: {
    label: 'Being paid',
    tone: 'info',
    hint: 'Approved and queued for payment. Your points are still reserved.',
  },
  PAID: {
    label: 'Paid',
    tone: 'success',
    hint: 'Sent to the account below.',
  },
  REJECTED: {
    label: 'Rejected',
    tone: 'error',
    hint: 'The points went back to your available balance.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'error',
    hint: 'The payment did not go through. The points went back to your available balance.',
  },
};

/**
 * The fallback exists because the status is a wire value.
 *
 * The union is closed in the contract and a running API is still free to send
 * something this build has never heard of — a newer server, a replayed record.
 * A lookup returning `undefined` would render "undefined" beside an amount of
 * someone's money.
 */
export function payoutState(status: PayoutStatus): PayoutState {
  return STATES[status] ?? { label: 'Recorded', tone: 'neutral', hint: '' };
}

/**
 * Method slugs the product knows how to spell.
 *
 * **Display only, and it must stay that way.** PROJECT.md §4.6 requires that
 * enabling a payment method takes one configuration edit and no deployment, so
 * an unknown slug has to render as something reasonable rather than as
 * nothing — `skrill` becomes "Skrill" and works on the day it is enabled. This
 * map exists only because "Paypal" is the wrong way to write PayPal.
 */
const METHOD_NAMES: Record<string, string> = {
  paypal: 'PayPal',
};

export function methodName(method: string): string {
  return (
    METHOD_NAMES[method] ??
    method
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

/**
 * Points to money, in minor units — the same arithmetic the API applies.
 *
 * Deliberately a copy of `toCashMinor` in `payouts.service.ts`, integer
 * division and rounding **down** included. The form quotes a figure before
 * anything is submitted, and the request that comes back carries the server's
 * own; if the two disagreed by a cent the page would be advertising a price
 * the system does not honour. An integration test pins them together.
 *
 * The API is still the authority — this is a preview, and the value stored on
 * the request is the one that counts.
 */
export function cashMinorFor(points: number, pointsPerCurrencyUnit: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  if (!Number.isFinite(pointsPerCurrencyUnit) || pointsPerCurrencyUnit <= 0) return 0;

  return Math.floor((points * 100) / pointsPerCurrencyUnit);
}

/**
 * Minor units as money — `500` and `USD` become `$5.00`.
 *
 * Two decimals because the API's own conversion divides by 100 unconditionally.
 * A zero-decimal currency would need the server to agree first, so following it
 * here keeps one convention rather than two that disagree at the boundary.
 *
 * `Intl` throws on a currency code it does not recognise, and the code comes
 * from configuration an admin types. A withdrawal screen that blanks out
 * because someone set an odd currency is worse than one that prints the amount
 * with the code beside it.
 */
export function formatCash(minorUnits: number, currency: string): string {
  const amount = minorUnits / 100;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** `≈ $5.00` — the preview form, marked as the approximation it is. */
export function approxCash(points: number, pointsPerCurrencyUnit: number, currency: string): string {
  return `≈ ${formatCash(cashMinorFor(points, pointsPerCurrencyUnit), currency)}`;
}

/**
 * What a rate looks like wherever one is quoted — the subset of `PayoutOptions`
 * every screen that shows money actually reads.
 *
 * A structural type, so `PayoutOptions` satisfies it as-is: the layout loads
 * the whole thing once and each screen passes it straight through. Null when
 * `GET /payouts/options` failed.
 */
export type PointsRate = { pointsPerCurrencyUnit: number; currency: string } | null;

/**
 * The caption under a points figure — `points` or `points · ≈ $15.40 USD`.
 *
 * One function because four screens quote the same thing and they must quote it
 * identically: the dashboard's four buckets, the statement's three, the wall's
 * cards and the withdrawal form. Written seven times by hand, one of them would
 * eventually drift.
 *
 * **The rate is never defaulted.** A null one — the options call failed — means
 * the cash half is simply absent, which is D86's rule: an invented rate on a
 * balance screen is a number people plan around.
 *
 * `points` is optional so the caption can be built for a figure that is unknown
 * (`—`), where a cash equivalent would be a claim about a number nobody has.
 */
export function pointsUnit(
  points: number | undefined,
  rate: PointsRate,
  { suffix = '' } = {},
): string {
  const base = `points${suffix}`;

  if (!rate || points === undefined) return base;

  return `${base} · ${approxCash(points, rate.pointsPerCurrencyUnit, rate.currency)} ${rate.currency}`;
}

/**
 * A quotable handle on one request.
 *
 * The id is a UUIDv7, whose leading characters are a timestamp — two requests
 * made in the same second share them. The trailing characters are the random
 * part, so the tail is what actually distinguishes one request from another
 * when somebody reads it out to support.
 */
export function payoutReference(id: string): string {
  return id.replace(/-/g, '').slice(-8).toUpperCase();
}
