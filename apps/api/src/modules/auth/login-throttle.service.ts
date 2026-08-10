import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@gemone/contracts';
import type { ChainableCommander, Redis } from 'ioredis';

import { ConfigurationService } from '../../core/config/configuration.service';
import { DomainError, InfrastructureError } from '../../core/errors/app-error';
import { UsersService } from '../users/users.service';
import {
  AUTH_LOGIN_ACCOUNT_WINDOW_SECONDS,
  AUTH_LOGIN_IP_WINDOW_SECONDS,
  AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT,
  AUTH_LOGIN_MAX_FAILURES_PER_IP,
} from './auth.config';
import { LOGIN_THROTTLE_REDIS } from './auth.tokens';

/** `ow:<schema-version>:<domain>:<identifier>` — §14.4. */
const KEY_PREFIX = 'ow:1:login-throttle';

/**
 * Login throttling — ARCHITECTURE.md §8.3, closing TODO T2.
 *
 * Two counters answering two different questions: **is somebody guessing this
 * account's password**, and **is this source guessing across many accounts**.
 * Neither subsumes the other — an attacker spreading five attempts each across
 * a thousand addresses never trips an account ceiling, and a NAT full of
 * genuine users trips an IP ceiling that is set for one person.
 *
 * ## The account key is derived from the email, never from a user id
 *
 * This is the property that keeps the feature from becoming the thing it is
 * meant to protect. Keyed by `user.id`, an address with no account would have
 * no counter and could never be throttled — so "this address locks out after
 * ten tries and that one never does" would answer the question the shared
 * `AUTH_INVALID_CREDENTIALS` code and the decoy verification in
 * `AuthService.login` exist to refuse. Keyed by the email, a registered address
 * and an unregistered one behave identically.
 *
 * Normalized through `UsersService.normalizeEmail` — the same function the
 * lookup uses. Two spellings of one address must land in one bucket, or the
 * account limit is bypassed by varying the capitalization.
 *
 * Hashed, because the value is then a bounded, fixed-width token rather than a
 * user's email address sitting in plaintext in a datastore that is not the
 * database and has no retention policy of its own.
 *
 * ## Counted in Redis, not Postgres
 *
 * §8.3 says Redis, and unlike the velocity counters D49 moved to Postgres,
 * nothing here is exact accounting: login attempts are not rows anywhere, so
 * Postgres would mean a table and a migration for data whose whole value
 * expires in minutes. See D73.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  constructor(
    @Inject(LOGIN_THROTTLE_REDIS) private readonly redis: Redis,
    private readonly configuration: ConfigurationService,
  ) {}

  /** The account bucket for an address, registered or not. */
  static accountKeyFor(email: string): string {
    return createHash('sha256').update(UsersService.normalizeEmail(email)).digest('hex');
  }

  /**
   * Takes this attempt's place in both counters, and refuses it if that place
   * is past the ceiling.
   *
   * ## Why counting comes before checking
   *
   * Reading the counter and incrementing it after the verdict leaves ~40ms of
   * argon2 between the two, and every request that arrives inside that gap
   * reads the same number. Measured: a ceiling of 5 admitted **all ten** of ten
   * concurrent attempts, on both counters. The limit held exactly when the
   * attempts were serial and did nothing at all when they were not — which is
   * the shape a credential-stuffing tool actually has.
   *
   * `INCR` closes it with no lock and no script: it is atomic and hands each
   * caller a distinct number, so of ten concurrent attempts exactly `limit`
   * receive a value within the ceiling. The count therefore includes the
   * attempt being judged, and the comparison is `>` rather than `>=` — the
   * `limit`-th attempt is the last one allowed, exactly as before.
   *
   * ## What this does to D73
   *
   * D73's rule is that only failed authentications end up counted, and that
   * survives: every attempt reserves a place, and a proven-correct password
   * gives its place back (`releaseAttempt`). What changes is *when* the
   * increment is issued, not what the counter ends up measuring. Two
   * consequences are real and deliberate: an attempt abandoned mid-flight stays
   * counted, and a Redis failure while reserving now refuses the request
   * instead of letting it through uncounted — the second being §15.4 applied to
   * an operation that is now part of the control rather than bookkeeping after
   * it.
   *
   * **Fail closed** (§15.4). Every other cache dependency in this system
   * degrades open; this one is a control, and an unavailable control is not a
   * reason to stop controlling. A Redis outage therefore stops logins — which
   * is a real cost, deliberately paid, and recorded as a limitation in T60.
   */
  async reserveAttempt(accountKey: string, ip: string | null): Promise<void> {
    const [accountLimit, ipLimit, accountWindow, ipWindow] = await Promise.all([
      this.configuration.get<number>(AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT.key),
      this.configuration.get<number>(AUTH_LOGIN_MAX_FAILURES_PER_IP.key),
      this.configuration.get<number>(AUTH_LOGIN_ACCOUNT_WINDOW_SECONDS.key),
      this.configuration.get<number>(AUTH_LOGIN_IP_WINDOW_SECONDS.key),
    ]);

    let accountAttempts: number;
    let ipAttempts: number;

    try {
      [accountAttempts, ipAttempts] = await Promise.all([
        this.reserve(accountRedisKey(accountKey), accountWindow),
        ip === null ? Promise.resolve(0) : this.reserve(ipRedisKey(ip), ipWindow),
      ]);
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Login throttle counters are unusable; refusing authentication',
      );

      throw new InfrastructureError('Authentication is temporarily unavailable', {
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        httpStatus: 503,
        retryable: true,
      });
    }

    if (accountAttempts > accountLimit) {
      this.logger.warn({ scope: 'account', attempts: accountAttempts }, 'Login throttled');
      throw throttled();
    }

    // Only when an address is known. Grouping every unidentified caller into a
    // shared bucket would let one of them lock out all the others — the same
    // reason the click limit skips it.
    if (ip !== null && ipAttempts > ipLimit) {
      this.logger.warn({ scope: 'ip', attempts: ipAttempts }, 'Login throttled');
      throw throttled();
    }
  }

  /**
   * Gives back what a proven-correct password reserved.
   *
   * The account bucket is **cleared**, not decremented: a correct password is
   * proof that the guessing this counter measures has ended, so the whole count
   * goes, exactly as before.
   *
   * The address bucket is **decremented by one** — this attempt's own
   * reservation and nothing else. That is what keeps D73's third rule intact:
   * the count left behind is the count that was there before this attempt, so
   * one correct password still says nothing about the other accounts being
   * tried from the same address. Clearing it would reduce the IP ceiling to a
   * formality: fail a few times, log into an account you own, repeat.
   *
   * Best effort. Failing a login that has already succeeded, because a cleanup
   * did not land, would be worse than a counter that is one too high for a few
   * minutes — and one too high fails in the safe direction.
   */
  async releaseAttempt(accountKey: string, ip: string | null): Promise<void> {
    const ipWindow = await this.configuration.get<number>(AUTH_LOGIN_IP_WINDOW_SECONDS.key);

    try {
      await Promise.all([
        this.redis.del(accountRedisKey(accountKey)),
        ip === null ? Promise.resolve() : this.release(ipRedisKey(ip), ipWindow),
      ]);
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Could not release the reservation after a successful login',
      );
    }
  }

  /**
   * Take a place in the counter and ensure an expiry, as one transaction.
   *
   * A fixed window, not a sliding one: the count expires as a whole rather than
   * per attempt. Re-setting the expiry on every failure would let an attacker
   * hold a victim's account locked indefinitely by continuing to fail — the
   * lockout would never age out while the attack continued. `NX` carries that
   * condition now: it sets a TTL only on a key that has none, so a window
   * already running is never extended.
   *
   * ## Why a transaction and not two commands
   *
   * The previous form issued `INCR`, then `EXPIRE` only when the counter came
   * back as 1. If Redis went away *between* those two commands — a failover, a
   * restart, or the single retry this connection allows running out — the
   * counter survived **with no expiry at all**, and no later attempt would set
   * one, because the count was no longer 1. The window silently became
   * infinite: failures accumulated forever until the ceiling was reached, and
   * then the lockout never aged out. Reproduced against a real Redis, on both
   * counters, with a correct password answering 429 while Redis was healthy.
   *
   * It is worst on the IP counter, which a successful login deliberately never
   * clears (D73): once that key loses its expiry it reaches its ceiling with
   * certainty, and blocks every user behind the address permanently.
   *
   * `MULTI`/`EXEC` closes it: Redis runs the queued commands as one unit, so
   * there is no interruption that can land between them. Lua would work too and
   * buys nothing here — the only conditional logic needed is `NX`, which the
   * command already carries.
   */
  private async reserve(key: string, windowSeconds: number): Promise<number> {
    return this.transact(key, windowSeconds, (chain) => chain.incr(key));
  }

  /**
   * Undoes one reservation.
   *
   * Runs through the same transaction as `reserve` for one reason that is not
   * symmetry: if the window elapsed between reserving and releasing, the key is
   * gone, and `DECR` on a missing key **creates it at -1 with no expiry** —
   * which is the permanent-key failure this transaction exists to prevent,
   * arriving through the back door. `EXPIRE … NX` in the same `EXEC` means a
   * resurrected key always carries one. A leftover 0 or -1 throttles nobody and
   * ages out on its own.
   */
  private async release(key: string, windowSeconds: number): Promise<number> {
    return this.transact(key, windowSeconds, (chain) => chain.decr(key));
  }

  private async transact(
    key: string,
    windowSeconds: number,
    command: (chain: ChainableCommander) => ChainableCommander,
  ): Promise<number> {
    const results = await command(this.redis.multi()).expire(key, windowSeconds, 'NX').exec();

    /*
     * `exec()` resolves with one `[error, result]` pair per queued command, and
     * a command that failed *on the server* does not reject the promise.
     * Ignoring that array would let a counter that never incremented — an
     * `INCR` against a key of the wrong type, say — pass silently as a recorded
     * failure. `null` means the transaction was discarded without running.
     */
    if (results === null) throw new Error('The login throttle transaction was discarded');

    const failure = results.find(([error]) => error !== null);
    if (failure) throw failure[0];

    // The counter's value after this attempt took its place in it.
    return Number(results[0]![1]);
  }
}

function accountRedisKey(accountKey: string): string {
  return `${KEY_PREFIX}:account:${accountKey}`;
}

function ipRedisKey(ip: string): string {
  return `${KEY_PREFIX}:ip:${ip}`;
}

/**
 * One message and one code for both scopes.
 *
 * Telling a caller *which* ceiling they hit would say whether the address they
 * are trying is interesting enough to have its own counter — the enumeration
 * leak this whole flow is arranged to avoid, arriving through the error body.
 */
function throttled(): DomainError {
  return new DomainError(
    ERROR_CODES.RATE_LIMITED,
    'Too many failed attempts. Please wait before trying again.',
    429,
  );
}
