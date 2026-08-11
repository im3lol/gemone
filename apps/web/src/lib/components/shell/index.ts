/**
 * The application shell — docs/UI_KIT.md, DESIGN_SYSTEM.md §14–15.
 *
 * Only `AppShell` and `Logo` are meant to be imported from outside this folder.
 * Sidebar, Topbar and MobileNav are its parts: they take the navigation model
 * as data and have no meaning apart from it.
 */
export { default as AppShell } from './AppShell.svelte';
export { default as Logo } from './Logo.svelte';

export { isActive, navGroups, navItems } from './nav';
export type { NavGroup, NavItem } from './nav';
