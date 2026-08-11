/**
 * The landing page's copy — DESIGN_SYSTEM.md §18.
 *
 * Legacy keeps this in `lib/data.ts` and it is kept out of the components here
 * for the same reason: the sections are layout, the words are content, and the
 * words are the part that gets argued about.
 *
 * ## The rule this file follows
 *
 * **Nothing here asserts a fact about GemOne that is not true of the system as
 * built.** Legacy's landing page states "30,000+ happy users", "$2M+ Paid to
 * Users", "1M+ Offers Completed", three signed testimonials with payout
 * amounts, and a strip of six named offer networks under the heading "Trusted
 * by top offer partners". None of it is verifiable, and this platform has one
 * offer adapter — `mock` — and a manual payout provider. Publishing those
 * numbers would be publishing a claim, not reproducing a design.
 *
 * So the *shapes* of §18.6, §18.10 and §18.11 are reproduced exactly and their
 * contents are replaced with statements that hold: what the platform does, how
 * many ways there are to earn, what verification means here. See D82.
 */
import type { Component } from 'svelte';
import type { LucideProps } from '@lucide/svelte';

import FileClock from '@lucide/svelte/icons/file-clock';
import Layers from '@lucide/svelte/icons/layers';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import Wallet from '@lucide/svelte/icons/wallet';
import Zap from '@lucide/svelte/icons/zap';

/**
 * Header links — DS §18.3.
 *
 * Legacy's five are `How it works · Earn · Rewards · Blog · Support`, every one
 * of them `href="#"`, and "Earn" carries a chevron with no menu behind it.
 * These three point at sections that exist on this page. A link that goes
 * nowhere is a defect whether or not the design shows one; Blog and Support are
 * dropped until there is something to link to (TODO T76).
 */
export const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#ways-to-earn', label: 'Ways to earn' },
  { href: '#features', label: 'Why GemOne' },
] as const;

/**
 * The faint strip under the hero — DS §18.6.
 *
 * Legacy lists six offer networks by name under "Trusted by top offer
 * partners". We are integrated with none of them: `providers/adapters` contains
 * `mock`. Naming them would claim partnerships that do not exist, so the strip
 * says what the platform *is* instead — the pipeline every provider goes
 * through, which is P1 stated in the shop window.
 */
export const PIPELINE_STAGES = [
  'Offer sync',
  'Click tracking',
  'Postback verification',
  'Reward crediting',
  'Fraud checks',
  'Payouts',
] as const;

/** The five feature cards — DS §18.7. */
export const FEATURES: ReadonlyArray<{
  icon: Component<LucideProps>;
  title: string;
  text: string;
}> = [
  {
    icon: Layers,
    title: 'Many ways to earn',
    text: 'Offers, surveys, games and videos from every connected network, on one wall.',
  },
  {
    icon: Wallet,
    title: 'One balance',
    text: 'Every network credits the same points balance, at a rate you can see.',
  },
  {
    icon: ShieldCheck,
    title: 'Verified rewards',
    text: 'Points are credited from a verified provider postback, never from a click.',
  },
  {
    icon: Zap,
    title: 'Live tracking',
    text: 'Clicks and conversions appear as soon as the network confirms them.',
  },
  {
    icon: FileClock,
    title: 'Full history',
    text: 'Every credit, reversal and withdrawal stays on your ledger.',
  },
];

/** The three numbered circles — DS §18.8. */
export const STEPS = [
  {
    emoji: '🧑‍💻',
    title: 'Create an account',
    text: 'Sign up for free and confirm your email.',
  },
  {
    emoji: '🚀',
    title: 'Complete offers',
    text: 'Pick an offer and follow the steps it asks for.',
  },
  {
    emoji: '👛',
    title: 'Get rewarded',
    text: 'Points land on your balance. Withdraw when you are ready.',
  },
] as const;

/**
 * The six tinted tiles — DS §18.9, reproduced with their exact pairs.
 *
 * The one substitution: legacy's `emerald-50 / emerald-100 / emerald-700`
 * become the brand tokens. The brand scale *is* Tailwind v3's emerald (D79),
 * while v4's own `emerald-500` is `#00bb7f` — using the utility here would put
 * a second, slightly different green next to the brand one in the same row.
 */
export const EARNING_TILES = [
  {
    emoji: '🎮',
    title: 'Play games',
    text: 'Play your favourite games and reach paid milestones.',
    tile: 'bg-purple-50',
    button: 'bg-purple-100 text-purple-700',
  },
  {
    emoji: '📋',
    title: 'Surveys',
    text: 'Share your opinion and get rewarded for it.',
    tile: 'bg-blue-50',
    button: 'bg-blue-100 text-blue-700',
  },
  {
    emoji: '📱',
    title: 'App offers',
    text: 'Install and try new apps to earn points.',
    tile: 'bg-brand-50',
    button: 'bg-brand-100 text-brand-700',
  },
  {
    emoji: '▶️',
    title: 'Watch videos',
    text: 'Watch short videos and earn as you go.',
    tile: 'bg-amber-50',
    button: 'bg-amber-100 text-amber-700',
  },
  {
    emoji: '🛍️',
    title: 'Shopping',
    text: 'Shop through partner offers and earn on purchases.',
    tile: 'bg-pink-50',
    button: 'bg-pink-100 text-pink-700',
  },
  {
    emoji: '🎁',
    title: 'Bonus offers',
    text: 'Take on the higher-value offers when they appear.',
    tile: 'bg-indigo-50',
    button: 'bg-indigo-100 text-indigo-700',
  },
] as const;

/**
 * The three cards in the tinted band — DS §18.10.
 *
 * Legacy's are testimonials: three names, three avatars, five stars each, a
 * quote, and a payout figure in an inline colour. They are fabricated, and a
 * fabricated review published as a real one is the one thing on a marketing
 * page that is not a matter of taste.
 *
 * The card *shape* is kept exactly — round plate, bold heading, body, a
 * `border-t` footer row with a coloured lead and a muted trailing label — and
 * the content becomes what the accounting model actually guarantees.
 * ARCHITECTURE.md §9–§11 is the source for all three.
 */
export const GUARANTEES: ReadonlyArray<{
  icon: Component<LucideProps>;
  title: string;
  text: string;
  lead: string;
  trail: string;
}> = [
  {
    icon: ShieldCheck,
    title: 'Verified before credited',
    text: 'A reward is created from a provider postback that we authenticate and de-duplicate first. A click alone never pays.',
    lead: 'Signed postbacks',
    trail: 'Verified server-side',
  },
  {
    icon: Wallet,
    title: 'One balance, one rate',
    text: 'Points from every network land on a single balance, and the conversion rate is shown before you confirm a withdrawal.',
    lead: 'Single ledger',
    trail: 'Rate shown upfront',
  },
  {
    icon: FileClock,
    title: 'Nothing disappears quietly',
    text: 'Credits, reversals and withdrawals are all entries you can read back, each pointing at the offer that caused it.',
    lead: 'Full audit trail',
    trail: 'Yours to review',
  },
];

/**
 * The dark slab — DS §18.11.
 *
 * Legacy's four figures are user counts and payout totals. These four are
 * properties of the product as built: free to join, six categories on the
 * wall, three steps to a first reward, and a wall that is not on office hours.
 * Same slab, same four cells, nothing asserted that is not so.
 */
export const FACTS = [
  { value: '$0', label: 'To create an account' },
  { value: '6', label: 'Ways to earn' },
  { value: '3', label: 'Steps to your first reward' },
  { value: '24/7', label: 'Access to the offer wall' },
] as const;

/** Footer columns — DS §18.13, trimmed to destinations that resolve. */
export const FOOTER_COLUMNS = [
  {
    heading: 'Product',
    links: [
      { href: '#how-it-works', label: 'How it works' },
      { href: '#ways-to-earn', label: 'Ways to earn' },
      { href: '#features', label: 'Why GemOne' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { href: '/register', label: 'Create an account' },
      { href: '/login', label: 'Log in' },
      { href: '/forgot-password', label: 'Reset your password' },
    ],
  },
] as const;

/** The illustrative rows on the phone screen — DS §18.5. */
export const MOCKUP_ACTIVITY = [
  { emoji: '🎮', label: 'Game mission', points: '+1,200' },
  { emoji: '📋', label: 'Survey completed', points: '+800' },
  { emoji: '📱', label: 'App install', points: '+1,000' },
  { emoji: '▶️', label: 'Video watched', points: '+200' },
] as const;
