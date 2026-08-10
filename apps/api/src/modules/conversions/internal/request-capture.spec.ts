import { describe, expect, it } from 'vitest';

import {
  __testing,
  captureHeaders,
  capturePayload,
  summarizeFailure,
} from './request-capture';

const { MAX_VALUE, MAX_KEYS } = __testing;

/**
 * These helpers turn public-internet input into two JSON columns on the table
 * that will grow fastest in the system. Every test here is about a bound.
 */
describe('capturePayload', () => {
  it('records the method, the query and the body verbatim', () => {
    const captured = capturePayload({
      method: 'post',
      query: { transaction_id: 'TX-1', status: '1' },
      body: { note: 'hello' },
    });

    expect(captured).toEqual({
      method: 'POST',
      query: { transaction_id: 'TX-1', status: '1' },
      body: { note: 'hello' },
    });
  });

  it('preserves a repeated query parameter instead of collapsing it', () => {
    /*
     * A repeat is legal HTTP and is also the shape of a parameter-pollution
     * attempt against a signature check. Flattening `?payout=1&payout=99` to
     * either value destroys the only evidence that both were sent — which is
     * exactly what a dispute about the amount would turn on.
     */
    const captured = capturePayload({
      method: 'GET',
      query: { payout: ['1.00', '99.00'] },
      body: undefined,
    });

    expect(captured.query.payout).toEqual(['1.00', '99.00']);
  });

  it('drops undefined query values rather than storing null holes', () => {
    const captured = capturePayload({
      method: 'GET',
      query: { present: 'yes', absent: undefined },
      body: null,
    });

    expect(Object.keys(captured.query)).toEqual(['present']);
  });

  it('bounds an enormous value', () => {
    const captured = capturePayload({
      method: 'GET',
      query: { blob: 'x'.repeat(50_000) },
      body: null,
    });

    expect(captured.query.blob).toHaveLength(MAX_VALUE);
  });

  it('bounds the number of keys', () => {
    const query = Object.fromEntries(
      Array.from({ length: MAX_KEYS + 50 }, (_, index) => [`k${index}`, 'v']),
    );

    const captured = capturePayload({ method: 'GET', query, body: null });

    expect(Object.keys(captured.query)).toHaveLength(MAX_KEYS);
  });

  it('records deep nesting as truncated rather than walking it', () => {
    // A deeply nested body is cheap to send and expensive to serialise.
    let body: unknown = 'bottom';
    for (let depth = 0; depth < 20; depth += 1) body = { nested: body };

    const captured = capturePayload({ method: 'POST', query: {}, body });

    expect(JSON.stringify(captured)).toContain('[truncated]');
  });

  it('survives a cyclic body', () => {
    /*
     * `JSON.stringify` throws on a cycle. Without a depth bound that throw
     * would land inside the handler, *after* we had decided the postback was
     * authentic — turning a storable event into a 500 and a provider retry.
     */
    const body: Record<string, unknown> = { id: 'TX-1' };
    body.self = body;

    const captured = capturePayload({ method: 'POST', query: {}, body });

    expect(() => JSON.stringify(captured)).not.toThrow();
  });

  it('reads a raw buffer body as text', () => {
    const captured = capturePayload({
      method: 'POST',
      query: {},
      body: Buffer.from('transaction_id=TX-9', 'utf8'),
    });

    expect(captured.body).toBe('transaction_id=TX-9');
  });
});

describe('captureHeaders', () => {
  it('keeps the headers worth archiving', () => {
    const captured = captureHeaders({
      'user-agent': 'ProviderBot/1.0',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
    });

    expect(captured).toEqual({
      'user-agent': 'ProviderBot/1.0',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
    });
  });

  it('never stores a credential-bearing header', () => {
    /*
     * The allowlist exists for this single assertion. A denylist would keep
     * whatever it did not think of — and "whatever it did not think of"
     * includes the day a provider authenticates with a bearer token, at which
     * point their secret is in our database, our backups and every replica
     * (DATABASE.md §1).
     */
    const captured = captureHeaders({
      authorization: 'Bearer super-secret-token',
      cookie: 'session=secret',
      'x-api-key': 'secret-key',
      'proxy-authorization': 'Basic c2VjcmV0',
      'user-agent': 'ProviderBot/1.0',
    });

    expect(Object.keys(captured)).toEqual(['user-agent']);
    expect(JSON.stringify(captured)).not.toContain('secret');
  });

  it('joins a repeated header rather than dropping either value', () => {
    const captured = captureHeaders({ 'x-forwarded-for': ['203.0.113.10', '10.0.0.1'] });

    expect(captured['x-forwarded-for']).toBe('203.0.113.10, 10.0.0.1');
  });

  it('omits absent and empty headers instead of storing blanks', () => {
    // An empty string stored looks like evidence that was captured; absence
    // says it was not sent.
    const captured = captureHeaders({ 'user-agent': '', referer: undefined });

    expect(captured).toEqual({});
  });

  it('bounds an enormous header', () => {
    const captured = captureHeaders({ 'user-agent': 'x'.repeat(50_000) });

    expect(captured['user-agent']).toHaveLength(MAX_VALUE);
  });
});

describe('summarizeFailure', () => {
  it('reduces an error to one storable line', () => {
    const detail = summarizeFailure(new Error('Postback is missing\n  sub_id'));

    expect(detail).toBe('Postback is missing sub_id');
  });

  it('bounds the length', () => {
    // `error_detail` is shown to an admin (§15.3). A wall of text is not.
    expect(summarizeFailure(new Error('x'.repeat(5000)))).toHaveLength(500);
  });

  it('handles a thrown non-error', () => {
    expect(summarizeFailure('plain string')).toBe('plain string');
  });
});
