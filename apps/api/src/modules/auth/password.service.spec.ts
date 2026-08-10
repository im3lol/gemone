import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@gemone/contracts';

import { DomainError } from '../../core/errors/app-error';
import { PASSWORD_POLICY } from './auth.constants';
import { PasswordService } from './password.service';

const VALID = 'correct-horse-battery-staple';

describe('PasswordService', () => {
  const service = new PasswordService();

  describe('hashing', () => {
    it('produces an argon2id hash', async () => {
      const hash = await service.hash(VALID);

      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('never returns the plaintext', async () => {
      const hash = await service.hash(VALID);

      expect(hash).not.toContain(VALID);
    });

    it('salts, so identical passwords produce different hashes', async () => {
      const a = await service.hash(VALID);
      const b = await service.hash(VALID);

      // Without a per-password salt, identical hashes reveal that two users
      // share a password, and one cracked hash breaks every account using it.
      expect(a).not.toBe(b);
    });

    it('encodes its parameters in the hash, so they can be raised later', async () => {
      const hash = await service.hash(VALID);

      expect(hash).toContain('m=19456');
      expect(hash).toContain('t=2');
      expect(hash).toContain('p=1');
    });
  });

  describe('verification', () => {
    it('accepts the correct password', async () => {
      const hash = await service.hash(VALID);

      await expect(service.verify(hash, VALID)).resolves.toBe(true);
    });

    it('rejects a wrong password', async () => {
      const hash = await service.hash(VALID);

      await expect(service.verify(hash, 'wrong-password-entirely')).resolves.toBe(false);
    });

    it('rejects a near-miss', async () => {
      const hash = await service.hash(VALID);

      await expect(service.verify(hash, `${VALID} `)).resolves.toBe(false);
      await expect(service.verify(hash, VALID.toUpperCase())).resolves.toBe(false);
    });

    it('returns false rather than throwing on a corrupt stored hash', async () => {
      // A corrupt row must read as "wrong password", not as a 500 that tells
      // an attacker they found something interesting.
      await expect(service.verify('not-a-hash', VALID)).resolves.toBe(false);
      await expect(service.verify('', VALID)).resolves.toBe(false);
    });
  });

  describe('the decoy verification', () => {
    /*
     * This exists so a login against an address with no account costs what a
     * login against a real one costs. It was shipped as a hand-written
     * constant that was not a valid argon2 string: `verify` rejected it as
     * malformed in microseconds, the equaliser cost nothing, and the endpoint
     * answered ~8ms for an unknown address against ~36ms for a known one.
     *
     * Two independent tests, because the failure was invisible to every test
     * that only checked the response body — one asks whether the hash parses,
     * the other whether the work actually happens.
     */

    it('is a hash argon2 can actually read', async () => {
      // The malformed constant took the catch branch in verify(), which logs.
      // A decoy that parses never reaches it.
      const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      try {
        await service.verifyDecoy('anything-at-all-here');
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    });

    it('costs what verifying a real password costs', async () => {
      const real = await service.hash(VALID);

      // Warm both paths first: the decoy is generated on first use, and a
      // one-off generation would be measured as verification time.
      await service.verify(real, 'wrong-password-entirely');
      await service.verifyDecoy('wrong-password-entirely');

      const timed = async (run: () => Promise<unknown>): Promise<number> => {
        const started = process.hrtime.bigint();
        await run();
        return Number(process.hrtime.bigint() - started) / 1e6;
      };

      const realCost = await timed(() => service.verify(real, 'wrong-password-entirely'));
      const decoyCost = await timed(() => service.verifyDecoy('wrong-password-entirely'));

      /*
       * Half, not equal: the assertion has to survive a loaded CI machine.
       * The margin is enormous either way — a malformed decoy scores about
       * 0.001 of a real verification, because it does no argon2 work at all.
       */
      expect(decoyCost).toBeGreaterThan(realCost * 0.5);
    });
  });

  describe('policy', () => {
    it('accepts a password at the minimum length', () => {
      expect(() => service.assertMeetsPolicy('a'.repeat(PASSWORD_POLICY.minLength))).not.toThrow();
    });

    it('rejects one character below the minimum', () => {
      expect(() =>
        service.assertMeetsPolicy('a'.repeat(PASSWORD_POLICY.minLength - 1)),
      ).toThrow(DomainError);
    });

    it('rejects above the maximum, which is a CPU-exhaustion guard', () => {
      expect(() =>
        service.assertMeetsPolicy('a'.repeat(PASSWORD_POLICY.maxLength + 1)),
      ).toThrow(DomainError);
    });

    it('reports a weak password as a 422 with a stable code', () => {
      try {
        service.assertMeetsPolicy('short');
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        const domainError = error as DomainError;
        expect(domainError.code).toBe(ERROR_CODES.AUTH_WEAK_PASSWORD);
        expect(domainError.httpStatus).toBe(422);
      }
    });

    it('imposes no character-class rules', () => {
      // Composition rules push users toward "Password1!" and measurably
      // reduce entropy, which is why NIST dropped the recommendation.
      expect(() => service.assertMeetsPolicy('all lowercase words here')).not.toThrow();
    });

    it('is enforced by hash(), not only by the DTO', async () => {
      // The DTO produces a friendly message; the service is the authority,
      // for callers that never see a DTO.
      await expect(service.hash('short')).rejects.toThrow(DomainError);
    });
  });
});
