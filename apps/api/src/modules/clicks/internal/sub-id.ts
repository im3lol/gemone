import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The signed, opaque click identifier — ARCHITECTURE.md §19.2, PROJECT.md §4.3.
 *
 * Shape: `<token>.<signature>`, both base64url.
 *
 * **Why it is opaque.** It never contains a raw user id. A provider receives
 * it, logs it, and may leak it; anything derivable from it is effectively
 * public. An identifier that encoded a user would let anyone who saw one
 * enumerate accounts, and let anyone who guessed one forge a credit into
 * somebody else's balance.
 *
 * **Why it is random rather than the click's primary key.** Our ids are
 * UUIDv7, which embeds a timestamp and sorts monotonically — handing those out
 * would publish both our click volume and a walkable sequence. The token is 16
 * bytes from the CSPRNG and carries no information at all.
 *
 * **Why it is signed.** The postback surface is public and unauthenticated by
 * necessity (§19.2). Without a signature, every forged `sub_id` costs a
 * database lookup, so an attacker can drive load with no credentials at all,
 * and a lookup miss cannot distinguish "never existed" from "expired". The
 * signature answers "was this ever one of ours" in microseconds, before any
 * I/O.
 *
 * Kept inside `clicks` rather than promoted to `core/security`. The module
 * owns `sub_id`, and the one other component that will resolve one —
 * `conversions` — calls `ClicksService`, exactly as §11.2 requires. A shared
 * helper would exist for a caller that should not be verifying these itself.
 */

/** 16 bytes of entropy. Guessing one is not a strategy anyone can run. */
const TOKEN_BYTES = 16;

/**
 * 16 bytes of HMAC-SHA256, truncated.
 *
 * Truncation is deliberate and safe here: the signature only has to make
 * forgery infeasible for the lifetime of an attribution window, and 128 bits
 * does that with room to spare. The alternative — a full 32-byte digest —
 * doubles the length of a string that gets pasted into provider dashboards and
 * support tickets for no security gain.
 */
const SIGNATURE_BYTES = 16;

/** Rejects obvious junk before any crypto runs. */
const SUB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{1,64}$/;

export class SubIdSigner {
  constructor(private readonly secret: string) {
    if (secret.length < 32) {
      // A short signing key is brute-forceable offline against any captured
      // sub_id, and a forged one is indistinguishable from a real one.
      throw new Error('Click signing secret must be at least 32 characters');
    }
  }

  /** Mints a fresh, signed identifier. */
  issue(): string {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return `${token}.${this.sign(token)}`;
  }

  /**
   * Verifies the signature. Does not touch the database.
   *
   * Returns a boolean rather than throwing: an invalid `sub_id` on a public
   * postback endpoint is an expected event, not a fault, and turning it into
   * an exception fills the error log with noise that hides real failures.
   */
  verify(subId: string): boolean {
    if (!SUB_ID_PATTERN.test(subId)) return false;

    const separator = subId.indexOf('.');
    const token = subId.slice(0, separator);
    const provided = subId.slice(separator + 1);

    const expectedBuffer = Buffer.from(this.sign(token), 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');

    /*
     * `timingSafeEqual` throws on a length mismatch — which would itself be a
     * timing signal, and would surface as a 500 on a request we simply mean to
     * decline. Compared separately, then in constant time.
     */
    if (expectedBuffer.length !== providedBuffer.length) return false;

    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  /**
   * A stable, non-reversible reference to a user, for providers that want one.
   *
   * Derived from the user id by HMAC, so it is consistent across that user's
   * clicks — a provider can recognise a returning user — while telling them
   * nothing about who it is and giving them nothing they could replay against
   * us. The raw user id is never sent to a provider (PROJECT.md §4.3).
   */
  userReference(userId: string): string {
    return createHmac('sha256', this.secret)
      .update(`user:${userId}`)
      .digest('base64url')
      .slice(0, 22);
  }

  private sign(token: string): string {
    return createHmac('sha256', this.secret)
      .update(token)
      .digest()
      .subarray(0, SIGNATURE_BYTES)
      .toString('base64url');
  }
}

export const __testing = { TOKEN_BYTES, SIGNATURE_BYTES, SUB_ID_PATTERN };
