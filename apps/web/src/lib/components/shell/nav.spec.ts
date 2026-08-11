import { describe, expect, it } from 'vitest';

import { isActive, navGroups, navItems } from './nav';

/**
 * The navigation model, tested where the components are not.
 *
 * `vite.config.ts` explains why component rendering is not tested here: a test
 * that asserts a heading exists fails when the copy changes and passes when the
 * flow breaks. This module is the opposite — it is pure logic with a failure
 * mode that is invisible on the screen you happen to be looking at, because
 * highlighting the wrong item only shows up on the *other* page.
 */
describe('isActive', () => {
  it('matches the section exactly', () => {
    expect(isActive('/offers', '/offers')).toBe(true);
  });

  it('matches a child of the section', () => {
    expect(isActive('/offers/abc-123', '/offers')).toBe(true);
  });

  /*
   * The reason `isActive` appends a separator instead of using a plain
   * `startsWith`. Without it `/payouts` lights up while the user is reviewing
   * payouts in the admin area, and two items claim to be the current page.
   */
  it('does not match a different route that merely shares a prefix', () => {
    expect(isActive('/admin/payouts', '/payouts')).toBe(false);
    expect(isActive('/payouts-archive', '/payouts')).toBe(false);
  });

  it('marks the admin item on an admin sub-route', () => {
    expect(isActive('/admin/payouts/abc', '/admin/payouts')).toBe(true);
  });

  it('never marks an unrelated route', () => {
    expect(isActive('/dashboard', '/offers')).toBe(false);
  });
});

describe('navGroups', () => {
  it('gives a regular user the two application groups', () => {
    const groups = navGroups('USER');

    expect(groups.map((group) => group.id)).toEqual(['earn', 'money']);
  });

  /*
   * UI_AUDIT.md AD2: the admin screens had no navigation into them at all.
   * This is the assertion that they do now — and that nobody else sees it.
   */
  it('gives an admin the admin group as well', () => {
    expect(navGroups('ADMIN').map((group) => group.id)).toEqual(['earn', 'money', 'admin']);
    expect(navGroups('USER').flatMap((group) => group.items.map((item) => item.href))).not.toContain(
      '/admin/payouts',
    );
  });

  it('exposes exactly one item per href, so the two navigations cannot diverge', () => {
    const hrefs = navItems('ADMIN').map((item) => item.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  /*
   * Every destination must be a route that exists. A link to a page that was
   * never built is the defect UI_AUDIT.md §9 records against legacy's admin
   * sidebar, where eighteen of twenty-three items were `href="#"`.
   */
  it('points only at routes this application actually has', () => {
    const routes = new Set(['/dashboard', '/offers', '/earnings', '/payouts', '/admin/payouts']);

    for (const item of navItems('ADMIN')) {
      expect(routes.has(item.href)).toBe(true);
    }
  });
});
