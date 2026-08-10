import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@gemone/contracts';
import type { Redis } from 'ioredis';

import { ConfigurationService } from '../../core/config/configuration.service';
import { DomainError, InfrastructureError } from '../../core/errors/app-error';
import { AUTH_PUBLIC_IP_WINDOW_SECONDS, AUTH_PUBLIC_MAX_REQUESTS_PER_IP } from './auth.config';
import { LOGIN_THROTTLE_REDIS } from './auth.tokens';

/** `ow:<schema-version>:<domain>:<identifier>` — §14.4. */
const KEY_PREFIX = 'ow:1:public-throttle';

/**
 * A request ceiling for the public auth endpoints — ARCHITECTURE.md §19.5.
 *
 * §19.5 promises three overlapping layers and, until this existed, only `login`
 * had one: `register`, `forgot-password`, `verify-email`, `reset-password` and
 * `refresh` were unauthenticated and unbounded. The one that costs money is
 * `forgot-password` — each call sends mail from our domain to an address the
 * caller chose, so an unbounded loop is both a way to flood a stranger's inbox
 * and the fastest way to get a new sending domain blocked.
 *
 * ## Per address only, never per account
 *
 * The login throttle counts two things, because password guessing has two
 * shapes. This counts one, deliberately. A per-account ceiling here would be an
 * enumeration oracle: `forgot-password` answers 204 for every address precisely
 * so that a registered one and an unregistered one are indistinguishable, and a
 * counter that only ever fills up for real accounts would answer the question
 * the 204 refuses to. There is no account key in this file, and there should
 * never be one.
 *
 * ## One bucket per endpoint
 *
 * Keyed by the handler, so registering does not consume the allowance for
 * refreshing a session — and so the response tells the caller nothing they
 * could not work out by counting their own requests.
 *
 * ## Counted the same way the login throttle counts
 *
 * `INCR` first, then compare (D-note in `LoginThrottleService`): reading the
 * counter and incrementing after the verdict lets every request that arrives
 * inside the gap read the same number, which is exactly the shape a burst has.
 * The count therefore includes the request being judged, and the comparison is
 * `>` so the `limit`-th request is the last one allowed.
 *
 * The `EXPIRE … NX` shares the transaction for the same reason it does there: a
 * counter that loses its expiry never ages out, and an IP-keyed counter that
 * never ages out eventually blocks everyone behind that address permanently.
 */
@Injectable()
export class PublicThrottleService {
  private readonly logger = new Logger(PublicThrottleService.name);

  constructor(
    @Inject(LOGIN_THROTTLE_REDIS) private readonly redis: Redis,
    private readonly configuration: ConfigurationService,
  ) {}

  /**
   * Takes this request's place in the endpoint's counter, and refuses it if
   * that place is past the ceiling.
   *
   * **Fail closed** (§15.4), consistently with the login throttle: an
   * unavailable control is not a reason to stop controlling. The cost is real
   * and is the same cost T60 already records — a Redis outage refuses these
   * endpoints rather than admitting them uncounted.
   */
  async reserve(bucket: string, ip: string | null): Promise<void> {
    /*
     * An unidentified caller is not counted.
     *
     * The same choice the login and click limits make: with no address there is
     * nothing to key on but a bucket every anonymous caller would share, and
     * one of them could then lock out all the others. Behind Caddy this does
     * not arise — `trust proxy` is set and every request has an address.
     */
    if (ip === null) return;

    const [limit, windowSeconds] = await Promise.all([
      this.configuration.get<number>(AUTH_PUBLIC_MAX_REQUESTS_PER_IP.key),
      this.configuration.get<number>(AUTH_PUBLIC_IP_WINDOW_SECONDS.key),
    ]);

    let requests: number;

    try {
      requests = await this.reserveIn(redisKey(bucket, ip), windowSeconds);
    } catch (error) {
      this.logger.error(
        { bucket, err: error instanceof Error ? error.message : String(error) },
        'Public endpoint throttle counters are unusable; refusing the request',
      );

      throw new InfrastructureError('This service is temporarily unavailable', {
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        httpStatus: 503,
        retryable: true,
      });
    }

    if (requests > limit) {
      // The address is logged, the endpoint is logged, and nothing about who
      // was being asked for — there is no email in scope here to leak.
      this.logger.warn({ bucket, requests, limit }, 'Public endpoint throttled');
      throw throttled();
    }
  }

  /**
   * Take a place in the counter and ensure an expiry, as one transaction.
   *
   * Returns the counter's value *after* this request took its place in it.
   */
  private async reserveIn(key: string, windowSeconds: number): Promise<number> {
    const results = await this.redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();

    // `exec()` resolves with one `[error, result]` pair per command, and a
    // command that failed on the server does not reject. Ignoring that array
    // would let a counter that never incremented pass as a recorded request.
    if (results === null) throw new Error('The public throttle transaction was discarded');

    const failure = results.find(([error]) => error !== null);
    if (failure) throw failure[0];

    return Number(results[0]![1]);
  }
}

function redisKey(bucket: string, ip: string): string {
  return `${KEY_PREFIX}:${bucket}:${ip}`;
}

/**
 * One message for every endpoint behind this control.
 *
 * Says how to recover and nothing else. Naming the endpoint, the limit or the
 * remaining allowance would tell a caller how to pace an attack precisely, and
 * on `forgot-password` any difference in the answer is a difference an
 * enumerator can read.
 */
function throttled(): DomainError {
  return new DomainError(
    ERROR_CODES.RATE_LIMITED,
    'Too many requests. Please wait before trying again.',
    429,
  );
}
