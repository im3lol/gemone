import { randomBytes } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { ERROR_CODES } from '@gemone/contracts';

import { DomainError } from '../../core/errors/app-error';
import { PASSWORD_POLICY } from './auth.constants';

/**
 * Password hashing — ARCHITECTURE.md §1.3, §8.3.
 *
 * argon2id, chosen over bcrypt for memory-hardness: bcrypt is cheap to attack
 * with GPUs, argon2id's memory cost is not. Nothing cryptographic is
 * hand-rolled here; this is a thin wrapper over a maintained implementation.
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * OWASP's baseline argon2id parameters. Encoded in the resulting hash
   * string, so raising them later does not invalidate existing hashes —
   * old passwords keep verifying under the parameters they were created with.
   */
  private readonly options = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  private decoyHash: Promise<string> | null = null;

  /**
   * Generates the decoy hash before the first request needs it.
   *
   * One argon2 hash at startup, so the first login against an unknown address
   * is not measurably the slow one — which would leak the same fact the decoy
   * exists to hide, just once.
   */
  async onModuleInit(): Promise<void> {
    await this.decoy();
  }

  async hash(plaintext: string): Promise<string> {
    this.assertMeetsPolicy(plaintext);
    return hash(plaintext, this.options);
  }

  /**
   * Constant-time comparison, delegated to the library.
   *
   * Returns false rather than throwing on a malformed stored hash: a corrupt
   * row must read as "wrong password" and be logged, not as a 500 that tells
   * an attacker they found something interesting.
   */
  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext, this.options);
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Password verification failed against a stored hash',
      );
      return false;
    }
  }

  /**
   * Spends a verification against a hash nobody has the password to.
   *
   * Called on the login path when the address has no account, so that request
   * costs what a request for a real account costs. Without it the response
   * time answers "does this address exist" — the question the shared
   * `AUTH_INVALID_CREDENTIALS` code exists to refuse.
   *
   * The result is deliberately discarded: it is always false, and the only
   * product of this call is the time it takes.
   */
  async verifyDecoy(plaintext: string): Promise<void> {
    await this.verify(await this.decoy(), plaintext);
  }

  /**
   * The decoy hash, generated once per process.
   *
   * **Generated, never written down.** The literal this replaces was not a
   * valid argon2 string at all — `verify` rejected it as malformed in
   * microseconds, so the equaliser cost nothing and an unknown address
   * answered in ~8ms against ~36ms for a known one. A hash produced by
   * `hash()` cannot be malformed, and cannot drift out of step with `options`
   * when those are raised: the property is now a consequence of how the value
   * is made rather than of somebody having pasted a correct string.
   *
   * Memoised rather than computed per call, because paying 40ms of argon2 on
   * top of the 40ms this method already spends would make the unknown address
   * the *slow* one and re-open the oracle from the other side.
   */
  private decoy(): Promise<string> {
    this.decoyHash ??= this.hash(randomBytes(32).toString('hex'));
    return this.decoyHash;
  }

  /**
   * Password policy.
   *
   * ARCHITECTURE.md §24 sequences the configuration service before auth, so
   * these thresholds should be admin-tunable (P3). They are constants for now
   * — see auth.constants.ts. This method is the single place that reads them,
   * so the move is one call site.
   */
  assertMeetsPolicy(plaintext: string): void {
    const problems: string[] = [];

    if (plaintext.length < PASSWORD_POLICY.minLength) {
      problems.push(`must be at least ${PASSWORD_POLICY.minLength} characters`);
    }

    if (plaintext.length > PASSWORD_POLICY.maxLength) {
      // Not arbitrary: argon2 hashes whatever it is given, so an unbounded
      // password is an unbounded amount of hashing work per login attempt.
      problems.push(`must be at most ${PASSWORD_POLICY.maxLength} characters`);
    }

    if (problems.length > 0) {
      throw new DomainError(
        ERROR_CODES.AUTH_WEAK_PASSWORD,
        `Password ${problems.join(' and ')}`,
        422,
      );
    }
  }
}
