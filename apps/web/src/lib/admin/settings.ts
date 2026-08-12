import { CONFIG_SOURCES } from '@gemone/contracts';
import type {
  AdminConfigurationKeySummary,
  ConfigScopeName,
  ConfigSource,
} from '@gemone/contracts';

/**
 * The settings screen's vocabulary — P3, ARCHITECTURE.md §4.9.
 *
 * Pure, and holding **no key list whatsoever**. That is the whole design of
 * this screen: `GET /admin/configuration` returns every registered key with its
 * description, its declared type, the scopes it may be set at, its default and
 * the value in force. A hard-coded form with thirty labelled fields would be a
 * second declaration of keys that are declared in code by the modules owning
 * their rules, and it would silently omit the thirty-first.
 *
 * So this module knows how to *render a key*, never which keys exist.
 *
 * ## What it deliberately cannot do
 *
 * It does not validate a value. Each key registers a Zod schema with its
 * definition — `z.number().int().min(0).max(180)` for the hold period — and
 * that schema is the authority. Restating any of those ranges here would be
 * P3's rule written twice, in the copy that no test runs against real writes.
 *
 * The one exception is JSON syntax, below, and it is an exception because it is
 * the one thing a browser can be certain about without knowing the rule.
 */

/** A `Badge` variant. Restated rather than imported, so this module depends on nothing. */
export type SettingTone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'brand';

export interface SourceState {
  label: string;
  tone: SettingTone;
  hint: string;
}

/**
 * Where the value in force came from — the distinction §4.9 exists to surface.
 *
 * *"An admin who cannot tell an explicit setting from an unset one cannot
 * change either safely."* `default` is the only case where changing code
 * changes behaviour, and it is the one an operator most needs to recognise:
 * the first write against a defaulted key is a decision to stop tracking
 * whatever the code says.
 */
const SOURCES: Record<ConfigSource, SourceState> = {
  [CONFIG_SOURCES.DEFAULT]: {
    label: 'Default',
    tone: 'neutral',
    hint: 'Nothing is stored. The value comes from code, and a release can change it.',
  },
  [CONFIG_SOURCES.GLOBAL]: {
    label: 'Set globally',
    tone: 'brand',
    hint: 'A stored value is in force platform-wide, and it wins over the code default.',
  },
  [CONFIG_SOURCES.PROVIDER]: {
    label: 'Set for this provider',
    tone: 'info',
    hint: 'A provider-scoped value is in force and wins over the global one.',
  },
};

export function sourceState(source: ConfigSource): SourceState {
  return SOURCES[source] ?? { label: source, tone: 'neutral', hint: '' };
}

/**
 * The part of a dotted key before the first dot.
 *
 * Keys are "namespaced by owning concern" by declaration, so the namespace is
 * a fact about the key rather than a grouping this screen invented — and it is
 * derived from the key itself, so a module registering a new namespace gets a
 * new group with no change here.
 */
export function namespaceOf(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

/** `rewards.hold_period_days` → `hold period days`, for a heading beside the key. */
export function keyLabel(key: string): string {
  const dot = key.indexOf('.');
  const rest = dot === -1 ? key : key.slice(dot + 1);

  return rest.replaceAll('.', ' · ').replaceAll('_', ' ');
}

/** Namespaces in a stable order, with their keys — derived, never enumerated. */
export function groupByNamespace(
  items: AdminConfigurationKeySummary[],
): { namespace: string; items: AdminConfigurationKeySummary[] }[] {
  const groups = new Map<string, AdminConfigurationKeySummary[]>();

  for (const item of items) {
    const namespace = namespaceOf(item.key);
    const bucket = groups.get(namespace);

    if (bucket) bucket.push(item);
    else groups.set(namespace, [item]);
  }

  // Alphabetical, so the page does not reorder itself when the API's ordering
  // changes or a key is added.
  return [...groups.entries()]
    .map(([namespace, group]) => ({
      namespace,
      items: [...group].sort((a, b) => a.key.localeCompare(b.key)),
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
}

/**
 * A stored value, as one line of text.
 *
 * `JSON.stringify` for everything structural, because the alternative is a
 * screen that renders `[object Object]` for the two keys that hold arrays.
 * Strings are shown unquoted — an operator reading a currency code wants
 * `USD`, not `"USD"` — and `null`/`undefined` are named rather than rendered
 * as an empty cell that reads as "not loaded".
 */
export function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);

  return JSON.stringify(value);
}

/** What to put in the form control, which needs JSON's quotes back. */
export function toInputValue(value: unknown, valueType: string): string {
  if (value === undefined) return '';
  if (valueType === 'json') return JSON.stringify(value, null, 2);

  return formatValue(value);
}

export type ParsedValue =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/**
 * A form field, turned back into the type the key declares.
 *
 * Everything arrives from a `<form>` as a string, and the API's schema expects
 * a number, a boolean or an array. This converts; it does **not** validate.
 * `Number('abc')` is `NaN`, and rather than inventing a message this hands the
 * original string on so the key's own schema produces the refusal — which is
 * the sentence that will still be right when the schema changes.
 *
 * **JSON is the exception.** Unparseable text is not a value of any type, so
 * there is nothing to hand on; the API would answer with a schema error about
 * a string, which describes the symptom rather than the mistake. Syntax is
 * also the one thing a browser can be certain of without knowing the rule.
 */
export function parseValue(raw: string, valueType: string): ParsedValue {
  if (valueType === 'boolean') {
    if (raw === 'true') return { ok: true, value: true };
    if (raw === 'false') return { ok: true, value: false };

    return { ok: true, value: raw };
  }

  if (valueType === 'number') {
    const trimmed = raw.trim();
    const parsed = Number(trimmed);

    if (trimmed === '' || Number.isNaN(parsed)) return { ok: true, value: raw };

    return { ok: true, value: parsed };
  }

  if (valueType === 'json') {
    try {
      return { ok: true, value: JSON.parse(raw) as unknown };
    } catch {
      return { ok: false, message: 'That is not valid JSON. Check the quotes, commas and brackets.' };
    }
  }

  return { ok: true, value: raw };
}

/**
 * Whether a global change would be shadowed for some providers.
 *
 * `overrideCount` counts provider-scoped rows, and a provider row wins over the
 * global one — so setting a global value while overrides exist changes the
 * value for everyone *except* the providers an operator is most likely to be
 * thinking about. This is read from the API's own count rather than being a
 * severity this screen assigned to a key.
 */
export function shadowedBy(summary: Pick<AdminConfigurationKeySummary, 'overrideCount'>): number {
  return summary.overrideCount;
}

/** Whether a key can be edited at the scope this screen writes to. */
export function isSettableAt(scopes: ConfigScopeName[], scope: ConfigScopeName): boolean {
  return scopes.includes(scope);
}
