import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 hex of `base` keyed by the provider's postback secret. */
export function hmac(secret: string, base: string): string {
  return createHmac('sha256', secret).update(base).digest('hex');
}

/** Constant-time hex comparison; false on any length/format mismatch. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
