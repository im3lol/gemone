import { randomBytes } from 'crypto';

// Crockford-ish alphabet: no 0/O/1/I/L to keep shared codes unambiguous.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Short, URL-safe, human-shareable referral code. 31^8 space → collisions are rare;
 *  the DB unique constraint is the backstop (callers retry on P2002). */
export function genReferralCode(len = 8): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
