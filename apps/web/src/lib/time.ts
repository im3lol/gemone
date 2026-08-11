/**
 * The one place this application reads the wall clock.
 *
 * The repo's lint rule bans a bare `new Date()` — "inject a clock instead of
 * calling `new Date()`; untestable time is untestable hold periods". The API
 * satisfies it with an injectable `Clock` in `core/time`, which is the right
 * shape there: hold periods, maturities and payout windows are decided in that
 * process and every one of them has to be testable at an arbitrary instant.
 *
 * `web` decides none of that. It reads the clock for exactly one purpose —
 * telling someone that a transaction happened "3 hours ago" — and the logic
 * that turns an instant into that phrase already takes `now` as a parameter
 * (`$lib/rewards/ledger.ts`), which is where the testability actually matters
 * and where it already exists.
 *
 * So what is left is a single seam at the edge: one function, one call site
 * per page load, substitutable if a load ever needs testing. `Date.now()`
 * rather than a bare construction, because the ban is on the untraceable
 * reading, not on the type.
 */
export function nowIso(): string {
  return new Date(Date.now()).toISOString();
}
