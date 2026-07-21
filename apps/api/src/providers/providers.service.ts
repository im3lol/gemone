import { Injectable, Logger } from '@nestjs/common';
import { AdgemAdapter } from './adgem.adapter';
import { CpxAdapter } from './cpx.adapter';
import type { Offer, OfferContext, ProviderAdapter } from './provider.types';

type CacheEntry = { offers: Offer[]; expires: number };

// ponytail: in-memory offer cache (short TTL). Swap for Redis when we run more
// than one API instance — see IMPLEMENTATION_PLAN phase 2.
const CACHE_TTL_MS = 60_000;

@Injectable()
export class ProvidersService {
  private readonly log = new Logger(ProvidersService.name);
  private readonly adapters: ProviderAdapter[];
  private readonly cache = new Map<string, CacheEntry>();

  constructor(adgem: AdgemAdapter, cpx: CpxAdapter) {
    this.adapters = [adgem, cpx];
  }

  get(key: string): ProviderAdapter | undefined {
    return this.adapters.find((a) => a.key === key);
  }

  async getOffers(ctx: OfferContext): Promise<Offer[]> {
    const cacheKey = `${ctx.userId}:${ctx.country ?? '*'}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.offers;

    const enabled = this.adapters.filter((a) => a.enabled());
    const results = await Promise.all(
      enabled.map(async (a) => {
        try {
          return await a.fetchOffers(ctx);
        } catch (err) {
          this.log.error(`fetchOffers failed for ${a.key}: ${String(err)}`);
          return [] as Offer[]; // one network down must not break the wall
        }
      }),
    );

    const offers = results
      .flat()
      .filter((o) => geoAllowed(o, ctx.country))
      .sort((a, b) => b.points - a.points);

    this.cache.set(cacheKey, { offers, expires: Date.now() + CACHE_TTL_MS });
    return offers;
  }
}

function geoAllowed(offer: Offer, country: string | null): boolean {
  if (offer.countries.length === 0) return true; // worldwide
  if (!country) return true; // unknown user geo → don't hide offers
  return offer.countries.includes(country);
}
