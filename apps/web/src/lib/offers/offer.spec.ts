import type { OfferCategory, WallOfferSort } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import {
  OFFER_CATEGORIES_IN_ORDER,
  OFFER_SORTS_IN_ORDER,
  categoryGlyph,
  categoryLabel,
  categoryTone,
  formatReward,
  providerName,
  sortLabel,
  tileColor,
  tileImage,
  tileInitial,
} from './offer';

describe('categories', () => {
  it('covers every category the contract has', () => {
    // The array is derived from the label map, and the map is a
    // `Record<OfferCategory, …>` — so this asserts the count the compiler
    // already guarantees the membership of.
    expect(OFFER_CATEGORIES_IN_ORDER).toHaveLength(8);
    expect(OFFER_CATEGORIES_IN_ORDER).toContain('APP_INSTALL');
  });

  it('gives each one a label, a glyph and a tone', () => {
    for (const category of OFFER_CATEGORIES_IN_ORDER) {
      expect(categoryLabel(category), category).toBeTruthy();
      expect(categoryGlyph(category), category).toBeTruthy();
      expect(categoryTone(category), category).toBeTruthy();
    }
  });

  it('never prints an enum name at a user', () => {
    // `GAME · mock` is what the pre-redesign wall rendered under every title.
    for (const category of OFFER_CATEGORIES_IN_ORDER) {
      expect(categoryLabel(category), category).not.toBe(category);
    }
    expect(categoryLabel('APP_INSTALL')).toBe('App installs');
  });

  it('uses no red, because nothing here is an error', () => {
    for (const category of OFFER_CATEGORIES_IN_ORDER) {
      expect(categoryTone(category), category).not.toBe('error');
    }
  });

  it('falls back rather than rendering undefined for an unknown value', () => {
    const unknown = 'CRYPTO_QUEST' as OfferCategory;

    expect(categoryLabel(unknown)).toBe('Other');
    expect(categoryGlyph(unknown)).toBe('✨');
    expect(categoryTone(unknown)).toBe('neutral');
  });
});

describe('sorts', () => {
  it('offers the three orderings the contract has, highest reward first', () => {
    expect(OFFER_SORTS_IN_ORDER).toEqual(['reward_desc', 'reward_asc', 'newest']);
    expect(sortLabel('reward_desc')).toBe('Highest reward');
  });

  it('falls back for an unknown ordering', () => {
    expect(sortLabel('by_vibes' as WallOfferSort)).toBe('Highest reward');
  });
});

describe('tileColor', () => {
  it('is stable for the same offer', () => {
    // A wall that reshuffled its colours on every reload would look broken.
    const id = '019ff279-458f-7519-8433-f4dedd9ac4fa';

    expect(tileColor(id)).toBe(tileColor(id));
  });

  it('spreads different offers across the palette', () => {
    const colors = new Set(
      Array.from({ length: 40 }, (_, index) => tileColor(`019ff279-458f-7519-8433-f4dedd9ac4${index}`)),
    );

    // Collisions are free — the colour communicates nothing — but a hash that
    // returned one value would lose the texture §3.5 exists to keep.
    expect(colors.size).toBeGreaterThan(3);
  });

  it('always returns a colour, including for an empty id', () => {
    expect(tileColor('')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('tileInitial', () => {
  it('takes the first letter of the title', () => {
    expect(tileInitial('Skyline Racer — reach level 12', 'GAME')).toBe('S');
    expect(tileInitial('finance survey', 'SURVEY')).toBe('F');
  });

  it('skips punctuation to find one', () => {
    expect(tileInitial('  "Quick" survey', 'SURVEY')).toBe('Q');
    expect(tileInitial('7-day trial', 'TRIAL')).toBe('7');
  });

  it('falls back to the category glyph rather than a blank tile', () => {
    expect(tileInitial('', 'VIDEO')).toBe('▶️');
    expect(tileInitial('—— ——', 'SURVEY')).toBe('📋');
  });
});

describe('tileImage', () => {
  it('accepts an https image from a provider', () => {
    expect(tileImage('https://cdn.mock-offers.test/creatives/mk-100241.png')).toBe(
      'url("https://cdn.mock-offers.test/creatives/mk-100241.png")',
    );
  });

  it('is nothing when the provider supplied nothing', () => {
    expect(tileImage(null)).toBeUndefined();
    expect(tileImage('')).toBeUndefined();
  });

  it('refuses every scheme but https', () => {
    // This is the one field on the wall that arrives from outside our system
    // and is rendered as a URL rather than as text.
    expect(tileImage('javascript:alert(1)')).toBeUndefined();
    expect(tileImage('data:image/svg+xml,<svg onload="alert(1)"/>')).toBeUndefined();
    expect(tileImage('http://cdn.example.test/a.png')).toBeUndefined();
    expect(tileImage('not a url at all')).toBeUndefined();
  });

  it('cannot close its own url() and start a new declaration', () => {
    const escaped = tileImage('https://cdn.example.test/a.png?q=");background:red;x=("');

    // The payload survives as *data* in the query string, which is harmless.
    // What must not survive is a quote able to terminate `url("` — so the only
    // two quotes in the result are the wrapping pair this function added.
    expect(escaped).not.toBeUndefined();
    expect(escaped?.match(/"/g)).toHaveLength(2);
    expect(escaped?.startsWith('url("')).toBe(true);
    expect(escaped?.endsWith('")')).toBe(true);
    expect(escaped).toContain('%22');
  });
});

describe('providerName', () => {
  it('title-cases the slug, which is all the wall carries', () => {
    expect(providerName('mock')).toBe('Mock');
    expect(providerName('offer_toro')).toBe('Offer Toro');
    expect(providerName('ad-gem')).toBe('Ad Gem');
  });

  it('never returns an empty caption', () => {
    expect(providerName('unknown')).toBe('Unknown');
  });
});

describe('formatReward', () => {
  it('groups the number', () => {
    expect(formatReward(2450)).toBe('2,450');
    expect(formatReward(0)).toBe('0');
  });
});
