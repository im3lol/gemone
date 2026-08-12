import type {
  AdminConfigurationKeySummary,
  AdminConversionSummary,
  AdminHeldConversionSummary,
  AdminPayoutSummary,
  AdminUserSummary,
  AuditLogEntry,
  Paginated,
  ProviderSummary,
  SyncRunSummary,
  UserFraudSignals,
} from '@gemone/contracts';

/**
 * Shared prop types for the admin queue — docs/UI_KIT.md.
 *
 * In a `.ts` file for the reason `ui/types.ts` records: a type declared in a
 * Svelte instance script is not reliably re-exportable, and `+page.server.ts`
 * needs the shape without importing a component.
 */

/**
 * What the streamed queue call resolves to.
 *
 * **A result, not a rejection** — D83. The pre-redesign page answered any
 * failed call with `redirect(303, '/login')`, which on an admin screen means a
 * queue endpoint having a bad minute logs the administrator out of the tool
 * they were using to investigate it.
 */
export type QueueResult =
  | { ok: true; items: AdminPayoutSummary[]; total: number }
  | { ok: false };

/**
 * What a transition action hands back.
 *
 * A discriminated union so a confirmation and a refusal cannot be confused for
 * one another — the alternative is a bag of optional fields where "nothing
 * happened" and "it failed" look identical.
 */
export type ReviewResult =
  | { ok: true; action: 'approve' | 'reject' | 'settle' | 'fail'; status: string }
  | { ok: false; action: string; message: string };

/**
 * What the streamed provider call resolves to.
 *
 * **A result, not a rejection** — D83. `GET /admin/providers` returns
 * `{ items }` with no pagination: providers are counted in single digits, and
 * a screen that paged through three of them would be ceremony.
 *
 * `runs` is the latest synchronization per provider, resolved from **one**
 * call to `/admin/catalog/sync-runs` rather than one per provider. Sync runs
 * come back newest-first, so the first occurrence of a provider id is its
 * latest run.
 */
export type ProviderResult =
  | { ok: true; items: ProviderSummary[]; runs: Record<string, SyncRunSummary> }
  | { ok: false };

/** What a provider action hands back. A discriminated union, for D83's reason. */
export type ProviderActionResult =
  | { ok: true; action: 'enable' | 'disable' | 'sync' | 'register'; message: string }
  | { ok: false; action: string; message: string };

/**
 * What the streamed fraud queue resolves to.
 *
 * **A result, not a rejection** — D83, for the reason `QueueResult` records: an
 * endpoint having a bad minute should not log an administrator out of the tool
 * they are investigating with.
 */
export type HeldQueueResult =
  | { ok: true; items: AdminHeldConversionSummary[]; total: number }
  | { ok: false };

/**
 * What a fraud decision hands back.
 *
 * Carries the `conversionId` because the queue shows several cards at once and
 * a message with no subject would appear under whichever card the reader
 * happened to be looking at. A success has no card left to sit on — the hold is
 * resolved and gone from the list — so it is announced above the queue.
 */
export type FraudActionResult =
  | { ok: true; action: 'clear' | 'confirm'; conversionId: string; message: string }
  | { ok: false; action: string; conversionId: string; message: string };

/**
 * What the streamed accounts list resolves to.
 *
 * **A result, not a rejection** — D83, for the reason `QueueResult` records.
 */
export type UserListResult =
  | { ok: true; items: AdminUserSummary[]; total: number }
  | { ok: false };

/**
 * What an administrator sees about an account besides the account itself.
 *
 * Every field is nullable and every one is a **separate admin endpoint**, each
 * asked with the `userId` filter it already had. A null is that endpoint
 * having a bad minute, and the panel says so rather than the page failing:
 * none of these is what an admin came to this screen to change.
 */
export interface AccountActivity {
  payouts: Paginated<AdminPayoutSummary> | null;
  conversions: Paginated<AdminConversionSummary> | null;
  signals: UserFraudSignals | null;
  auditLog: Paginated<AuditLogEntry> | null;
}

/** What a user action hands back. A discriminated union, for D83's reason. */
export type UserActionResult =
  | { ok: true; action: 'status' | 'revoke'; message: string }
  | { ok: false; action: string; message: string };

/**
 * What the streamed settings list resolves to.
 *
 * **A result, not a rejection** — D83. `AdminConfigurationKeyList` has no
 * pagination: the keys are declared in code and counted in tens, so a pager
 * over thirty of them would be ceremony.
 */
export type SettingsListResult =
  | { ok: true; items: AdminConfigurationKeySummary[]; total: number }
  | { ok: false };

/**
 * What a settings write hands back.
 *
 * Carries `value` and `reason` on failure so the form can be refilled: a
 * settings form that clears itself on a refusal makes the operator retype a
 * JSON array to find out what was wrong with it the second time.
 */
export type SettingActionResult =
  | { ok: true; action: 'set' | 'reset'; message: string; stale: false; value: string; reason: string }
  | {
      ok: false;
      action: string;
      message: string;
      /**
       * True when the write was refused because somebody else changed the key
       * first — TODO T88. Separated from the message because the recovery
       * differs: every other refusal is fixed by editing what was typed, this
       * one by looking at what is there now.
       */
      stale: boolean;
      value: string;
      reason: string;
    };
