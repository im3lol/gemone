import { describe, expect, it } from 'vitest';
import { OFFER_CATEGORIES } from '@gemone/contracts';

import { categorize } from './offer-category';

/**
 * The mapping that makes every provider's vocabulary land on one set.
 *
 * Owned by `offers` and tested here rather than inside any adapter — an
 * adapter deciding what its own categories meant would put a business rule in
 * a provider folder, and two providers would then disagree about "app".
 */
describe('categorize', () => {
  it.each([
    [['survey'], OFFER_CATEGORIES.SURVEY],
    [['Surveys'], OFFER_CATEGORIES.SURVEY],
    [['mobile_game'], OFFER_CATEGORIES.GAME],
    [['Mobile Games', 'ios'], OFFER_CATEGORIES.GAME],
    [['casino'], OFFER_CATEGORIES.GAME],
    [['signup', 'lead'], OFFER_CATEGORIES.SIGNUP],
    [['registration'], OFFER_CATEGORIES.SIGNUP],
    [['free_trial'], OFFER_CATEGORIES.TRIAL],
    [['shopping', 'retail'], OFFER_CATEGORIES.SHOPPING],
    [['watch_video'], OFFER_CATEGORIES.VIDEO],
    [['app_install'], OFFER_CATEGORIES.APP_INSTALL],
  ])('maps %j to %s', (input, expected) => {
    expect(categorize(input)).toBe(expected);
  });

  it('normalizes case, spaces and hyphens before matching', () => {
    // Providers ship `mobile_game`, `Mobile Games` and `game-android` and mean
    // one thing. An exact-match table would need a row per spelling and would
    // fall through to OTHER on the first variant nobody anticipated.
    expect(categorize(['  Mobile-Game  '])).toBe(OFFER_CATEGORIES.GAME);
    expect(categorize(['SIGN UP'])).toBe(OFFER_CATEGORIES.SIGNUP);
  });

  it('prefers the more specific rule when several could match', () => {
    // "game install" is an install, not a game. The table's ordering is the
    // disambiguation rule rather than an accident, so this pins it.
    expect(categorize(['game_install'])).toBe(OFFER_CATEGORIES.APP_INSTALL);
    expect(categorize(['app_download'])).toBe(OFFER_CATEGORIES.APP_INSTALL);
  });

  it('falls back to OTHER instead of dropping the offer', () => {
    /*
     * The important half of this rule. An unrecognised category is a filtering
     * inconvenience; treating it as a rejection would be lost revenue and a
     * user unable to find something they were shown yesterday — for a field
     * nobody's payout depends on.
     */
    expect(categorize(['artisanal_beekeeping'])).toBe(OFFER_CATEGORIES.OTHER);
    expect(categorize([])).toBe(OFFER_CATEGORIES.OTHER);
    expect(categorize(['', '   '])).toBe(OFFER_CATEGORIES.OTHER);
  });

  it('never names a provider', () => {
    // §5 rule 7 in miniature: the vocabulary here is generic category
    // language that several networks share, which is why a new provider
    // usually needs no change to this file at all.
    expect(categorize(['mock'])).toBe(OFFER_CATEGORIES.OTHER);
  });
});
