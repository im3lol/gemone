import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ListWallOffersQuery,
  type Paginated,
  type WallOffer,
} from '@gemone/contracts';

import { DomainError } from '../../core/errors/app-error';
import { ProviderRegistry } from '../providers/registry/provider-registry';
import { OffersService } from './offers.service';

/**
 * The offer wall — PROJECT.md §3.2, milestone M2.
 *
 * *"Browse an aggregated offer wall"* — the one user-facing surface the catalog
 * has never had. `offers` has stored and synced offers since Feature 6 and
 * `admin` has browsed them since Feature 6; nothing let a user see one.
 *
 * ## All this layer adds is eligibility
 *
 * `OffersService` owns the query and `ProviderRegistry` owns the answer to
 * "which providers may be used". This composes the two (§4.3) and does not
 * re-derive either — a second opinion about whether a provider is usable is
 * exactly how the wall and the click endpoint would drift apart.
 *
 * ## The invariant
 *
 * **Every offer this returns is one `ClicksService.create` would accept.**
 * That service refuses an inactive offer and then calls
 * `ProviderRegistry.require(slug)`, which refuses a disabled provider *and* one
 * whose adapter could not be built. The wall filters on the same two facts,
 * from the same registry.
 *
 * The failure it prevents is specific and expensive: an offer visible on the
 * wall whose click 409s, or worse, whose click succeeds against a provider we
 * cannot verify postbacks for — the user does the work, the conversion arrives
 * unverifiable and is quarantined, and PROJECT.md §3.2's "I completed this and
 * was not paid" support ticket writes itself.
 */
@Injectable()
export class OfferWallService {
  constructor(
    private readonly offers: OffersService,
    private readonly registry: ProviderRegistry,
  ) {}

  async list(query: ListWallOffersQuery): Promise<Paginated<WallOffer>> {
    const eligible = this.eligibleProviders();

    const page = await this.offers.findForWall(query, [...eligible.keys()]);

    return {
      ...page,
      items: page.items.map((offer) =>
        OffersService.toWallOffer(offer, eligible.get(offer.providerId) ?? UNKNOWN_PROVIDER),
      ),
    };
  }

  /**
   * One offer in full — the screen a user reads before deciding to click.
   *
   * **An ineligible offer is a 404, not a 403 or a 409.** A user has no
   * legitimate way to act on the difference between "no such offer", "this
   * offer was withdrawn" and "the provider behind it is switched off", and
   * distinguishing them turns the wall into an oracle for which providers we
   * run and what state they are in. `ClicksService` answers 409 for an
   * inactive offer because there the user has *chosen* something and deserves
   * to know it is unavailable; here they are browsing.
   */
  async detail(id: string): Promise<WallOffer> {
    const offer = await this.offers.findById(id);
    const eligible = this.eligibleProviders();
    const slug = offer ? eligible.get(offer.providerId) : undefined;

    if (!offer || !offer.isActive || slug === undefined) {
      throw new DomainError(ERROR_CODES.OFFER_NOT_FOUND, 'Offer not found', 404, { id });
    }

    return OffersService.toWallOffer(offer, slug);
  }

  /**
   * Provider id → slug, for every provider a click would be accepted for.
   *
   * From the in-memory registry, so it costs no query on the platform's most
   * requested authenticated read — which is what the registry exists for
   * (§7.3), and what §14.3 now keeps true on every process rather than only on
   * the one an admin happened to reach.
   */
  private eligibleProviders(): Map<string, string> {
    return new Map(this.registry.enabled().map((provider) => [provider.id, provider.slug]));
  }
}

/**
 * Unreachable in practice — the id came from the eligible set a line earlier.
 *
 * A literal rather than a throw: a slug that cannot be resolved is a cosmetic
 * problem on one card, and failing the whole wall over it would turn a
 * labelling glitch into an empty screen.
 */
const UNKNOWN_PROVIDER = 'unknown';
