/**
 * The GemOne UI kit — docs/UI_KIT.md.
 *
 * One import path for every shared component, so a page writes
 * `import { Button, Card } from '$lib/components/ui'` rather than one line per
 * file. Icons are *not* re-exported here: they come straight from
 * `@lucide/svelte` so that the bundler keeps tree-shaking them individually
 * (docs/UI_KIT.md §Icons).
 */
export { default as Alert } from './Alert.svelte';
export { default as Badge } from './Badge.svelte';
export { default as Button } from './Button.svelte';
export { default as Card } from './Card.svelte';
export { default as Container } from './Container.svelte';
export { default as EmptyState } from './EmptyState.svelte';
export { default as ErrorState } from './ErrorState.svelte';
export { default as Field } from './Field.svelte';
export { default as Input } from './Input.svelte';
export { default as Modal } from './Modal.svelte';
export { default as PageHeader } from './PageHeader.svelte';
export { default as Pager } from './Pager.svelte';
export { default as Select } from './Select.svelte';
export { default as Skeleton } from './Skeleton.svelte';
export { default as Spinner } from './Spinner.svelte';
export { default as StatCard } from './StatCard.svelte';

export type { SelectOption } from './types';
