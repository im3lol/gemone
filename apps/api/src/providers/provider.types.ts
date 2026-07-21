// Normalized offer shape returned by every provider adapter and by GET /offers.
export type Offer = {
  id: string; // globally unique: `${provider}:${providerOfferId}`
  provider: string;
  title: string;
  description: string;
  points: number; // reward in our points
  payoutUsd: string;
  category: 'game' | 'survey' | 'app' | 'signup' | 'shopping' | 'video';
  difficulty: 'Easy' | 'Medium' | 'Hard';
  icon: string; // single letter / emoji placeholder
  color: string; // hex for the tile
  clickUrl: string; // deep link carrying our userId as sub_id
  countries: string[]; // empty = worldwide
};

export type OfferContext = {
  userId: string;
  country: string | null;
};

// Result of parsing + verifying an inbound postback query for a provider.
export type ParsedPostback = {
  transactionId: string;
  userId: string; // our user id, echoed back via sub_id
  points: number;
  type: 'credit' | 'reversal';
  offerId?: string;
  title?: string;
};

export type PostbackQuery = Record<string, string | undefined>;

export interface ProviderAdapter {
  readonly key: string;
  readonly name: string;
  enabled(): boolean;
  fetchOffers(ctx: OfferContext): Promise<Offer[]>;
  // True when the request signature/hash matches the shared secret.
  verify(query: PostbackQuery): boolean;
  // Maps provider-specific params to our shape; null if required params missing.
  parse(query: PostbackQuery): ParsedPostback | null;
  // Body each network expects as acknowledgement of a handled postback.
  ack(): string;
}
