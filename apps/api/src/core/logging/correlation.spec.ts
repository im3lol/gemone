import { describe, expect, it } from 'vitest';

import { CORRELATION_ID_HEADER, getCorrelationId } from './correlation';

function requestWith(headers: Record<string, string | string[]> = {}): unknown {
  return { headers };
}

/**
 * Correlation ids come from outside and end up in log lines, which makes the
 * sanitiser a log-injection control rather than a formatting nicety. It is
 * tested as one.
 */
describe('getCorrelationId', () => {
  it('generates an id when the caller supplies none', () => {
    const id = getCorrelationId(requestWith());

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the same id on repeat access for one request', () => {
    const req = requestWith();

    expect(getCorrelationId(req)).toBe(getCorrelationId(req));
  });

  it('adopts an inbound id so one user action has one id across processes', () => {
    const req = requestWith({ [CORRELATION_ID_HEADER]: 'bff-abc-123' });

    expect(getCorrelationId(req)).toBe('bff-abc-123');
  });

  it('takes the first value when the header is repeated', () => {
    const req = requestWith({ [CORRELATION_ID_HEADER]: ['first', 'second'] });

    expect(getCorrelationId(req)).toBe('first');
  });

  it('strips characters that would let a caller forge log structure', () => {
    const req = requestWith({
      [CORRELATION_ID_HEADER]: 'abc"}\n{"level":"error","msg":"fake',
    });

    const id = getCorrelationId(req);

    // Word characters survive; every character that could terminate a JSON
    // string or start a new log record is gone. That is what makes this safe
    // to interpolate into a log line.
    expect(id).toBe('abclevelerrormsgfake');
    expect(id).not.toMatch(/["{}\n:,]/);
  });

  it('caps length so a caller cannot bloat every log line', () => {
    const req = requestWith({ [CORRELATION_ID_HEADER]: 'a'.repeat(500) });

    expect(getCorrelationId(req)).toHaveLength(128);
  });

  it('falls back to a generated id when sanitising leaves nothing', () => {
    const req = requestWith({ [CORRELATION_ID_HEADER]: '!!!@@@###' });

    expect(getCorrelationId(req)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never throws on a malformed request object', () => {
    expect(getCorrelationId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(getCorrelationId(null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(getCorrelationId('not-a-request')).toMatch(/^[0-9a-f-]{36}$/);
    expect(getCorrelationId({})).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives different requests different ids', () => {
    expect(getCorrelationId(requestWith())).not.toBe(getCorrelationId(requestWith()));
  });
});
