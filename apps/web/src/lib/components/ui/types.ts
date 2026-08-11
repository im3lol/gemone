/**
 * Shared prop types for the UI kit — docs/UI_KIT.md.
 *
 * These live in a `.ts` file rather than beside their component because a type
 * declared in a Svelte instance script is not reliably re-exportable, and a
 * caller building an options array needs the shape without importing the
 * component that consumes it.
 */

/** One choice in a `Select`. */
export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};
