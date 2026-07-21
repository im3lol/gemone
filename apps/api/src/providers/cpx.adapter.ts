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

// CPX-style adapter — deliberately different param names + signature base than
// AdGem, to prove the adapter boundary. Postback: user_id, trans_id, amount,
// survey_id, status (in/out), hash=HMAC(user_id-trans_id-amount).
@Injectable()
export class CpxAdapter implements ProviderAdapter {
  readonly key = 'cpx';
  readonly name = 'CPX Research';

  constructor(private readonly config: ConfigService) {}

  private secret() {
    return this.config.get<string>('CPX_POSTBACK_SECRET', '');
  }

  enabled() {
    return !!this.config.get<string>('CPX_APP_ID');
  }

  async fetchOffers(ctx: OfferContext): Promise<Offer[]> {
    // ponytail: mock catalog. Replace with the real CPX survey/offer feed.
    const appId = this.config.get<string>('CPX_APP_ID', 'demo');
    const track = this.config.get<string>('CPX_TRACK_URL', 'https://offers.cpx-research.com/index.php');
    const raw = [
      { id: 'quick-survey', title: 'Quick Survey', description: 'Complete survey', points: 800, category: 'survey', difficulty: 'Easy', icon: 'Q', color: '#059669', countries: [] },
      { id: 'coin-master', title: 'Coin Master', description: 'Attack, spin and build your village', points: 1200, category: 'game', difficulty: 'Easy', icon: 'C', color: '#f59e0b', countries: [] },
      { id: 'yuno', title: 'Yuno Surveys', description: 'Share your opinion and get rewarded', points: 600, category: 'survey', difficulty: 'Medium', icon: 'Y', color: '#10b981', countries: ['US', 'IN', 'BR'] },
      { id: 'cashapp', title: 'Cash App', description: 'Sign up and link a card', points: 5000, category: 'signup', difficulty: 'Medium', icon: '$', color: '#00d54b', countries: ['US'] },
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
      clickUrl: `${track}?app_id=${appId}&user_id=${encodeURIComponent(ctx.userId)}&offer=${o.id}`,
    }));
  }

  verify(q: PostbackQuery): boolean {
    const base = `${q.user_id ?? ''}-${q.trans_id ?? ''}-${q.amount ?? ''}`;
    return safeEqualHex(q.hash ?? '', hmac(this.secret(), base));
  }

  parse(q: PostbackQuery): ParsedPostback | null {
    const userId = q.user_id;
    const transactionId = q.trans_id;
    const points = Number(q.amount);
    if (!userId || !transactionId || !Number.isFinite(points)) return null;
    return {
      transactionId,
      userId,
      points: Math.abs(Math.trunc(points)),
      type: q.status === 'out' ? 'reversal' : 'credit',
      offerId: q.survey_id,
      title: q.offer_name ?? 'Survey Completed',
    };
  }

  ack() {
    return 'OK';
  }
}
