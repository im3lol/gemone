import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
import House from '@lucide/svelte/icons/house';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import Receipt from '@lucide/svelte/icons/receipt';
import ShieldAlert from '@lucide/svelte/icons/shield-alert';
import type { LucideProps } from '@lucide/svelte';
import type { UserRole } from '@gemone/contracts';
import type { Component } from 'svelte';

/**
 * The application's navigation, in one place — docs/UI_KIT.md, DESIGN_SYSTEM.md §14.2.
 *
 * ## Why a data structure rather than markup
 *
 * The same list is rendered three ways: the desktop sidebar, the mobile bottom
 * bar, and (later) a breadcrumb. Legacy writes each surface's items by hand,
 * which is how its admin sidebar ended up with eighteen links that go nowhere
 * (UI_AUDIT.md, §9). A link that exists in one place and not another is a bug
 * this shape makes impossible.
 */
export interface NavItem {
  href: string;
  label: string;
  /** The mobile bar has ~78px per item; the sidebar has 256px. */
  shortLabel: string;
  icon: Component<LucideProps>;
}

export interface NavGroup {
  /** Sidebar groups are separated by a rule and carry no heading (DS §14.2). */
  id: string;
  items: NavItem[];
}

/**
 * Legacy's grouping rhythm — earning, then money, then account — applied to the
 * four routes that exist. The names are the routes' own, not legacy's: this app
 * has `Offers` where legacy had `Earn`, and inventing legacy's missing screens
 * in the navigation would produce exactly the dead links §9 warns about.
 */
const PRIMARY: NavGroup = {
  id: 'earn',
  items: [
    { href: '/dashboard', label: 'Dashboard', shortLabel: 'Home', icon: House },
    { href: '/offers', label: 'Offers', shortLabel: 'Offers', icon: LayoutGrid },
  ],
};

const MONEY: NavGroup = {
  id: 'money',
  items: [
    { href: '/earnings', label: 'Earnings', shortLabel: 'Earnings', icon: Receipt },
    { href: '/payouts', label: 'Payouts', shortLabel: 'Payouts', icon: ArrowDownToLine },
  ],
};

/**
 * The admin entry point.
 *
 * UI_AUDIT.md AD2 records that the admin screens have no navigation into them
 * at all — they are reachable only by typing the URL. This is that link. It is
 * not authorization: `/admin/*` is guarded by the API's `@Roles(ADMIN)` and by
 * `admin/+layout.server.ts`; hiding it from non-admins only avoids showing
 * someone a door that will refuse them.
 */
const ADMIN: NavGroup = {
  id: 'admin',
  items: [
    { href: '/admin/payouts', label: 'Payout review', shortLabel: 'Admin', icon: ShieldAlert },
  ],
};

export function navGroups(role: UserRole): NavGroup[] {
  return role === 'ADMIN' ? [PRIMARY, MONEY, ADMIN] : [PRIMARY, MONEY];
}

export function navItems(role: UserRole): NavItem[] {
  return navGroups(role).flatMap((group) => group.items);
}

/**
 * Whether `href` is the section the current path belongs to.
 *
 * The `+ '/'` matters. A plain `startsWith` would light up **Payouts** while
 * the user is on `/admin/payouts`, and would light up every item whose href is
 * a prefix of another. Matching the separator means `/offers/abc` marks
 * `/offers` and nothing else does.
 */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
