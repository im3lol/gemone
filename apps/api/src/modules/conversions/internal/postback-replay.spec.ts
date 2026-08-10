import { describe, expect, it } from 'vitest';

import { archivedMethod, toRawRequest } from './postback-replay';

/**
 * Rebuilding the adapter's input from the archive.
 *
 * This is what makes "fix the parser, then replay" real. Every test here is
 * about the round trip surviving intact — a field lost between what was stored
 * and what is replayed is a conversion that parses differently the second
 * time, which is worse than one that does not parse at all.
 */
describe('toRawRequest', () => {
  it('restores the query the adapter parses', () => {
    const raw = toRawRequest({
      payload: {
        method: 'GET',
        query: { transaction_id: 'TX-1', status: '1' },
        body: null,
      },
      headers: { 'user-agent': 'ProviderBot/1.0' },
      sourceIp: '203.0.113.10',
    });

    expect(raw.query).toEqual({ transaction_id: 'TX-1', status: '1' });
    expect(raw.headers).toEqual({ 'user-agent': 'ProviderBot/1.0' });
    expect(raw.sourceIp).toBe('203.0.113.10');
  });

  it('restores a repeated parameter as an array', () => {
    /*
     * A repeat is legal HTTP and is also the shape of a parameter-pollution
     * attempt. An adapter that treats one as hostile can only do so if the
     * replay still shows it a repeat — flattening here would make the replay
     * *more* permissive than the live request, which is the wrong direction
     * for the one surface that must never be.
     */
    const raw = toRawRequest({
      payload: { method: 'GET', query: { payout: ['1.00', '99.00'] } },
      headers: {},
      sourceIp: null,
    });

    expect(raw.query.payout).toEqual(['1.00', '99.00']);
  });

  it('carries the body through for a POST', () => {
    const raw = toRawRequest({
      payload: { method: 'POST', query: {}, body: { note: 'delivered' } },
      headers: {},
      sourceIp: null,
    });

    expect(raw.body).toEqual({ note: 'delivered' });
  });

  it('passes an unknown source as empty, never as a placeholder', () => {
    // A plausible-looking placeholder is something an adapter could match on.
    expect(toRawRequest({ payload: {}, headers: {}, sourceIp: null }).sourceIp).toBe('');
  });

  it('does not carry rawBody, which is not archived', () => {
    // Stated as a test so the limitation is visible rather than discovered by
    // the first adapter that parses from the raw bytes (TODO T23).
    const raw = toRawRequest({
      payload: { method: 'POST', query: {}, body: 'a=1' },
      headers: {},
      sourceIp: null,
    });

    expect(raw.rawBody).toBeUndefined();
  });

  describe('surviving a payload that is not the shape it should be', () => {
    it.each([
      ['null', null],
      ['a string', 'not an object'],
      ['an array', [1, 2, 3]],
      ['an empty object', {}],
      ['a query that is not an object', { query: 'nope' }],
    ])('returns an empty request for %s instead of throwing', (_label, payload) => {
      /*
       * The archive is JSON written by an earlier version of this code. A
       * shape change would otherwise crash the worker on every historical row
       * — and the rows most worth replaying are exactly the old ones.
       */
      expect(() => toRawRequest({ payload, headers: null, sourceIp: null })).not.toThrow();
      expect(toRawRequest({ payload, headers: null, sourceIp: null }).query).toEqual({});
    });

    it('drops non-string values rather than passing them to an adapter', () => {
      const raw = toRawRequest({
        payload: { query: { good: 'yes', bad: 42, alsoBad: { nested: true } } },
        headers: { good: 'yes', bad: 42 },
        sourceIp: null,
      });

      // An adapter's `single()` expects `string | string[] | undefined`. A
      // number reaching it would be read as absent, silently.
      expect(raw.query).toEqual({ good: 'yes' });
      expect(raw.headers).toEqual({ good: 'yes' });
    });
  });
});

describe('archivedMethod', () => {
  it('reads the method back', () => {
    expect(archivedMethod({ method: 'POST' })).toBe('POST');
  });

  it('says so when it cannot', () => {
    expect(archivedMethod(null)).toBe('UNKNOWN');
    expect(archivedMethod({})).toBe('UNKNOWN');
  });
});
