import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  POSTBACK_SIGNING_SCHEMES,
  PROVIDER_CAPABILITIES,
  type DeviceType,
} from '@gemone/contracts';

import type {
  OfferProviderAdapter,
  ProviderAdapterContext,
  ProviderAdapterDefinition,
  ProviderAdapterMetadata,
} from '../../contracts/provider-adapter';
import type {
  ClickUrlContext,
  ConversionStatus,
  NormalizedConversion,
  NormalizedOffer,
  OfferQueryContext,
  PostbackVerification,
  RawPostbackRequest,
} from '../../contracts/normalized';
import { ProviderResponseInvalidError } from '../../contracts/provider-errors';

import offersFixture from './fixtures/offers.response.json';

/**
 * A complete, working offerwall adapter that talks to no network.
 *
 * **This file is the proof of P1.** It was written last, after the registry,
 * the provider table, the lifecycle, the health machinery and the admin
 * surface already existed — and adding it required exactly what
 * ARCHITECTURE.md §7.4's checklist promises: this folder, its fixtures, its
 * tests, and one line in the registry map. Zero changes to anything else.
 * `provider-independence.spec.ts` asserts that mechanically, so the claim
 * cannot quietly stop being true.
 *
 * It is also the adapter every later feature develops against. A catalog sync
 * job, a click redirect, and a postback handler can all be built and tested
 * end to end before a single real network contract is signed — which is worth
 * far more than it costs, because the alternative is discovering that the
 * abstraction does not fit only once integration work has started.
 *
 * The dialect it speaks is deliberately *awkward*: payouts as decimal strings,
 * status as "0"/"1", reversal as a separate flag, a template URL with
 * placeholders, and an HMAC over sorted query parameters. A mock that spoke
 * our own vocabulary would prove nothing — normalization would have nothing
 * to do, and the interface would look adequate right up until a real network
 * arrived.
 */

/** ISO-4217 currencies this provider quotes in. See `toMinorUnits`. */
const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR']);

const MOCK_METADATA: ProviderAdapterMetadata = {
  slug: 'mock',
  displayName: 'Mock Offerwall',
  postbackSigningScheme: POSTBACK_SIGNING_SCHEMES.HMAC_SHA256,

  /**
   * Documentation-style ranges. TEST-NET-3 (RFC 5737) is used precisely
   * because it can never be a real host, so a copy-paste into a production
   * provider row matches nothing rather than trusting someone's address.
   */
  publishedIpRanges: ['203.0.113.0/24'],

  capabilities: [
    PROVIDER_CAPABILITIES.FETCH_OFFERS,
    PROVIDER_CAPABILITIES.BUILD_CLICK_URL,
    PROVIDER_CAPABILITIES.VERIFY_POSTBACK,
    PROVIDER_CAPABILITIES.PARSE_POSTBACK,
    PROVIDER_CAPABILITIES.REVERSALS,
    PROVIDER_CAPABILITIES.OFFER_TARGETING,
  ],

  /**
   * `PROVIDER_MOCK_SECRET` and `PROVIDER_MOCK_AFFILIATE_ID`.
   *
   * Not decoration: the secret is the actual input to the signing scheme, and
   * the affiliate id is substituted into every click URL. An adapter whose
   * credentials were unused would be demonstrating the mechanism rather than
   * using it, and the registry's "enabled provider, missing credential →
   * inert with a readable reason" path would never be exercised by anything
   * real.
   */
  requiredCredentials: ['secret', 'affiliate_id'],
};

export class MockProviderAdapter implements OfferProviderAdapter {
  readonly metadata = MOCK_METADATA;

  private readonly secret: string;
  private readonly affiliateId: string;

  constructor(context: ProviderAdapterContext) {
    // Credentials are read here and nowhere else. An adapter never reads the
    // process environment itself (§7.2, rule 3) — otherwise credential
    // handling is duplicated per provider and audited nowhere.
    //
    // Note the absence of validation: the registry checks that every declared
    // credential is present, *after* construction, so a missing secret makes
    // this provider inert with a readable reason instead of killing the boot.
    this.secret = context.credentials.secret ?? '';
    this.affiliateId = context.credentials.affiliate_id ?? '';
  }

  /**
   * Serves the captured fixture, filtered by the targeting context.
   *
   * A real adapter issues an HTTP request here and maps transport failures
   * onto the four normalized errors (§7.2, rule 4). The mapping is the only
   * part this cannot demonstrate without a network; everything downstream of
   * the response — normalization, dropping unmappable records, targeting — is
   * the same code path a real adapter runs.
   */
  async fetchOffers(context: OfferQueryContext): Promise<NormalizedOffer[]> {
    const campaigns = offersFixture.campaigns;

    const normalized: NormalizedOffer[] = [];

    for (const campaign of campaigns) {
      const offer = this.normalizeCampaign(campaign);

      if (!offer) {
        // §7.2 rule 5: normalization is total. An offer that cannot be fully
        // mapped is dropped rather than passed on half-built — and the drop
        // is surfaced, because silent drops are how a provider's catalog
        // shrinks by 40% and nobody notices for a week.
        //
        // Reported by returning fewer offers than the response contained;
        // the sync job records the difference on `offer_sync_runs`. The
        // adapter does not log, because it has no logger — it is a pure
        // translator with no injected dependencies (§7.2, rule 1).
        continue;
      }

      if (!matchesTargeting(offer, context)) continue;

      normalized.push(offer);
    }

    return normalized;
  }

  /**
   * Pure. No I/O, no clock, no randomness — the same inputs always produce
   * the same URL, which is what makes a click reproducible from its stored
   * row during a dispute.
   */
  buildClickUrl(context: ClickUrlContext): string {
    const url = context.trackingUrlTemplate
      .replaceAll('{campaign_id}', encodeURIComponent(context.externalOfferId))
      .replaceAll('{affiliate_id}', encodeURIComponent(this.affiliateId))
      .replaceAll('{sub_id}', encodeURIComponent(context.subId));

    if (url.includes('{')) {
      // An unsubstituted placeholder would send the user to a URL the
      // provider cannot attribute — the click happens, the conversion never
      // arrives, and the user is owed points nobody can trace.
      throw new ProviderResponseInvalidError(
        this.metadata.slug,
        'Tracking URL still contains unsubstituted placeholders',
        { externalOfferId: context.externalOfferId },
      );
    }

    return url;
  }

  /**
   * HMAC-SHA256 over the sorted query parameters, excluding the signature.
   *
   * Constant-time comparison, because a byte-by-byte `===` leaks how much of
   * a guessed signature was correct, and a postback endpoint is public and
   * unrate-limited by design (it has to accept whatever the provider sends).
   *
   * The source IP is deliberately NOT checked here. `metadata.publishedIpRanges`
   * is what the provider's documentation claims; the ranges an operator
   * actually enforces live on the provider row, changeable at 2 a.m. without a
   * deploy. Enforcing the adapter's copy would mean a provider changing their
   * egress addresses needs a code release, so source-IP checking belongs to
   * the postback surface, against the row.
   */
  verifyPostback(request: RawPostbackRequest): PostbackVerification {
    if (this.secret.length === 0) {
      return { valid: false, reason: 'signing secret is not configured' };
    }

    const provided = single(request.query.sig);
    if (!provided) return { valid: false, reason: 'missing sig parameter' };

    const expected = createHmac('sha256', this.secret)
      .update(canonicalize(request.query))
      .digest('hex');

    const providedBuffer = Buffer.from(provided, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    // `timingSafeEqual` throws on a length mismatch, which would itself be a
    // timing signal — and a thrown error here would surface as a 500 on a
    // forged request rather than a rejection.
    if (providedBuffer.length !== expectedBuffer.length) {
      return { valid: false, reason: 'signature mismatch' };
    }

    if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
      return { valid: false, reason: 'signature mismatch' };
    }

    return { valid: true };
  }

  /**
   * Called only after `verifyPostback` returned valid.
   *
   * Deliberately not merged with verification: parsing an unverified payload
   * to decide whether to verify it is how a forged field gets read before it
   * is trusted.
   */
  parsePostback(request: RawPostbackRequest): NormalizedConversion {
    const query = request.query;

    const subId = single(query.sub_id);
    const externalTransactionId = single(query.transaction_id);

    if (!subId || !externalTransactionId) {
      // Without both, there is no attribution and no idempotency key
      // (DATABASE.md §9.1) — the postback cannot be safely processed at all.
      throw new ProviderResponseInvalidError(
        this.metadata.slug,
        'Postback is missing sub_id or transaction_id',
      );
    }

    const currency = (single(query.currency) ?? '').toUpperCase();
    const payoutMinor = toMinorUnits(single(query.payout), currency);

    if (payoutMinor === null) {
      throw new ProviderResponseInvalidError(
        this.metadata.slug,
        'Postback carries an unusable payout amount',
        { externalTransactionId },
      );
    }

    return {
      subId,
      externalTransactionId,
      payoutAmountMinor: payoutMinor,
      payoutCurrency: currency,
      status: toStatus(single(query.status)),
      isReversal: single(query.reversed) === '1',
      externalOfferId: single(query.campaign_id) ?? null,
      occurredAt: toDate(single(query.event_time)),
    };
  }

  // --- Normalization ------------------------------------------------------

  private normalizeCampaign(campaign: RawCampaign): NormalizedOffer | null {
    const externalId = campaign.campaign_id?.trim();
    const title = campaign.name?.trim();
    const currency = campaign.payout_currency?.toUpperCase();

    if (!externalId || !title || !currency) return null;

    const payoutAmountMinor = toMinorUnits(campaign.payout, currency);
    if (payoutAmountMinor === null || payoutAmountMinor <= 0) return null;

    if (!campaign.tracking_url?.includes('{sub_id}')) {
      // A tracking URL with nowhere to put our sub id cannot be attributed,
      // so the offer is worthless to us however good the payout looks.
      return null;
    }

    const devices = (campaign.platforms ?? []).filter(isDeviceType);
    if (devices.length === 0) return null;

    return {
      externalId,
      title,
      description: campaign.short_desc?.trim() || null,
      requirements: campaign.instructions?.trim() || null,
      payoutAmountMinor,
      payoutCurrency: currency,

      // Left as the provider's own strings. Mapping them onto our fixed set
      // is a business rule owned by `offers` (§7.5), not by an adapter.
      providerCategories: campaign.categories ?? [],

      countries: (campaign.geo ?? []).map((code) => code.toUpperCase()),
      devices,
      imageUrl: campaign.thumbnail ?? null,
      trackingUrlTemplate: campaign.tracking_url,
      isMultiStep: campaign.multi_step === true,
    };
  }
}

/**
 * The registry entry — ARCHITECTURE.md §7.4, step 5.
 *
 * Metadata is exposed here, without an instance, because the registry has to
 * know which credentials to resolve before it can construct anything.
 */
export const mockProviderDefinition: ProviderAdapterDefinition = {
  metadata: MOCK_METADATA,
  create: (context) => new MockProviderAdapter(context),
};

// --- Provider dialect helpers, private to this adapter --------------------

interface RawCampaign {
  campaign_id?: string;
  name?: string;
  short_desc?: string | null;
  instructions?: string | null;
  payout?: string;
  payout_currency?: string;
  categories?: string[];
  geo?: string[];
  platforms?: string[];
  thumbnail?: string | null;
  tracking_url?: string;
  multi_step?: boolean;
}

/**
 * Decimal string to integer minor units.
 *
 * Parsed by splitting on the decimal point rather than multiplying a float:
 * `2.45 * 100` is `244.99999999999997`, and rounding that happens to work
 * until the day it does not. Money is never a float (DATABASE.md §5).
 *
 * Assumes a two-decimal exponent, which holds for every currency this
 * provider quotes in. A zero-decimal currency (JPY) would be silently wrong
 * by a factor of 100 — so it is rejected rather than assumed. When a second
 * adapter needs this, it becomes the `shared/value-objects/Money` that
 * ARCHITECTURE.md §3 reserves a place for; one caller does not justify it yet
 * (P6).
 */
function toMinorUnits(amount: string | undefined, currency: string): number | null {
  if (!amount || !SUPPORTED_CURRENCIES.has(currency)) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) return null;

  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  return negative ? -minor : minor;
}

function toStatus(raw: string | undefined): ConversionStatus {
  if (raw === '1') return 'confirmed';
  if (raw === '2') return 'rejected';
  return 'pending';
}

function toDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDeviceType(value: string): value is DeviceType {
  return value === 'desktop' || value === 'mobile' || value === 'tablet';
}

/**
 * Query values arrive as `string | string[]` because a repeated parameter is
 * legal HTTP. A repeat is taken as hostile rather than resolved to the first
 * or last value: `?payout=1.00&payout=99.00` is exactly the shape of a
 * parameter-pollution attempt against a signature check.
 */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** `key=value` pairs, sorted by key, excluding the signature itself. */
function canonicalize(query: Readonly<Record<string, string | string[] | undefined>>): string {
  return Object.keys(query)
    .filter((key) => key !== 'sig')
    .sort()
    .map((key) => `${key}=${single(query[key]) ?? ''}`)
    .join('&');
}

function matchesTargeting(offer: NormalizedOffer, context: OfferQueryContext): boolean {
  if (context.country && offer.countries.length > 0) {
    if (!offer.countries.includes(context.country.toUpperCase())) return false;
  }

  if (context.device && !offer.devices.includes(context.device)) return false;

  return true;
}

export const __testing = { toMinorUnits, canonicalize, toStatus };
