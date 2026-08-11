/**
 * The payout queue — PROJECT.md §3.3, ARCHITECTURE.md §11.3.
 *
 * The one admin surface in this product that moves money, and the piece that
 * closes the loop: a withdrawal request has had somewhere to go since the
 * payout state machine was built, and until now no screen to be decided on.
 *
 * None of these fetches, and none decides what a transition means — that lives
 * in `$lib/admin/payout-queue.ts`, which mirrors the server's state machine,
 * and behind it in `payout-state-machine.ts`, which is the authority.
 */
export { default as PayoutQueue } from './PayoutQueue.svelte';
export { default as ProviderCard } from './ProviderCard.svelte';
export { default as ProviderList } from './ProviderList.svelte';
export { default as QueueTable } from './QueueTable.svelte';
export { default as ReviewActions } from './ReviewActions.svelte';
export { default as RegisterProvider } from './RegisterProvider.svelte';
export { default as ReviewContext } from './ReviewContext.svelte';

export type {
  ProviderActionResult,
  ProviderResult,
  QueueResult,
  ReviewResult,
} from './types';
