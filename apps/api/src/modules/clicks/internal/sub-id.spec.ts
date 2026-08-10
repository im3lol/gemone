import { describe, expect, it } from 'vitest';

import { SubIdSigner } from './sub-id';

/**
 * The opaque, signed click identifier.
 *
 * This is the one value in the system that is deliberately handed to an
 * untrusted third party and later trusted back — so it gets the closest
 * attention. Everything below is a property the postback surface will rely on.
 */
const SECRET = 'a-click-signing-secret-at-least-32-chars';
const OTHER_SECRET = 'a-different-secret-also-32-characters-ok';

const signer = new SubIdSigner(SECRET);

describe('SubIdSigner', () => {
  describe('construction', () => {
    it('refuses a short secret', () => {
      // Brute-forceable offline against any captured sub_id, and a forged one
      // is indistinguishable from a real one.
      expect(() => new SubIdSigner('too-short')).toThrow(/at least 32/);
      expect(() => new SubIdSigner('a'.repeat(31))).toThrow();
      expect(() => new SubIdSigner('a'.repeat(32))).not.toThrow();
    });
  });

  describe('issue', () => {
    it('produces a token and a signature, both URL-safe', () => {
      const subId = signer.issue();

      // It travels in a query string to a provider and comes back in one.
      // A value needing escaping is a value somebody will fail to escape.
      expect(subId).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(subId)).toBe(subId);
    });

    it('never repeats', () => {
      const seen = new Set(Array.from({ length: 2000 }, () => signer.issue()));

      // The unique constraint on `sub_id` would catch a collision as an error
      // on a user's click; 128 bits of entropy is what makes it never happen.
      expect(seen.size).toBe(2000);
    });

    it('carries no user, offer or timestamp — it is opaque by construction', () => {
      const subId = signer.issue();
      const token = subId.split('.')[0]!;

      /*
       * The property that matters: a provider receives this, logs it, and may
       * leak it. Anything derivable from it is effectively public, so it
       * derives from nothing. This is also why it is not the click's UUIDv7
       * primary key — that embeds a timestamp and sorts monotonically, which
       * would publish both our click volume and a walkable sequence.
       */
      expect(Buffer.from(token, 'base64url')).toHaveLength(16);
      expect(subId).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no UUID in there
    });
  });

  describe('verify', () => {
    it('accepts what it issued', () => {
      expect(signer.verify(signer.issue())).toBe(true);
    });

    it('rejects a signature made with a different key', () => {
      const foreign = new SubIdSigner(OTHER_SECRET).issue();

      // The whole point: "was this ever one of ours" is answerable without
      // touching the database.
      expect(signer.verify(foreign)).toBe(false);
    });

    it('rejects a tampered token', () => {
      const subId = signer.issue();
      const [token, signature] = subId.split('.');

      // Swapping the token while keeping a valid-looking signature is the
      // forgery attempt this defends against — the attacker wants a sub_id
      // that resolves to somebody else's click.
      const tampered = `${token!.slice(0, -2)}AA.${signature}`;
      expect(signer.verify(tampered)).toBe(false);
    });

    it('rejects a tampered signature', () => {
      const [token] = signer.issue().split('.');

      expect(signer.verify(`${token}.AAAAAAAAAAAAAAAAAAAAAA`)).toBe(false);
    });

    it.each([
      ['', 'empty'],
      ['no-separator', 'no separator'],
      ['.', 'both halves empty'],
      ['abc.', 'empty signature'],
      ['.abc', 'empty token'],
      ['a.b.c', 'two separators'],
      ['abc def.ghi', 'whitespace'],
      ['abc+/=.ghi', 'non-URL-safe characters'],
      ['a'.repeat(200) + '.b', 'absurdly long'],
    ])('rejects %s (%s) without throwing', (input) => {
      // A malformed sub_id arrives on a public, unauthenticated endpoint.
      // Throwing would return 500 to a request we simply mean to decline, and
      // would fill the error log with noise that hides real failures.
      expect(() => signer.verify(input)).not.toThrow();
      expect(signer.verify(input)).toBe(false);
    });

    it('rejects a signature of the wrong length without throwing', () => {
      const [token] = signer.issue().split('.');

      // `timingSafeEqual` throws on a length mismatch, which would itself be a
      // timing signal as well as a 500.
      expect(() => signer.verify(`${token}.AA`)).not.toThrow();
      expect(signer.verify(`${token}.AA`)).toBe(false);
    });
  });

  describe('userReference', () => {
    it('is stable for a user, so a provider can recognise a returning one', () => {
      const id = '0192f0a0-0000-7000-8000-0000000000aa';

      expect(signer.userReference(id)).toBe(signer.userReference(id));
    });

    it('differs between users', () => {
      expect(signer.userReference('user-a')).not.toBe(signer.userReference('user-b'));
    });

    it('does not contain the user id', () => {
      const id = '0192f0a0-0000-7000-8000-0000000000aa';

      // PROJECT.md §4.3: the raw user id is never passed to a provider.
      expect(signer.userReference(id)).not.toContain(id);
      expect(signer.userReference(id)).not.toContain('0192f0a0');
    });

    it('is not reversible with a different key', () => {
      const id = '0192f0a0-0000-7000-8000-0000000000aa';

      // Two deployments — or a rotated key — produce unrelated references, so
      // a leak from one tells you nothing about the other.
      expect(new SubIdSigner(OTHER_SECRET).userReference(id)).not.toBe(
        signer.userReference(id),
      );
    });

    it('is URL-safe and bounded', () => {
      const reference = signer.userReference('0192f0a0-0000-7000-8000-0000000000aa');

      expect(reference).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });
  });

  describe('the sub_id and the user reference are different things', () => {
    it('does not let one be mistaken for the other', () => {
      const userReference = signer.userReference('some-user');

      // A user reference is stable per user; a sub_id is per click. Accepting
      // a user reference as a sub_id would collapse every click by one user
      // into one attribution.
      expect(signer.verify(userReference)).toBe(false);
    });
  });
});
