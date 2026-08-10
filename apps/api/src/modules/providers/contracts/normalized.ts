import type { DeviceType } from '@gemone/contracts';

/**
 * The vocabulary an adapter translates *into* — ARCHITECTURE.md §7.1.
 *
 * Every type here is provider-agnostic by construction. If a field could only
 * be filled by one network, it does not belong in this file; it belongs
 * inside that network's adapter, where it dies.
 *
 * §7.2 rule 5 — **normalization is total**. An adapter never returns a
 * partially normalized offer with provider-specific leftovers. If a field
 * cannot be mapped, the offer is dropped and the drop is logged with a
 * reason. That is why nothing below is `Record<string, unknown>`: an escape
 * hatch for "the bits we could not map" is how provider knowledge leaks into
 * the catalog and, from there, into business logic.
 */

/** Targeting the catalog sync passes down. Optional everywhere — a provider that ignores it simply returns its full catalog. */
export interface OfferQueryContext {
  /** ISO-3166 alpha-2, uppercase. */
  country: string | null;
  device: DeviceType | null;
  /** Reserved for per-segment catalogs. Nothing produces one yet. */
  segment: string | null;
}

/**
 * One offer, normalized.
 *
 * `providerCategories` is the deliberate exception to "no provider-specific
 * leftovers", and it is not one: §7.5 assigns category mapping to the
 * `offers` module, because mapping onto *our* fixed set is a business rule
 * operating on already-normalized data. The adapter's job is to surface the
 * provider's category strings in a known field; deciding what they mean is
 * not the adapter's call.
 */
export interface NormalizedOffer {
  /** Unique within this provider. Half of `(provider_id, external_offer_id)`. */
  externalId: string;
  title: string;
  description: string | null;
  /** What the user must actually do. The most common source of disputes. */
  requirements: string | null;

  /**
   * Provider payout in **minor units** (DATABASE.md §5): an integer, never a
   * float. Floating-point money is how a cent goes missing and never comes
   * back. Conversion to points happens in `offers` using the provider's
   * configured reward rate (P3) — never here.
   */
  payoutAmountMinor: number;
  /** ISO-4217, uppercase. */
  payoutCurrency: string;

  providerCategories: string[];
  /** ISO-3166 alpha-2. Empty means "no restriction the provider told us about". */
  countries: string[];
  devices: DeviceType[];

  imageUrl: string | null;

  /**
   * The provider's click URL with placeholders still in it. `buildClickUrl`
   * substitutes; the template is carried on the offer so the click path needs
   * no second provider call.
   */
  trackingUrlTemplate: string;

  /** Multi-step offers pay out in stages, which the reward flow treats differently. */
  isMultiStep: boolean;
}

/** Everything `buildClickUrl` is allowed to know. Note the absence of the user's identity. */
export interface ClickUrlContext {
  trackingUrlTemplate: string;
  externalOfferId: string;
  /**
   * An opaque, non-reversible reference to the user.
   *
   * NOT the user id, and never the email. A provider receives this, logs it,
   * and may leak it; it must not be usable to identify or enumerate accounts.
   */
  userReference: string;
  /** Already signed by `clicks`. The adapter places it, it does not mint it. */
  subId: string;
}

/**
 * An inbound postback, exactly as it arrived.
 *
 * Handed to the adapter unparsed because signature verification is defined
 * over the *raw* representation: re-serialising a body, or normalising header
 * case, changes the bytes the signature was computed over and turns every
 * postback into a rejection.
 */
export interface RawPostbackRequest {
  query: Readonly<Record<string, string | string[] | undefined>>;
  body: unknown;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The connecting address, already resolved through the trusted proxy. */
  sourceIp: string;
  /** The exact bytes, when the scheme signs the body. */
  rawBody?: string;
}

/**
 * The verification verdict.
 *
 * A discriminated union rather than a boolean so a rejection carries its
 * reason. "Postback rejected" with no reason is unactionable at 2 a.m., and
 * the reason must not be an exception — a forged postback is an expected
 * event on a public endpoint, not a fault.
 */
export type PostbackVerification =
  | { valid: true }
  | { valid: false; reason: string };

/** Conversion status, normalized across networks that all name these differently. */
export type ConversionStatus = 'confirmed' | 'pending' | 'rejected';

/** One conversion, normalized. */
export interface NormalizedConversion {
  /** Links back to the click. Without it there is no attribution and no credit. */
  subId: string;

  /**
   * The provider's own transaction id — the other half of the idempotency
   * key `(provider_id, external_transaction_id)`, which DATABASE.md §9.1
   * calls the most important index in the database.
   */
  externalTransactionId: string;

  payoutAmountMinor: number;
  payoutCurrency: string;
  status: ConversionStatus;

  /**
   * A chargeback of an earlier conversion. Separate from `status: rejected`:
   * a rejection never credited anything, a reversal takes back something
   * already credited, and the two produce different reward transactions.
   */
  isReversal: boolean;

  externalOfferId: string | null;
  /** When the provider says it happened. Null when the payload omits it. */
  occurredAt: Date | null;
}
