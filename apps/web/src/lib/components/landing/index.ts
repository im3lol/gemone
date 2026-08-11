/**
 * The public marketing page — DESIGN_SYSTEM.md §18.
 *
 * Nine bands in a flat list, each one a component here, each one full-bleed
 * with its content centred by `Container` at 72rem. The page file composes
 * them and owns nothing else.
 *
 * The copy lives in `content.ts`, apart from the markup, and the note at the
 * top of that file is the rule this whole folder is written to: nothing on the
 * public page asserts a fact about GemOne that is not true of the system as
 * built (D82).
 */
export { default as CtaBanner } from './CtaBanner.svelte';
export { default as FactsBar } from './FactsBar.svelte';
export { default as Features } from './Features.svelte';
export { default as Guarantees } from './Guarantees.svelte';
export { default as Hero } from './Hero.svelte';
export { default as HowItWorks } from './HowItWorks.svelte';
export { default as LandingFooter } from './LandingFooter.svelte';
export { default as LandingNav } from './LandingNav.svelte';
export { default as PipelineStrip } from './PipelineStrip.svelte';
export { default as WaysToEarn } from './WaysToEarn.svelte';
