import { FRAUD_REVIEW_DECISIONS } from '@gemone/contracts';
import type { FraudReviewDecision, FraudRuleId } from '@gemone/contracts';

/**
 * The fraud review screen's vocabulary — PROJECT.md §4.7.
 *
 * Pure, and holding **no fraud logic whatsoever**. The engine decided what to
 * hold and why; `resolveHold` decides what a decision does to the points and
 * refuses one on a conversion that is not held. What is left for this module is
 * saying it in English, which is the one job a browser can honestly do here.
 *
 * ## Why there are no risk bands
 *
 * `AdminHeldConversionSummary` carries a `fraudScore` and nothing that says
 * what a high one is. Thresholds are configured per rule and snapshotted onto
 * the evaluation (P3, DATABASE.md §3.6), so a "high / medium / low" band drawn
 * here would be a threshold this file invented — a fraud rule, written in a
 * presentation module, that no configuration could change and no audit trail
 * would record. The score is shown as the number it is, beside the rules that
 * produced it, which is what the operator actually reasons about.
 */

/** A `Badge` variant. Restated rather than imported, so this module depends on nothing. */
export type FraudTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

/**
 * What each rule looks at, in an operator's words.
 *
 * The identifiers are stable and stored (they are read back months later to
 * explain a hold), which is exactly why they are terse. These are the same
 * rules said in a sentence — and deliberately say *what was measured*, never
 * whether it was suspicious: how suspicious it is depends on the threshold
 * that applied at the time, which is on the evaluation and not here.
 */
const RULES: Record<FraudRuleId, string> = {
  USER_CONVERSION_VELOCITY: 'Conversions by this account in the window',
  IP_CONVERSION_VELOCITY: 'Conversions from this IP address in the window',
  SHARED_IP_ACCOUNTS: 'Accounts sharing this IP address',
  SHARED_DEVICE_ACCOUNTS: 'Accounts sharing this device',
  IMPOSSIBLE_TIMING: 'Completed faster than the offer allows',
  CHARGEBACK_RATE: 'Share of this account’s conversions later reversed',
  DISPOSABLE_EMAIL: 'Registered with a disposable email domain',
};

/**
 * The fallback exists because the rule id is a wire value.
 *
 * A newer API can fire a rule this build has never heard of, and rendering
 * `undefined` beside a held reward is worse than rendering the identifier —
 * which at least an operator can search for.
 */
export function ruleLabel(rule: FraudRuleId): string {
  return RULES[rule] ?? rule.replaceAll('_', ' ').toLowerCase();
}

export interface FraudDecision {
  decision: FraudReviewDecision;
  /** The SvelteKit action, which is the API endpoint's decision in lower case. */
  action: 'clear' | 'confirm';
  label: string;
  variant: 'primary' | 'danger';
  /** What this does to the points, said plainly before it is done. */
  hint: string;
}

/**
 * The two decisions the API accepts, and nothing else.
 *
 * There is no "leave it for later" button because leaving it is what happens
 * when nobody presses either of these, and no "escalate" because the API has
 * no such transition. A control that posts something the server will refuse is
 * a control that teaches an operator to distrust the screen.
 *
 * Both say what happens to the money, because both move it and in opposite
 * directions: one releases points the engine suspected, the other takes back
 * points a user was told they had earned.
 */
export const FRAUD_DECISIONS: FraudDecision[] = [
  {
    decision: FRAUD_REVIEW_DECISIONS.CLEAR,
    action: 'clear',
    label: 'Clear the hold',
    variant: 'primary',
    hint: 'Not fraud. The held points mature and become withdrawable.',
  },
  {
    decision: FRAUD_REVIEW_DECISIONS.CONFIRM,
    action: 'confirm',
    label: 'Confirm fraud',
    variant: 'danger',
    hint: 'Fraud. The credit is reversed and the points leave the balance.',
  },
];

/**
 * How long this account has been waiting, in whole days.
 *
 * The queue is worked oldest first (the API orders it that way) because a held
 * conversion is somebody who earned points and cannot spend them. Showing the
 * age is what makes that ordering visible instead of merely true.
 *
 * `now` is a parameter rather than `Date.now()`, for the reason
 * `$lib/rewards/ledger.ts` records: the page renders on the server and hydrates
 * in the browser, and a function reading its own clock disagrees with itself
 * across that boundary.
 */
export function waitingDays(iso: string, now: string): number {
  const since = Date.parse(iso);
  const reference = Date.parse(now);

  if (Number.isNaN(since) || Number.isNaN(reference)) return 0;

  return Math.max(0, Math.floor((reference - since) / 86_400_000));
}

/**
 * A queue entry's age, as a phrase.
 *
 * Held today is not an alarming fact and gets no emphasis; a hold that has sat
 * for a fortnight is the queue failing at its one job, and the caller decides
 * what to do with the tone.
 */
export function waitingLabel(iso: string, now: string): { text: string; tone: FraudTone } {
  const days = waitingDays(iso, now);

  if (days === 0) return { text: 'Held today', tone: 'neutral' };
  if (days === 1) return { text: 'Held yesterday', tone: 'neutral' };
  if (days < 7) return { text: `Held ${days} days ago`, tone: 'warning' };

  return { text: `Held ${days} days ago`, tone: 'error' };
}

/**
 * A user or conversion id, shortened for a table.
 *
 * The full value is what an operator pastes into a support ticket or another
 * screen, so it stays in the `title` and in the copy target — this is only
 * what a column can fit. Eight characters of a UUIDv7 is enough to tell two
 * rows apart at a glance, which is all a glance is for.
 */
export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}
