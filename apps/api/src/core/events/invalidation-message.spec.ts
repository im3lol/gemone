import { describe, expect, it } from 'vitest';

import {
  INVALIDATION_DOMAINS,
  INVALIDATION_PROTOCOL_VERSION,
  parseInvalidationMessage,
  serializeInvalidationMessage,
  type InvalidationMessage,
} from './invalidation-message';

const message = (overrides: Partial<InvalidationMessage> = {}): InvalidationMessage => ({
  v: INVALIDATION_PROTOCOL_VERSION,
  origin: 'instance-a',
  domain: INVALIDATION_DOMAINS.CONFIGURATION,
  entry: { key: 'rewards.hold_period_days', scope: 'GLOBAL', scopeId: '' },
  ...overrides,
});

describe('the invalidation wire format', () => {
  it('round-trips a keyed message', () => {
    const parsed = parseInvalidationMessage(serializeInvalidationMessage(message()));

    expect(parsed).toEqual({ status: 'ok', message: message() });
  });

  it('round-trips a whole-domain message', () => {
    const whole = message({ domain: INVALIDATION_DOMAINS.PROVIDERS, entry: null });
    const parsed = parseInvalidationMessage(serializeInvalidationMessage(whole));

    expect(parsed).toEqual({ status: 'ok', message: whole });
  });

  it('keeps the empty scope id that means GLOBAL', () => {
    /*
     * The table's sentinel for GLOBAL is the empty string, never null
     * (DATABASE.md §9.1). A schema that required a non-empty scope id would
     * reject every GLOBAL invalidation — which is most of them — and the
     * failure would look like "the admin panel does not propagate".
     */
    const parsed = parseInvalidationMessage(
      serializeInvalidationMessage(
        message({ entry: { key: 'a.key', scope: 'GLOBAL', scopeId: '' } }),
      ),
    );

    expect(parsed.status).toBe('ok');
    expect(parsed.status === 'ok' && parsed.message.entry?.scopeId).toBe('');
  });

  it('accepts a scope it does not recognise', () => {
    /*
     * The wire format deliberately does not validate against `ConfigScope`.
     * When a third scope is added (TODO T31 would add one), processes on the
     * older build must still be able to read the message — a scope they cannot
     * resolve simply matches no cache entry, whereas a rejected message means
     * they never learn anything changed at all.
     */
    const parsed = parseInvalidationMessage(
      serializeInvalidationMessage(
        message({ entry: { key: 'a.key', scope: 'PAYOUT_METHOD', scopeId: 'paypal' } }),
      ),
    );

    expect(parsed.status).toBe('ok');
  });
});

describe('a message this build cannot read', () => {
  /*
   * Every case here has the same required outcome: `unintelligible`, which the
   * bus turns into "drop everything". The reason is the rolling deploy — a
   * process on the old build receives messages from the new one, and each of
   * those messages means a value it has cached just changed. Reporting them as
   * unreadable is what lets the receiver be conservative instead of silently
   * stale for the length of the deploy.
   */

  it('reports a payload that is not JSON', () => {
    expect(parseInvalidationMessage('{not json')).toMatchObject({
      status: 'unintelligible',
    });
  });

  it('reports a newer protocol version rather than reading it optimistically', () => {
    const raw = JSON.stringify({ ...message(), v: INVALIDATION_PROTOCOL_VERSION + 1 });

    expect(parseInvalidationMessage(raw)).toMatchObject({ status: 'unintelligible' });
  });

  it('reports an unknown domain', () => {
    const raw = JSON.stringify({ ...message(), domain: 'offers' });

    expect(parseInvalidationMessage(raw)).toMatchObject({ status: 'unintelligible' });
  });

  it('reports a missing origin', () => {
    /*
     * Without an origin a receiver cannot tell its own echo from a real
     * change. Treating the message as unreadable is right: acting on it would
     * make every publisher reload for its own write.
     */
    const { origin: _origin, ...withoutOrigin } = message();

    expect(parseInvalidationMessage(JSON.stringify(withoutOrigin))).toMatchObject({
      status: 'unintelligible',
    });
  });

  it('reports an entry that is missing its key', () => {
    const raw = JSON.stringify({ ...message(), entry: { scope: 'GLOBAL', scopeId: '' } });

    expect(parseInvalidationMessage(raw)).toMatchObject({ status: 'unintelligible' });
  });

  it('names what was wrong, so the log line is actionable', () => {
    const parsed = parseInvalidationMessage(JSON.stringify({ ...message(), v: 99 }));

    expect(parsed.status === 'unintelligible' && parsed.reason).toContain('v');
  });
});
