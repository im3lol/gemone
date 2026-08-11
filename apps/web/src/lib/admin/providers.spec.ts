import type { ProviderHealthState, SyncOutcome } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import {
  SYNC_MODES_IN_ORDER,
  capabilityLabel,
  formatInterval,
  healthState,
  syncModeHint,
  syncModeLabel,
  syncOutcome,
} from './providers';

const HEALTH_STATES: ProviderHealthState[] = ['HEALTHY', 'DEGRADED', 'DOWN'];
const OUTCOMES: SyncOutcome[] = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'];

describe('healthState', () => {
  it('covers every state the contract has', () => {
    for (const state of HEALTH_STATES) {
      expect(healthState(state).label, state).toBeTruthy();
      expect(healthState(state).hint, state).toBeTruthy();
    }
  });

  it('says out loud that health is a signal, not a switch', () => {
    // An operator seeing a red badge beside an enabled provider will otherwise
    // assume one of the two is wrong. Auto-disabling on health is the trap the
    // contract calls out: nothing would call the provider, so nothing would
    // record a success, and it could never recover.
    expect(healthState('DOWN').hint).toMatch(/still being called/);
    expect(healthState('DEGRADED').hint).toMatch(/still being called/);
  });

  it('never renders undefined for a state this build has not heard of', () => {
    expect(healthState('ON_FIRE' as ProviderHealthState).label).toBe('Unknown');
  });
});

describe('syncOutcome', () => {
  it('covers every outcome, including RUNNING', () => {
    for (const outcome of OUTCOMES) {
      expect(syncOutcome(outcome).label, outcome).toBeTruthy();
    }
    // RUNNING is a real outcome: the row is written before the work starts so
    // a crashed run stays visible.
    expect(syncOutcome('RUNNING').tone).toBe('info');
  });

  it('does not colour a partial run as a failure', () => {
    expect(syncOutcome('PARTIAL').tone).toBe('warning');
    expect(syncOutcome('FAILED').tone).toBe('error');
  });

  it('falls back rather than rendering undefined', () => {
    expect(syncOutcome('CANCELLED' as SyncOutcome).label).toBe('Recorded');
  });
});

describe('capabilityLabel', () => {
  it('names the four every adapter must declare', () => {
    expect(capabilityLabel('fetch_offers')).toBe('Fetch offers');
    expect(capabilityLabel('build_click_url')).toBe('Build click URLs');
    expect(capabilityLabel('verify_postback')).toBe('Verify postbacks');
    expect(capabilityLabel('parse_postback')).toBe('Parse postbacks');
  });

  it('renders a capability declared by an adapter this build does not know', () => {
    // Capabilities are declarations by adapters, so an unknown one is data,
    // not an error — dropping it would hide what a provider says it can do.
    expect(capabilityLabel('streaming_offers')).toBe('streaming offers');
  });
});

describe('sync modes', () => {
  it('lists the safe one first', () => {
    // FULL deactivates whatever the run did not see. Putting it second is the
    // difference between a mis-click that does nothing and one that empties a
    // catalog.
    expect(SYNC_MODES_IN_ORDER).toEqual(['INCREMENTAL', 'FULL']);
    expect(syncModeLabel('INCREMENTAL')).toBe('Incremental');
  });

  it('warns that a full sync prunes', () => {
    expect(syncModeHint('FULL')).toMatch(/deactivate/);
    expect(syncModeHint('INCREMENTAL')).toMatch(/[Nn]ever deactivates/);
  });
});

describe('formatInterval', () => {
  it('writes minutes out rather than showing a raw count', () => {
    expect(formatInterval(45)).toBe('45 minutes');
    expect(formatInterval(1)).toBe('1 minute');
    expect(formatInterval(90)).toBe('1 hour 30 minutes');
    expect(formatInterval(60)).toBe('1 hour');
    expect(formatInterval(1440)).toBe('1 day');
    expect(formatInterval(1500)).toBe('1 day 1 hour');
  });

  it('is a dash for anything unusable', () => {
    expect(formatInterval(0)).toBe('—');
    expect(formatInterval(-30)).toBe('—');
    expect(formatInterval(Number.NaN)).toBe('—');
  });
});
