import { ERROR_CODES } from '@gemone/contracts';

import { DomainError } from '../../../core/errors/app-error';

/**
 * Where the money goes — validated and masked.
 *
 * **Deliberately format-agnostic** (DECISIONS.md D43). A PayPal address, an
 * IBAN, and a wallet address share no shape, and per-method format rules in
 * code would contradict PROJECT.md §4.6's requirement that adding a method an
 * admin can settle by hand needs no deployment.
 *
 * Under a manual payout model the validator is the human who reads the
 * destination before sending the money. What this file does is make sure the
 * value is *storable and readable* — bounded, single-line, free of control
 * characters — so that what the admin sees is what the user typed.
 */

const MIN_LENGTH = 4;
const MAX_LENGTH = 200;

/** Anything that could break a terminal, a CSV export, or an admin's eye. */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

export function normalizeDestination(raw: string): string {
  const destination = raw.trim();

  if (destination.length < MIN_LENGTH || destination.length > MAX_LENGTH) {
    throw invalid(`must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters`);
  }

  if (CONTROL_CHARACTERS.test(destination)) {
    /*
     * Newlines and zero-width characters are not a format concern, they are a
     * legibility one: an admin copying a destination out of a review screen
     * must get the account the user meant, and an invisible character in the
     * middle of a wallet address is money sent nowhere.
     */
    throw invalid('must not contain line breaks or invisible characters');
  }

  return destination;
}

/**
 * Enough to recognise the account, not enough to be it.
 *
 * Shown to the owning user so they can confirm which account they picked
 * without a full payment destination sitting in every list response, browser
 * cache and screenshot (DATABASE.md §3.5).
 *
 * The last four characters are kept because that is the part a person
 * recognises — the domain of an email, the tail of an account number.
 */
export function maskDestination(destination: string): string {
  const visible = 4;

  if (destination.length <= visible) {
    // Too short to reveal anything partially without revealing all of it.
    return '•'.repeat(destination.length);
  }

  return '•'.repeat(Math.min(destination.length - visible, 12)) + destination.slice(-visible);
}

function invalid(message: string): DomainError {
  return new DomainError(
    ERROR_CODES.PAYOUT_DESTINATION_INVALID,
    `Payment destination ${message}`,
    422,
  );
}

export const __testing = { MIN_LENGTH, MAX_LENGTH };
