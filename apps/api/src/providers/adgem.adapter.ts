import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hmac, safeEqualHex } from './signature';
import type {
  Offer,
  OfferContext,
  ParsedPostback,
  PostbackQuery,
  ProviderAdapter,
} from './provider.types';

// AdGem-style adapter. Postback params: sub_id, transaction_id, amount, offer_id,
// offer_name, status (1=credit, 2=reversal), verifier=HMAC(sub_id:transaction_id:amount).
@Injectable()
export class AdgemAdapter implements ProviderAdapter {
  readonly key = 'adgem';
  readonly name = 'AdGem';

  constructor(private readonly config: ConfigService) {}

  private secret() {
    return this.config.get<string>('ADGEM_POSTBACK_SECRET', '');
  }

  enabled() {
    return !!this.config.get<string>('ADGEM_APP_ID');
  }

  async fetchOffers(ctx: OfferContext): Promise<Offer[]> {
    // ponytail: mock catalog. Replace with a real call to the AdGem Offer API
    // (appid + player_id) and map its rows into Offer[]. Shape is what matters here.
    const appId = this.config.get<string>('ADGEM_APP_ID', 'demo');
    const track = this.config.get<string>('ADGEM_TRACK_URL', 'https://api.adgem.com/v1/track');
    const raw = [
      { id: 'raid', title: 'RAID: Shadow Legends', description: 'Complete level 20', points: 8400, category: 'game', difficulty: 'Hard', icon: 'R', color: '#b91c1c', countries: ['US', 'GB', 'DE'] },
      { id: 'monopoly', title: 'MONOPOLY GO!', description: 'Reach board 10', points: 6000, category: 'game', difficulty: 'Easy', icon: 'M', color: '#dc2626', countries: [] },
      { id: 'sofi', title: 'Sofi: Bank & Invest', description: 'Create an account', points: 3200, category: 'signup', difficulty: 'Easy', icon: 'S', color: '#4f46e5', countries: ['US'] },
      { id: 'tiktok', title: 'TikTok', description: 'Install and open', points: 2400, category: 'app', difficulty: 'Easy', icon: 'T', color: '#111827', countries: [] },
    ] as const;

    return raw.map((o) => ({
      id: `${this.key}:${o.id}`,
      provider: this.key,
      title: o.title,
      description: o.description,
      points: o.points,
      payoutUsd: (o.points / 1000).toFixed(2),
      category: o.category as Offer['category'],
      difficulty: o.difficulty as Offer['difficulty'],
      icon: o.icon,
      color: o.color,
      countries: [...o.countries],
      clickUrl: `${track}?appid=${appId}&sub_id=${encodeURIComponent(ctx.userId)}&offer_id=${o.id}`,
    }));
  }

  verify(q: PostbackQuery): boolean {
    const base = `${q.sub_id ?? ''}:${q.transaction_id ?? ''}:${q.amount ?? ''}`;
    return safeEqualHex(q.verifier ?? '', hmac(this.secret(), base));
  }

  parse(q: PostbackQuery): ParsedPostback | null {
    const userId = q.sub_id;
    const transactionId = q.transaction_id;
    const points = Number(q.amount);
    if (!userId || !transactionId || !Number.isFinite(points)) return null;
    return {
      transactionId,
      userId,
      points: Math.abs(Math.trunc(points)),
      type: q.status === '2' ? 'reversal' : 'credit',
      offerId: q.offer_id,
      title: q.offer_name ?? 'Offer Completed',
    };
  }

  ack() {
    return '1'; // AdGem expects a "1" acknowledgement.
  }
}
