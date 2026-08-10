import { describe, expect, it } from 'vitest';
import { PROVIDER_CAPABILITIES } from '@gemone/contracts';

import type { RawPostbackRequest } from '../../contracts/normalized';
import { ProviderResponseInvalidError } from '../../contracts/provider-errors';
import { MockProviderAdapter, mockProviderDefinition } from './mock.adapter';

import postbacks from './fixtures/postbacks.json';

/**
 * Contract tests — ARCHITECTURE.md §7.2, rule 6.
 *
 * Driven by the captured payloads in `fixtures/`, not by objects built to
 * match the parser. A test that constructs its own input always agrees with
 * the code that reads it; a fixture disagrees the moment a provider changes a
 * field, which is the drift these exist to catch.
 *
 * Every adapter added later gets a file shaped like this one.
 */

/** Committed in the fixture file, and authenticating nothing. */
const FIXTURE_SECRET = 'mock-fixture-secret';

function adapter(credentials: Record<string, string> = {}): MockProviderAdapter {
  return new MockProviderAdapter({
    slug: 'mock',
    credentials: { secret: FIXTURE_SECRET, affiliate_id: 'AFF-9001', ...credentials },
  });
}

function request(fixture: { query: Record<string, string>; sourceIp: string }): RawPostbackRequest {
  return { query: fixture.query, body: undefined, headers: {}, sourceIp: fixture.sourceIp };
}

describe('MockProviderAdapter', () => {
  describe('metadata', () => {
    it('declares the four mandatory capabilities', () => {
      const declared = adapter().metadata.capabilities;

      expect(declared).toContain(PROVIDER_CAPABILITIES.FETCH_OFFERS);
      expect(declared).toContain(PROVIDER_CAPABILITIES.BUILD_CLICK_URL);
      expect(declared).toContain(PROVIDER_CAPABILITIES.VERIFY_POSTBACK);
      expect(declared).toContain(PROVIDER_CAPABILITIES.PARSE_POSTBACK);
    });

    it('exposes metadata on the definition without constructing an adapter', () => {
      // The registry resolves credentials from this before it can build
      // anything. If metadata were only reachable on an instance, the
      // registry would have to construct with every prefix-matching variable
      // and hand one provider another's secrets.
      expect(mockProviderDefinition.metadata.requiredCredentials).toEqual([
        'secret',
        'affiliate_id',
      ]);
      expect(mockProviderDefinition.metadata.slug).toBe('mock');
    });
  });

  describe('fetchOffers', () => {
    it('normalizes the captured catalog response', async () => {
      const offers = await adapter().fetchOffers({
        country: null,
        device: null,
        segment: null,
      });

      const racer = offers.find((offer) => offer.externalId === 'MK-100241');

      expect(racer).toBeDefined();
      expect(racer!.title).toBe('Skyline Racer — reach level 12');
      // "2.45" USD, parsed by splitting on the decimal point. 2.45 * 100 is
      // 244.99999999999997 in binary floating point; money is never a float.
      expect(racer!.payoutAmountMinor).toBe(245);
      expect(racer!.payoutCurrency).toBe('USD');
      expect(racer!.isMultiStep).toBe(true);
      expect(racer!.devices).toEqual(['mobile']);
    });

    it('leaves provider categories unmapped — that rule belongs to `offers`', () => {
      // §7.5: mapping onto our own fixed set is a business rule operating on
      // already-normalized data. An adapter that guessed would put a business
      // rule inside a provider folder, where nobody can configure it.
      return adapter()
        .fetchOffers({ country: null, device: null, segment: null })
        .then((offers) => {
          const racer = offers.find((o) => o.externalId === 'MK-100241');
          expect(racer!.providerCategories).toEqual(['mobile_game', 'ios']);
        });
    });

    it('drops offers it cannot fully map rather than passing them on', async () => {
      const offers = await adapter().fetchOffers({
        country: null,
        device: null,
        segment: null,
      });

      // The fixture carries four campaigns; MK-100244 has an empty name and a
      // non-numeric payout. §7.2 rule 5: normalization is total — a
      // half-mapped offer is worse than a missing one, because it reaches the
      // wall and promises a user something nobody can pay.
      expect(offers).toHaveLength(3);
      expect(offers.map((o) => o.externalId)).not.toContain('MK-100244');
    });

    it('honours the targeting context it declares support for', async () => {
      const forGermany = await adapter().fetchOffers({
        country: 'DE',
        device: null,
        segment: null,
      });

      // MK-100241 is US/CA/GB and MK-100242 is US; MK-100243 declares no geo
      // restriction and therefore survives.
      expect(forGermany.map((o) => o.externalId)).toEqual(['MK-100243']);
    });

    it('filters by device', async () => {
      const desktop = await adapter().fetchOffers({
        country: null,
        device: 'desktop',
        segment: null,
      });

      expect(desktop.map((o) => o.externalId).sort()).toEqual(['MK-100242', 'MK-100243']);
    });
  });

  describe('buildClickUrl', () => {
    it('substitutes every placeholder, including the injected credential', () => {
      const url = adapter().buildClickUrl({
        trackingUrlTemplate:
          'https://track.mock-offers.test/click?cid={campaign_id}&aff={affiliate_id}&s1={sub_id}',
        externalOfferId: 'MK-100241',
        userReference: 'opaque-user-ref',
        subId: 'c3f1a0e2b9d4e77a',
      });

      expect(url).toBe(
        'https://track.mock-offers.test/click?cid=MK-100241&aff=AFF-9001&s1=c3f1a0e2b9d4e77a',
      );
    });

    it('is pure — identical inputs always produce an identical URL', () => {
      const context = {
        trackingUrlTemplate: 'https://track.mock-offers.test/click?cid={campaign_id}&aff={affiliate_id}&s1={sub_id}',
        externalOfferId: 'MK-100241',
        userReference: 'opaque-user-ref',
        subId: 'c3f1a0e2b9d4e77a',
      };

      // What makes a click reproducible from its stored row during a dispute.
      expect(adapter().buildClickUrl(context)).toBe(adapter().buildClickUrl(context));
    });

    it('encodes values rather than splicing them in raw', () => {
      const url = adapter().buildClickUrl({
        trackingUrlTemplate: 'https://track.mock-offers.test/click?cid={campaign_id}&aff={affiliate_id}&s1={sub_id}',
        externalOfferId: 'MK&evil=1',
        userReference: 'ref',
        subId: 'sub',
      });

      // Otherwise an offer id containing `&` adds parameters to our own
      // redirect — parameter injection through a provider's catalog.
      expect(url).toContain('cid=MK%26evil%3D1');
    });

    it('refuses to emit a URL with an unsubstituted placeholder', () => {
      // A click that the provider cannot attribute: the user does the work,
      // the conversion never arrives, and nobody can trace what they are owed.
      expect(() =>
        adapter().buildClickUrl({
          trackingUrlTemplate: 'https://track.mock-offers.test/click?cid={campaign_id}&x={unknown}',
          externalOfferId: 'MK-100241',
          userReference: 'ref',
          subId: 'sub',
        }),
      ).toThrow(ProviderResponseInvalidError);
    });
  });

  describe('verifyPostback', () => {
    it('accepts a captured, correctly signed postback', () => {
      expect(adapter().verifyPostback(request(postbacks.confirmed))).toEqual({ valid: true });
    });

    it('rejects a tampered payout, and says why', () => {
      const tampered = {
        ...postbacks.confirmed,
        query: { ...postbacks.confirmed.query, payout: '24.50' },
      };

      // The whole reason the signature covers the canonical parameter string:
      // an attacker who can call the endpoint must not be able to choose the
      // amount.
      expect(adapter().verifyPostback(request(tampered))).toEqual({
        valid: false,
        reason: 'signature mismatch',
      });
    });

    it('rejects a missing signature without throwing', () => {
      const { sig: _sig, ...rest } = postbacks.confirmed.query;

      // A forged postback on a public endpoint is an expected event, not a
      // fault. Throwing would fill the error log with noise that hides real
      // failures — and would return 500 to a request we simply decline.
      expect(adapter().verifyPostback(request({ ...postbacks.confirmed, query: rest }))).toEqual({
        valid: false,
        reason: 'missing sig parameter',
      });
    });

    it('rejects a repeated parameter instead of picking one', () => {
      const polluted = {
        ...postbacks.confirmed,
        query: { ...postbacks.confirmed.query, payout: ['2.45', '99.00'] as unknown as string },
      };

      // `?payout=2.45&payout=99.00` is exactly the shape of a
      // parameter-pollution attempt against a signature check: sign the first,
      // read the second.
      expect(adapter().verifyPostback(request(polluted)).valid).toBe(false);
    });

    it('rejects everything when no secret was injected', () => {
      const unconfigured = new MockProviderAdapter({ slug: 'mock', credentials: {} });

      // Fail closed. An adapter with no secret that accepted postbacks would
      // credit users from anything that reached the endpoint.
      expect(unconfigured.verifyPostback(request(postbacks.confirmed))).toEqual({
        valid: false,
        reason: 'signing secret is not configured',
      });
    });

    it('rejects a signature of the wrong length without throwing', () => {
      const short = {
        ...postbacks.confirmed,
        query: { ...postbacks.confirmed.query, sig: 'abc' },
      };

      // `timingSafeEqual` throws on a length mismatch, which would surface as
      // a 500 on a forged request.
      expect(() => adapter().verifyPostback(request(short))).not.toThrow();
      expect(adapter().verifyPostback(request(short)).valid).toBe(false);
    });
  });

  describe('parsePostback', () => {
    it('normalizes a confirmed conversion', () => {
      const conversion = adapter().parsePostback(request(postbacks.confirmed));

      expect(conversion).toEqual({
        subId: 'c3f1a0e2b9d4e77a',
        externalTransactionId: 'MK-TX-88213',
        payoutAmountMinor: 245,
        payoutCurrency: 'USD',
        status: 'confirmed',
        isReversal: false,
        externalOfferId: 'MK-100241',
        occurredAt: new Date('2026-01-14T10:03:11Z'),
      });
    });

    it('distinguishes a reversal from a rejection', () => {
      const conversion = adapter().parsePostback(request(postbacks.reversal));

      // A rejection never credited anything; a reversal takes back something
      // already credited. They produce different reward transactions, so
      // collapsing them would silently make one of the two wrong.
      expect(conversion.isReversal).toBe(true);
      expect(conversion.status).toBe('confirmed');
      expect(conversion.externalTransactionId).toBe('MK-TX-88213-R');
    });

    it('normalizes a pending conversion', () => {
      const conversion = adapter().parsePostback(request(postbacks.pending));

      expect(conversion.status).toBe('pending');
      expect(conversion.payoutAmountMinor).toBe(80);
    });

    it('refuses a postback with no transaction id', () => {
      const { transaction_id: _tx, ...rest } = postbacks.confirmed.query;

      // Without it there is no idempotency key, so the same conversion could
      // be credited twice — the failure DATABASE.md §9.1 calls the most
      // important index in the database.
      expect(() =>
        adapter().parsePostback(request({ ...postbacks.confirmed, query: rest })),
      ).toThrow(ProviderResponseInvalidError);
    });

    it('refuses a postback whose payout cannot be parsed', () => {
      const broken = {
        ...postbacks.confirmed,
        query: { ...postbacks.confirmed.query, payout: '1.2345' },
      };

      expect(() => adapter().parsePostback(request(broken))).toThrow(
        ProviderResponseInvalidError,
      );
    });

    it('refuses a currency it does not quote in', () => {
      const jpy = {
        ...postbacks.confirmed,
        query: { ...postbacks.confirmed.query, currency: 'JPY' },
      };

      // JPY has no minor unit. Assuming two decimals would be wrong by a
      // factor of 100 — so it is rejected rather than guessed at.
      expect(() => adapter().parsePostback(request(jpy))).toThrow(ProviderResponseInvalidError);
    });
  });
});
