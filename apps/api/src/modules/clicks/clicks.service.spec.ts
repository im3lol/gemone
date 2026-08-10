import { describe, expect, it } from 'vitest';

import { __testing } from './clicks.service';

const { clampLimit, truncate, RATE_WINDOW_MS, MAX_TEXT } = __testing;

describe('click capture helpers', () => {
  describe('truncate', () => {
    it('bounds what an untrusted client can store', () => {
      // `clicks` is the table that grows fastest, and the user agent and
      // referrer arrive from the browser. An unbounded header is a column
      // somebody fills with a megabyte, once per click.
      expect(truncate('x'.repeat(5000))).toHaveLength(MAX_TEXT);
    });

    it('normalises absent, blank and whitespace-only values to null', () => {
      // A blank user agent stored as an empty string looks like evidence that
      // was captured; null says it was not.
      expect(truncate(undefined)).toBeNull();
      expect(truncate(null)).toBeNull();
      expect(truncate('   ')).toBeNull();
    });

    it('trims but otherwise preserves', () => {
      expect(truncate('  Mozilla/5.0  ')).toBe('Mozilla/5.0');
    });
  });

  describe('clampLimit', () => {
    it('defaults, floors and caps', () => {
      expect(clampLimit(undefined)).toBe(25);
      expect(clampLimit(0)).toBe(1);
      expect(clampLimit(10_000)).toBe(100);
      expect(clampLimit(50)).toBe(50);
    });
  });

  describe('the rate window', () => {
    it('is one hour, matching what the configuration keys promise', () => {
      // The keys are named `max_per_user_per_hour`. A window that disagreed
      // with its own key name would make every configured number mean
      // something other than what an admin read.
      expect(RATE_WINDOW_MS).toBe(60 * 60 * 1000);
    });
  });
});
