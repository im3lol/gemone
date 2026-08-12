import { USER_ROLES, USER_STATUSES } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import { __testing } from './+page.server';

const { readStatus, readRole, readEmail, readOffset, pageQuery } = __testing;

/**
 * All four read a query string, which is to say all four read whatever is in
 * the address bar, and what they hand back goes into a call to the admin API.
 */

describe('readStatus', () => {
  it.each(Object.values(USER_STATUSES))('accepts %s', (status) => {
    expect(readStatus(status)).toBe(status);
  });

  it('treats a missing filter as every status', () => {
    expect(readStatus(null)).toBe('');
    expect(readStatus('')).toBe('');
  });

  it('drops anything else rather than forwarding it', () => {
    // `ListUsersDto` answers an unknown status with a 422, which would turn
    // the whole list into an error state over a URL somebody mistyped.
    expect(readStatus('active')).toBe('');
    expect(readStatus('DROP TABLE users')).toBe('');
  });
});

describe('readRole', () => {
  it.each(Object.values(USER_ROLES))('accepts %s', (role) => {
    expect(readRole(role)).toBe(role);
  });

  it('drops anything else', () => {
    expect(readRole('SUPERADMIN')).toBe('');
    expect(readRole(null)).toBe('');
  });
});

describe('readEmail', () => {
  it('keeps a fragment, because that is what the API matches on', () => {
    // The parameter reaches a Prisma `contains`. A whole address is the case
    // a search box is least needed for.
    expect(readEmail('p11')).toBe('p11');
    expect(readEmail('someone@example.test')).toBe('someone@example.test');
  });

  it('trims, so a pasted address with a trailing space still matches', () => {
    expect(readEmail('  p11  ')).toBe('p11');
  });

  it('bounds the fragment at the length the API accepts', () => {
    // Longer would be a 422 that reads as a broken page, over a paste.
    expect(readEmail('a'.repeat(400))).toHaveLength(320);
  });

  it('does not strip characters from what was typed', () => {
    // The value is a query parameter and a parameterised `contains`, both
    // safe. A filter that silently removed characters would quietly search
    // for something other than what was asked for.
    expect(readEmail("o'brien@example.test")).toBe("o'brien@example.test");
    expect(readEmail('a+b@example.test')).toBe('a+b@example.test');
  });

  it('is empty when nothing was typed', () => {
    expect(readEmail(null)).toBe('');
    expect(readEmail('   ')).toBe('');
  });
});

describe('readOffset', () => {
  it('reads a page offset', () => {
    expect(readOffset('50')).toBe(50);
  });

  it('is page one for anything unusable', () => {
    // `skip: NaN` is a query the database rejects.
    expect(readOffset(null)).toBe(0);
    expect(readOffset('not-a-number')).toBe(0);
    expect(readOffset('-25')).toBe(0);
    expect(readOffset('25.9')).toBe(25);
  });
});

describe('pageQuery', () => {
  it('carries every applied filter, so the pager keeps them', () => {
    expect(pageQuery({ status: 'ACTIVE', role: 'USER', email: 'p11' })).toBe(
      '?status=ACTIVE&role=USER&email=p11',
    );
  });

  it('encodes a fragment that needs it', () => {
    expect(pageQuery({ status: '', role: '', email: 'a+b@example.test' })).toBe(
      '?email=a%2Bb%40example.test',
    );
  });

  it('is empty when nothing is filtered', () => {
    expect(pageQuery({ status: '', role: '', email: '' })).toBe('');
  });

  it('never carries an offset, so changing a filter lands on page one', () => {
    // Page 3 of the old result set is usually past the end of the new one.
    expect(pageQuery({ status: 'BANNED', role: '', email: '' })).not.toContain('offset');
  });

  it('drops a rejected filter instead of carrying it onto page two', () => {
    // Rebuilt from what was applied, not copied from `url.search`.
    expect(pageQuery({ status: readStatus('nonsense'), role: readRole('nope'), email: '' })).toBe('');
  });
});
