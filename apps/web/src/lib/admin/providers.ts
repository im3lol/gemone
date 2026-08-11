import type { ProviderHealthState, SyncOutcome } from '@gemone/contracts';

/**
 * The provider screen's vocabulary — ARCHITECTURE.md §7.
 *
 * Pure, and holding no knowledge of any concrete network. Nothing in this file
 * names AdGem or Torox or the mock, which is P1 carried through to the pixels:
 * an operator screen that branched on a slug would be the exact branch §5 rule
 * 7 forbids.
 *
 * ## Why the state names are written out rather than imported
 *
 * `@gemone/contracts` exports `PROVIDER_HEALTH_STATES` and `SYNC_OUTCOMES` as
 * runtime objects, and importing either breaks `vite build` — the package
 * compiles to CommonJS and re-exports through `__exportStar`, which Rollup
 * cannot trace named values through (TODO T79). `Record<…, …>` keeps these
 * maps in step with the contract regardless.
 */

/** A `Badge` variant. Restated rather than imported, so this module depends on nothing. */
export type ProviderTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export interface ProviderState {
  label: string;
  tone: ProviderTone;
  hint: string;
}

/**
 * Health, which is **a signal and not a switch** — the distinction the contract
 * is emphatic about.
 *
 * `DOWN` does not stop a provider being called. Auto-disabling on poor health
 * would be a trap: nothing would then call the provider, so nothing would ever
 * record a success, and it could never recover. These hints say so, because an
 * operator seeing a red badge next to an enabled provider will otherwise assume
 * one of the two is wrong.
 */
const HEALTH: Record<ProviderHealthState, ProviderState> = {
  HEALTHY: {
    label: 'Healthy',
    tone: 'success',
    hint: 'Recent calls succeeded.',
  },
  DEGRADED: {
    label: 'Degraded',
    tone: 'warning',
    hint: 'Some recent calls failed. The provider is still being called.',
  },
  DOWN: {
    label: 'Down',
    tone: 'error',
    hint: 'Recent calls have been failing. This is a signal, not a switch — the provider is still being called, which is how it can recover on its own.',
  },
};

export function healthState(state: ProviderHealthState): ProviderState {
  return HEALTH[state] ?? { label: 'Unknown', tone: 'neutral', hint: '' };
}

/**
 * What a synchronization run ended as.
 *
 * `RUNNING` is a real outcome and not a placeholder: the row is written before
 * the work starts, deliberately, so a run that crashed is visible rather than
 * absent (`offers.ts`). A long-running `RUNNING` is therefore information.
 */
const OUTCOMES: Record<SyncOutcome, ProviderState> = {
  RUNNING: {
    label: 'Running',
    tone: 'info',
    hint: 'Started. The row is written before the work begins, so a crashed run stays visible.',
  },
  SUCCESS: {
    label: 'Succeeded',
    tone: 'success',
    hint: 'The catalog was fetched and applied.',
  },
  PARTIAL: {
    label: 'Partial',
    tone: 'warning',
    hint: 'Completed, but something was skipped — most often a refused prune.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'error',
    hint: 'The run did not complete. The previous catalog is untouched.',
  },
};

export function syncOutcome(outcome: SyncOutcome): ProviderState {
  return OUTCOMES[outcome] ?? { label: 'Recorded', tone: 'neutral', hint: '' };
}

/**
 * Capabilities, in words — ARCHITECTURE.md §7.1.
 *
 * The first four are mandatory for every adapter; the rest are what capability
 * discovery exists for, so a caller can ask whether a provider supports
 * reversals instead of branching on its slug.
 *
 * A plain `Record<string, string>`, not `Record<ProviderCapability, …>`: this
 * list is a *declaration by an adapter*, so a build can legitimately report a
 * capability this one has never heard of. The fallback renders the raw value
 * readably rather than dropping it.
 */
const CAPABILITIES: Record<string, string> = {
  fetch_offers: 'Fetch offers',
  build_click_url: 'Build click URLs',
  verify_postback: 'Verify postbacks',
  parse_postback: 'Parse postbacks',
  reversals: 'Reversals',
  offer_targeting: 'Offer targeting',
};

export function capabilityLabel(capability: string): string {
  return CAPABILITIES[capability] ?? capability.replaceAll('_', ' ');
}

/** The two sync modes, and the difference that actually matters. */
export const SYNC_MODES_IN_ORDER = ['INCREMENTAL', 'FULL'] as const;

export type SyncModeChoice = (typeof SYNC_MODES_IN_ORDER)[number];

const MODES: Record<SyncModeChoice, { label: string; hint: string }> = {
  INCREMENTAL: {
    label: 'Incremental',
    hint: 'Fetch and upsert. Never deactivates anything.',
  },
  FULL: {
    label: 'Full',
    hint: 'Fetch, upsert, and deactivate whatever this run did not see. Only safe when absence is meaningful.',
  },
};

export function syncModeLabel(mode: SyncModeChoice): string {
  return MODES[mode]?.label ?? mode;
}

export function syncModeHint(mode: SyncModeChoice): string {
  return MODES[mode]?.hint ?? '';
}

/**
 * `45` → `45 minutes`, `90` → `1 hour 30 minutes`, `1440` → `1 day`.
 *
 * Written out rather than shown as a raw minute count, because the interval is
 * the one number on this screen an operator is comparing against a wall clock.
 */
export function formatInterval(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;

  const parts = [
    days > 0 ? `${days} day${days === 1 ? '' : 's'}` : '',
    hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : '',
    rest > 0 ? `${rest} minute${rest === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return parts.join(' ');
}
