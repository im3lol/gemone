import { OFFER_CATEGORIES, type OfferCategory } from '@gemone/contracts';

/**
 * Provider category strings → our fixed set (ARCHITECTURE.md §7.5).
 *
 * **Owned by `offers`, not by adapters, and that placement is the point.**
 * An adapter that decided what its own categories meant would put a business
 * rule inside a provider folder, where changing it needs a deploy and where
 * two providers would inevitably disagree about what "app" means. Adapters
 * surface the provider's strings; deciding what they mean happens once, here.
 *
 * Note what this file does NOT contain: any provider's name. The vocabulary
 * below is generic category language that several networks happen to share,
 * which is why matching by keyword works at all — and why a new provider
 * usually needs no change here (§5, rule 7).
 */

/**
 * Keyword → category, most specific first.
 *
 * Substring matching rather than exact keys, because providers ship
 * `mobile_game`, `Mobile Games`, `game-android` and mean one thing. An exact
 * table would need a row per spelling and would silently fall through to
 * OTHER on the first variant nobody anticipated.
 */
const KEYWORD_RULES: readonly (readonly [string, OfferCategory])[] = [
  // Ordered deliberately: `app_install` before `app`, `signup` before `sign`,
  // and install/download before the broader `game`, so "game install" lands on
  // APP_INSTALL rather than GAME.
  ['app_install', OFFER_CATEGORIES.APP_INSTALL],
  ['appinstall', OFFER_CATEGORIES.APP_INSTALL],
  ['install', OFFER_CATEGORIES.APP_INSTALL],
  ['download', OFFER_CATEGORIES.APP_INSTALL],

  ['survey', OFFER_CATEGORIES.SURVEY],
  ['questionnaire', OFFER_CATEGORIES.SURVEY],
  ['poll', OFFER_CATEGORIES.SURVEY],

  ['free_trial', OFFER_CATEGORIES.TRIAL],
  ['trial', OFFER_CATEGORIES.TRIAL],
  ['subscription', OFFER_CATEGORIES.TRIAL],

  ['signup', OFFER_CATEGORIES.SIGNUP],
  ['sign_up', OFFER_CATEGORIES.SIGNUP],
  ['registration', OFFER_CATEGORIES.SIGNUP],
  ['register', OFFER_CATEGORIES.SIGNUP],
  ['lead', OFFER_CATEGORIES.SIGNUP],

  ['shopping', OFFER_CATEGORIES.SHOPPING],
  ['purchase', OFFER_CATEGORIES.SHOPPING],
  ['ecommerce', OFFER_CATEGORIES.SHOPPING],
  ['retail', OFFER_CATEGORIES.SHOPPING],

  ['video', OFFER_CATEGORIES.VIDEO],
  ['watch', OFFER_CATEGORIES.VIDEO],
  ['stream', OFFER_CATEGORIES.VIDEO],

  ['game', OFFER_CATEGORIES.GAME],
  ['gaming', OFFER_CATEGORIES.GAME],
  ['casino', OFFER_CATEGORIES.GAME],
  ['puzzle', OFFER_CATEGORIES.GAME],
  ['rpg', OFFER_CATEGORIES.GAME],
];

/**
 * Maps a provider's categories onto ours.
 *
 * Returns `OTHER` rather than throwing or dropping when nothing matches. An
 * unrecognised category is a filtering inconvenience; a dropped offer is lost
 * revenue and a user who cannot find something they were shown yesterday. The
 * provider's original strings are stored on the row either way, so a mapping
 * gap is auditable — and fixable — after the fact.
 *
 * The **first** rule that matches any category wins, so ordering in the table
 * above is the disambiguation rule rather than an accident.
 */
export function categorize(providerCategories: readonly string[]): OfferCategory {
  const normalized = providerCategories
    .map((category) => category.trim().toLowerCase().replaceAll(/[\s-]+/g, '_'))
    .filter((category) => category.length > 0);

  if (normalized.length === 0) return OFFER_CATEGORIES.OTHER;

  for (const [keyword, category] of KEYWORD_RULES) {
    if (normalized.some((value) => value.includes(keyword))) return category;
  }

  return OFFER_CATEGORIES.OTHER;
}

export const __testing = { KEYWORD_RULES };
