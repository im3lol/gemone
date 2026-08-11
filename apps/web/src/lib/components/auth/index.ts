/**
 * The public authentication surface — DESIGN_SYSTEM.md §19, docs/UI_KIT.md.
 *
 * One component, because there is one shape: every auth route is a centred
 * card with a gem, a title and a short form. The routes differ in their copy
 * and their fields, not in their frame.
 */
export { default as AuthCard } from './AuthCard.svelte';
