import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { OffersService } from './offers.service';
import type { Offer } from '../../generated/prisma/client';

/**
 * The wall must never show a user what a provider pays us.
 *
 * ARCHITECTURE.md §4.4, mechanism 3 — the same shape as
 * `provider-independence.spec.ts` and `fraud/arch.spec.ts`: a rule that is only
 * written down is a rule that erodes.
 *
 * This one is worth a test rather than a comment because the failure is silent
 * and permanent. `payoutAmountMinor` sits next to `rewardPoints` on the same
 * row, one character apart in an editor's autocomplete, and a wall that leaked
 * it would look completely normal — a number on a card — while publishing the
 * margin on every offer to anyone with an account.
 *
 * Two assertions, because either alone can be satisfied while the rule is
 * broken: the source must not mention the fields, and the output must not
 * contain them.
 */

const SOURCE = readFileSync(join(__dirname, 'offers.service.ts'), 'utf8');

/**
 * Isolates `toWallOffer`'s body.
 *
 * Scanning the whole file would fail on `toSummary`, which is admin-facing and
 * *must* carry the payout — so a file-wide assertion would be unsatisfiable and
 * would end up deleted rather than fixed.
 */
function wallSerialiserSource(): string {
  const start = SOURCE.indexOf('static toWallOffer(');
  expect(start, 'toWallOffer must exist in offers.service.ts').toBeGreaterThan(-1);

  const end = SOURCE.indexOf('\n  }', start);
  expect(end, 'toWallOffer must be a closed method').toBeGreaterThan(start);

  return SOURCE.slice(start, end);
}

/** Fields that must never reach a user. */
const FORBIDDEN = ['payoutAmountMinor', 'payoutCurrency', 'trackingUrlTemplate'] as const;

describe('the wall serialiser', () => {
  it.each(FORBIDDEN)('never references %s', (field) => {
    expect(wallSerialiserSource()).not.toContain(field);
  });

  it('emits none of them, whatever the row contains', () => {
    /*
     * The output assertion. The source scan above catches the obvious
     * regression; this catches a spread — `...offer` would mention none of the
     * forbidden names and leak all three.
     */
    const row = {
      id: '0192f0a0-0000-7000-8000-0000000000a1',
      providerId: '0192f0a0-0000-7000-8000-0000000000b1',
      externalId: 'MK-1',
      title: 'Reach level 10',
      description: 'A game',
      requirements: null,
      payoutAmountMinor: 4500,
      payoutCurrency: 'USD',
      rewardPoints: 900,
      category: 'GAME',
      providerCategories: ['mobile_game'],
      countries: ['US'],
      devices: ['android'],
      imageUrl: null,
      trackingUrlTemplate: 'https://example.test/click?s={SUB_ID}',
      isMultiStep: false,
      isActive: true,
      deactivatedAt: null,
      deactivationSource: null,
      lastSeenAt: new Date(0),
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as unknown as Offer;

    const wall = OffersService.toWallOffer(row, 'mock');
    const keys = Object.keys(wall);

    for (const field of FORBIDDEN) {
      expect(keys).not.toContain(field);
    }

    // And the values are absent too, not merely renamed — a `payout` key
    // holding 4500 would pass a key check and fail the user just as badly.
    expect(JSON.stringify(wall)).not.toContain('4500');
    expect(JSON.stringify(wall)).not.toContain('example.test');
  });

  it('carries what the wall needs, so the rule cannot be satisfied by returning nothing', () => {
    /*
     * The anti-regression. Every assertion above is satisfied by a serialiser
     * that returns `{}` — this is what stops the rule from being "kept" by
     * emptying the response.
     */
    const row = {
      id: '0192f0a0-0000-7000-8000-0000000000a1',
      title: 'Reach level 10',
      description: 'A game',
      requirements: 'Install and reach level 10',
      rewardPoints: 900,
      category: 'GAME',
      countries: ['US'],
      devices: ['android'],
      imageUrl: 'https://cdn.example.test/a.png',
      isMultiStep: true,
      payoutAmountMinor: 4500,
      payoutCurrency: 'USD',
      trackingUrlTemplate: 'x',
    } as unknown as Offer;

    expect(OffersService.toWallOffer(row, 'mock')).toEqual({
      id: '0192f0a0-0000-7000-8000-0000000000a1',
      providerSlug: 'mock',
      title: 'Reach level 10',
      description: 'A game',
      requirements: 'Install and reach level 10',
      rewardPoints: 900,
      category: 'GAME',
      countries: ['US'],
      devices: ['android'],
      imageUrl: 'https://cdn.example.test/a.png',
      isMultiStep: true,
    });
  });
});
