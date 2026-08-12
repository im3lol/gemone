import type { AdminUserSummary, Paginated, UserRole, UserStatus } from '@gemone/contracts';

import type { UserListResult } from '$lib/components/admin';
import { USER_ROLES_IN_ORDER, USER_STATUSES_IN_ORDER } from '$lib/admin/users';
import { apiAuthedJson } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { PageServerLoad } from './$types';

/** `GET /admin/users` caps `limit` at 100. Twenty-five is a screenful of table. */
const PAGE_SIZE = 25;

/**
 * The accounts list — ARCHITECTURE.md §8.4.
 *
 * ## Three filters, all the API's
 *
 * `status`, `role` and `email` are exactly what `ListUsersDto` accepts, and
 * they are forwarded rather than applied here. The email one is a **fragment**:
 * `UsersService.findMany` matches it with `contains`, so "p11" finds every
 * address containing it. That had never worked — the DTO validated the
 * parameter as a complete address — and is fixed in the API rather than worked
 * around here, because a search box that only accepts what you were going to
 * type in full is not a search box.
 *
 * ## Streaming, and why the promise resolves instead of rejecting
 *
 * D83. The header and the filters paint while the list call is open, and a
 * failure resolves `{ ok: false }` rather than rejecting — a rejected streamed
 * promise takes the whole page to SvelteKit's error screen.
 *
 * ## Authorization
 *
 * `admin/+layout.server.ts` refuses a non-admin, and `AdminController` carries
 * `@Roles(ADMIN)` at the class level so every endpoint under it is protected
 * by default. The layout check only avoids rendering a page whose every
 * request will fail; the API is the control.
 */
export const load: PageServerLoad = (event) => {
  const { url } = event;

  const status = readStatus(url.searchParams.get('status'));
  const role = readRole(url.searchParams.get('role'));
  const email = readEmail(url.searchParams.get('email'));
  const offset = readOffset(url.searchParams.get('offset'));

  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (status) query.set('status', status);
  if (role) query.set('role', role);
  if (email) query.set('email', email);
  if (offset > 0) query.set('offset', String(offset));

  const users: Promise<UserListResult> = apiAuthedJson<Paginated<AdminUserSummary>>(
    event,
    `/admin/users?${query}`,
  ).then((result) =>
    result.ok ? { ok: true, items: result.value.items, total: result.value.total } : { ok: false },
  );

  return {
    users,
    status,
    role,
    email,
    offset,
    pageSize: PAGE_SIZE,
    /** Rebuilt from what was applied, so the pager cannot carry a rejected value. */
    query: pageQuery({ status, role, email }),
    now: nowIso(),
  };
};

/** The page's own parameters, as the pager and the filter form should carry them. */
function pageQuery(filters: { status: string; role: string; email: string }): string {
  const params = new URLSearchParams();

  if (filters.status) params.set('status', filters.status);
  if (filters.role) params.set('role', filters.role);
  if (filters.email) params.set('email', filters.email);

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Only a status the contract defines survives.
 *
 * `?status=DROP+TABLE` reaching the API is a 422, which would turn the list
 * into an error state over a URL somebody mistyped. The API validates it too —
 * that is the control; this is about what a person sees.
 */
function readStatus(raw: string | null): UserStatus | '' {
  if (!raw) return '';

  return USER_STATUSES_IN_ORDER.includes(raw as UserStatus) ? (raw as UserStatus) : '';
}

function readRole(raw: string | null): UserRole | '' {
  if (!raw) return '';

  return USER_ROLES_IN_ORDER.includes(raw as UserRole) ? (raw as UserRole) : '';
}

/**
 * A search fragment, trimmed and bounded.
 *
 * Bounded at the same 320 the DTO enforces, so an over-long paste is dropped
 * here rather than becoming a 422 that reads as a broken page. Nothing else is
 * stripped: the value is sent as a query parameter and used in a Prisma
 * `contains`, both of which are parameterised, and a filter that silently
 * removed characters would quietly search for something else.
 */
const EMAIL_FRAGMENT_MAX = 320;

function readEmail(raw: string | null): string {
  return (raw ?? '').trim().slice(0, EMAIL_FRAGMENT_MAX);
}

/** An unparseable offset is page one, not `NaN` rows into the table. */
function readOffset(raw: string | null): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

export const __testing = { readStatus, readRole, readEmail, readOffset, pageQuery, PAGE_SIZE };
