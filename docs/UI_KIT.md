# UI_KIT — the implemented design foundation

> **What this is.** The design system as it exists in `apps/web`: the tokens, the
> global stylesheet and the shared components. It is the document to read before
> writing a screen.
>
> **What it is not.** [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) is an *extraction* of
> the `legacy` branch — a record of what that application did, with provenance
> for every value. It is the source this kit was built from and it is not edited
> to match the rebuild. Where the two differ, the difference is deliberate and
> recorded in [DECISIONS.md](DECISIONS.md) D79–D80.
>
> [UI_AUDIT.md](UI_AUDIT.md) is the gap analysis that produced this phase; its
> finding ids (`F1`, `S4`, `U3`…) are cited throughout.

**Status.** Phase 1 (foundation and shared components) and phase 2 (application
shell and navigation) are done. **No application page has been redesigned yet** —
the pages that predate this work are still their original markup, styled through
element defaults and the compatibility rules in §11, and they move onto the kit
one phase at a time.

---

## 1. Where things live

| Path | Contents |
|---|---|
| `apps/web/src/app.css` | Token layer (`@theme`), element defaults, every multi-property recipe |
| `apps/web/src/lib/components/ui/` | The components |
| `apps/web/src/lib/components/ui/index.ts` | The single import path |
| `apps/web/src/lib/components/shell/` | The application shell — sidebar, topbar, mobile bar |
| `apps/web/src/lib/components/auth/` | The centred authentication card |
| `apps/web/src/lib/components/landing/` | The public marketing page, one component per band |
| `apps/web/src/lib/components/dashboard/` | The dashboard's four panels |
| `apps/web/src/lib/components/earnings/` | The statement — filter, table, pager |
| `apps/web/src/lib/components/payouts/` | The withdrawal screen — balance, form, history |
| `apps/web/src/lib/components/offers/` | The offer wall — filter bar, grid, card, tile |
| `apps/web/src/lib/components/admin/` | The payout queue — tabs, table, review context, decision |
| `apps/web/src/lib/rewards/ledger.ts` | What a ledger movement *means*, in one tested module |
| `apps/web/src/lib/payouts/payout.ts` | What a withdrawal state means, and points as money |
| `apps/web/src/lib/offers/offer.ts` | What an offer category means, and the tile's colour |
| `apps/web/src/lib/admin/payout-queue.ts` | The queue's vocabulary, and which transitions a state offers |
| `apps/web/src/routes/dev/ui/` | Visual showcase — development only, 404s in a production build |
| `apps/web/vite.config.ts` | The Tailwind plugin |

```svelte
import { Button, Card, Input } from '$lib/components/ui';
import { Wallet } from '@lucide/svelte';
```

There is no `tailwind.config.js`. Tailwind v4 is configured in CSS; the `@theme`
block in `app.css` *is* the configuration.

---

## 2. How the CSS is organised

Three layers, in this order:

1. **`@theme`** — the tokens. Tailwind emits each entry twice: as a CSS custom
   property (`var(--color-brand-500)`) and as a utility (`bg-brand-500`).
2. **`@layer components`** — the *recipes*: the handful of multi-property looks
   the system repeats (button, field, card, badge, alert, table, container, type
   scale). Written as plain CSS against the tokens, never with `@apply`.
3. **Tailwind utilities** — layout only: flex, grid, gap, spacing, breakpoints.

Everything of ours sits in `components`, so a utility always wins:
`class="gm-card p-8"` really does get 2rem of padding.

**The division to hold on to:** *recipes in CSS, layout in utilities.* Do not
write a new colour, radius or shadow as a utility on a page — if a look repeats,
it belongs in `app.css` as a `gm-` class. That is what F10 was about.

### Element defaults

Each recipe block also carries bare-element selectors — `input`,
`button[type='submit']`, `h1`, `table`. That is deliberate: a page written in
plain HTML is already on-system, which is how twelve pre-existing pages picked
up the design without a markup change.

---

## 3. Tokens

### 3.1 Brand

The one custom scale. **Tailwind v3's emerald, hard-coded** — v4's own
`emerald-500` is `#00bb7f`, a visibly different green. Never substitute
`emerald-*` (DESIGN_SYSTEM.md §3.1, DECISIONS.md D79).

| Token | Value | Used for |
|---|---|---|
| `--color-brand-50` | `#ecfdf5` | Tints: badges, active nav, accent cards |
| `--color-brand-100` | `#d1fae5` | The focus ring |
| `--color-brand-200` | `#a7f3d0` | Hover border on interactive cards |
| `--color-brand-400` | `#34d399` | Decorative |
| `--color-brand-500` | `#10b981` | **Primary button fill**, progress bars |
| `--color-brand-600` | `#059669` | **Primary hover**, links, positive amounts, field focus border |
| `--color-brand-700` | `#047857` | Text on `brand-50`, active press, the focus outline |

`800`/`900`/`950` exist for the landing gradients and are otherwise unused.

### 3.2 Surfaces and text

| Token | Value | Use |
|---|---|---|
| `--color-background` | `#f8fafc` | The page field. Never white. |
| `--color-surface` | `#ffffff` | Every card |
| `--color-surface-muted` | `#f8fafc` | Filled inputs, hover fills, table row rules |
| `--color-border` | `#f1f5f9` | **The card hairline** — the signature edge |
| `--color-border-strong` | `#e2e8f0` | Field and secondary-button edges |
| `--color-text` | `#0f172b` | Headings and primary numbers |
| `--color-text-body` | `#45556c` | Prose and table cells |
| `--color-text-secondary` | `#62748e` | Labels, subtitles |
| `--color-text-muted` | `#90a1b9` | Units, timestamps, table headers, resting icons |

Four text steps, each with one job. If a fifth seems necessary, one of the four
is being used wrongly.

### 3.3 Semantic colour

Each family is a triple. `-soft` is the tint used as a background, the bare name
is the solid or icon colour, `-text` is the readable foreground on `-soft`.

| Family | soft | solid | text | Means |
|---|---|---|---|---|
| `success` | `#ecfdf5` | `#10b981` | `#047857` | Credited, paid, confirmed |
| `warning` | `#fffbeb` | `#f99c00` | `#dd7400` | Pending, held, needs setup |
| `danger` | `#fef2f2` | `#fb2c36` | `#e40014` | Failed, rejected, reversed, invalid |
| `info` | `#eff6ff` | `#3080ff` | `#155dfc` | Neutral status, in progress |

`danger` is the token family name. The **`error`** variant on `Alert` and
`Badge` maps onto it — one colour, one name, two spellings only because "danger
button" and "error message" are what each thing is called.

`--color-focus` (`#047857`) is the keyboard focus outline. It is not a state
colour and is not used for anything else.

### 3.4 Typography

`--font-sans` and `--font-display` both resolve to **Geist Variable**,
self-hosted from `@fontsource-variable/geist` (upright only — nothing in the
product is italic). `font-display` marks intent, not a second typeface, exactly
as in legacy.

| Class | Size / leading | Weight | Use |
|---|---|---|---|
| `.gm-display` | 3rem → 3.75rem at `sm` | 800 | Landing headline only |
| `h1`, `.gm-page-title` | 1.875 / 2.25rem | 800 | Page title |
| `h2`, `.gm-section-title` | 1.5 / 2rem | 700 | Section |
| `h3`, `.gm-card-title` | 1.125 / 1.75rem | 700 | Card heading |
| *(default)* | 0.875 / 1.25rem | 400 | **Body size is 14px** |
| `.gm-body` | 0.875 / 1.5rem | 400 | Prose, on a looser line |
| `.gm-subtitle` | 0.875 / 1.25rem | 400 | Descriptions, labels |
| `.gm-caption` | 0.75 / 1rem | 400 | Units, timestamps, meta |

Four weights only: 500 `font-medium`, 600 `font-semibold`, 700 `font-bold`,
800 `font-extrabold`. There is no light, no normal-weight heading, no black.

### 3.5 Spacing

Tailwind's default 4px scale (`--spacing: 0.25rem`), unchanged — it is what
legacy compiled against. Two rhythms, held consistently:

- **`gap-4`** (1rem) between cards inside a row
- **`gap-5`** (1.25rem) between major blocks of a page

Card padding is `1.25rem` by default (`p-5`), `1.5rem` for forms, `2rem` for the
auth card.

### 3.6 Radius

The rule that reproduces the identity: **container is round, control is a pill,
badge is barely rounded at all.**

| Token | Value | Shapes |
|---|---|---|
| `--radius-card` | 1rem | Every card, the auth card, modals |
| `--radius-block` | 0.75rem | Inner tiles, icon squares |
| `--radius-field` | 0.5rem | Inputs, selects, small rectangular buttons, alerts |
| `--radius-badge` | 0.375rem | Badges — deliberately the least round thing |
| `--radius-control` | pill | Buttons, avatars, progress bars, icon buttons |

### 3.7 Shadows

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `0 1px 3px 0 #0000001a, 0 1px 2px -1px #0000001a` | Every card and filled button |
| `--shadow-card-hover` | `0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a` | Hover, on interactive cards only |

Legacy uses the small shadow on 49 surfaces and the medium one twice, both times
on hover. Keep that ratio. There is no large shadow and no coloured shadow.

---

## 4. Layout

`main { max-width: 34rem }` is gone. It put a 544px column under every screen in
the product, including tables and the admin payout queue (UI_AUDIT.md S4). Width
is now a property of the surface.

| `size` | Max width | For |
|---|---|---|
| `form` | 24rem | Auth cards, single-field flows |
| `narrow` | 48rem | Legal pages, prose |
| `page` | 72rem | **Default** — every landing and app section |
| `wide` | 96rem | Admin tables and wide data views |
| `full` | none | Full-bleed bands that manage their own inner width |

```svelte
<Container size="wide" as="section">…</Container>
<!-- or the class directly -->
<div class="gm-container gm-container--form">…</div>
```

Horizontal padding steps **1rem → 1.5rem at `sm` → 2rem at `lg`**, matching
legacy's `px-4 sm:px-6 lg:px-8`. A container never needs its padding set by hand.

Which size a route gets is decided by **where the route lives**, not by a
pathname lookup — see §6. `(app)` uses `full` (the sidebar bounds it), `(auth)`
uses `form`, `admin` uses `wide`.

---

## 5. Components

All from `$lib/components/ui`. Every one takes `class` for layout; none of them
takes a colour.

### Button — `variant`, `size`, `loading`, `iconOnly`, `block`, `href`

```svelte
<Button>Save changes</Button>
<Button variant="secondary" size="sm">Cancel</Button>
<Button variant="danger" onclick={reject}>Reject payout</Button>
<Button href="/offers" variant="outline">Browse offers</Button>
<Button iconOnly aria-label="Delete"><Trash2 size={18} aria-hidden="true" /></Button>
```

| Variant | Look | When |
|---|---|---|
| `primary` | brand-500 fill, white, shadow | The one action of the screen |
| `secondary` | White, slate-200 border | Cancel, back, alternatives |
| `outline` | Brand border, no fill | A second brand-level action |
| `ghost` | No chrome until hover | Toolbars, icon buttons, table rows |
| `danger` | Pale red on a red hairline | Destructive |

**`danger` is never a solid red button.** Legacy has none anywhere, and the
restraint is part of the identity: destructive actions are legible without
shouting.

Renders a real `<a>` when `href` is given — middle-click and "open in new tab"
depend on it. `loading` disables the control, adds `aria-busy` and shows a
spinner *beside* the label rather than replacing it; a label that changes width
reflows the row under the pointer mid-click.

### Input / Select / Field

```svelte
<Input label="Email" type="email" bind:value={email} required />
<Input label="Points" type="number" bind:value={points} hint="Available: 4,120" />
<Input label="Password" type="password" error={form?.passwordError} />
<Select label="Payout method" options={methods} bind:value={method} />
```

`Field` is the wrapper — label, control, hint, error — and it owns the
accessibility: a real `for`/`id` pair, `aria-describedby` pointing at whichever
of hint and error exists, `aria-invalid` when there is an error, and
`role="alert"` on the error so a failed submit is announced without stealing
focus. Use `Field` directly for any control the kit does not ship:

```svelte
<Field label="Notes" hint="Internal only">
  {#snippet children({ id, describedBy, invalid })}
    <textarea {id} aria-describedby={describedBy} aria-invalid={invalid} class="gm-field"></textarea>
  {/snippet}
</Field>
```

`Input` covers the text-like types only. Checkboxes and radios need a different
layout and are not forced through it.

### Card

```svelte
<Card>…</Card>
<Card padding="lg" as="section">…</Card>
<Card interactive>…</Card>   <!-- hover lift: offer cards only -->
```

White, slate-100 hairline, small shadow, 16px radius. Most of the visual
identity is this one rule.

### Badge

`neutral` · `brand` · `success` · `warning` · `error` · `info`, plus `purple`,
`indigo` and `pink` for the offer-category and ledger-type colour coding legacy
uses. The enum→tone maps (DESIGN_SYSTEM.md §13.2) belong with the screens that
own those enums, not here.

### Alert — `variant`, `title`, `live`

`error` and `warning` render `role="alert"`; `success` and `info` render
`role="status"`. Pass `live={false}` for copy that is present on first paint and
is not news — announcing a standing explanation on every page load trains people
to ignore the region that matters.

### PageHeader, StatCard, EmptyState, ErrorState

```svelte
<PageHeader title="Earnings" description="Everything you have earned.">
  {#snippet actions()}<Button size="sm">Withdraw</Button>{/snippet}
</PageHeader>

<StatCard label="Current balance" value="4,120" unit="points" icon={DollarSign}
          trend={{ label: '+320 this week', direction: 'up', sentiment: 'positive' }} />
```

`StatCard.trend` takes an explicit `direction` and `sentiment` rather than
inferring them from a sign, because down is not always bad — a falling reversal
rate is good news.

`ErrorState.detail` is for a quotable code or request id. **Never a stack trace
or an internal message.**

### Spinner, Skeleton

Skeletons are `aria-hidden`; the announcement belongs on the region that is
loading, as `aria-busy="true"`. Both stop animating under
`prefers-reduced-motion`.

### Modal

A native `<dialog>`. The browser supplies the focus trap, the Escape key, the
inert background and top-layer stacking — four things a `div`-based modal has to
solve and three of which are invisible to anyone testing with a mouse.

`open` is `$bindable` and the element's `close` event writes back to it, because
the browser can close the dialog without asking.

---

## 6. The application shell

Three layouts, chosen by **where a route lives**, not by inspecting its path.
SvelteKit route groups make the folder the decision:

```
src/routes/
  +layout.svelte          loads app.css. No chrome at all.
  (app)/                  AppShell — sidebar, topbar, mobile bar
    dashboard/ offers/ earnings/ payouts/
  (auth)/                 a 24rem column, no session chrome
    login/ register/ forgot-password/ reset-password/ verify-email/
  admin/                  a holding layout until phase 7
```

**A group's parentheses never appear in a URL.** `/dashboard` is still
`/dashboard`, every existing link still resolves, and `hooks.server.ts`'s
`PROTECTED_PREFIXES` still names the same paths — so nothing about who may
reach a page changed when the folders moved.

### AppShell

```svelte
<AppShell pathname={page.url.pathname} email={…} role={…} availablePoints={…}>
  {@render children()}
</AppShell>
```

| Part | Spec | Behaviour |
|---|---|---|
| `Sidebar` | DS §14.2 | 256px, white, slate-100 right edge, sticky full height, `lg` and up |
| `Topbar` | DS §14.3 | Right-aligned identity pill + logout; adds the logo below `lg` |
| `MobileNav` | DS §22.3 | Fixed bottom bar, below `lg` |
| content | DS §15.2 | `.gm-container--full` — the sidebar is what bounds the column |

`(app)/+layout.server.ts` is what fills the topbar: `/users/me` for the identity
and `/rewards/balance` for the figure. A failed profile redirects to `/login`; a
failed **balance** does not — the pill hides the number instead, because a zero
balance and an unknown balance are not the same claim.

### Navigation is data

`shell/nav.ts` is the single source: one list, rendered by both the sidebar and
the mobile bar, filtered by role. Legacy writes each surface's items by hand,
which is how its admin sidebar ended up with eighteen links to nowhere.

- Active matching is `path === href || path.startsWith(href + '/')`. The
  separator is the point: a plain `startsWith` lights up **Payouts** while the
  user is on `/admin/payouts`. Covered by `nav.spec.ts`.
- Active item: `bg-brand-50 text-brand-700` at `rounded-block` (12px) — one step
  tighter than a card, which is what makes the sidebar read as navigation.
- The current item carries `aria-current="page"`, and only one navigation is
  rendered at a time, so only one marker is ever exposed.

### Mobile navigation

Legacy has **none** — below 1024px both its sidebars are `hidden lg:flex` with
no substitute, so every authenticated page is reachable only by URL (DS §22.3,
flagged there as *fix, don't copy*). The replacement is a bottom bar, taken from
legacy's own hero mockup rather than invented: icon over a 10px label, active in
`font-semibold text-brand-600`, the rest `text-text-muted`, on a `border-border`
top rule.

A bar rather than a drawer because with four or five destinations there is
nothing to hide — and no open/close state, no focus trap, nothing to get stuck.
`AppShell` adds `pb-24` below `lg` so the bar never covers the last row of a
page.

### What is deliberately not reproduced

| Legacy element | Why not |
|---|---|
| Gift and Bell buttons in the topbar | Daily bonus and notifications do not exist. A button that opens nothing is the defect UI_AUDIT.md §9 records against legacy. |
| "Get the app" promo card | There is no mobile app to link to. |
| Sidebar items for Surveys, Videos, Referrals, Achievements… | Those routes do not exist. Links to unbuilt pages are what §9 warns about. |

### Two glyphs that are not in Geist

The identity pill uses 🙂 for the avatar and **◈** (U+25C8) before the balance,
both straight from DS §14.3 and §20.3. Neither is in any Geist subset, so both
fall back to a system font. That is fine on every desktop and mobile OS and is
what legacy did; it is worth knowing before debugging a tofu box on a machine
with a minimal font set.

---

## 7. Icons

**`@lucide/svelte`** — the Svelte port of the library legacy used, so the icon
shapes are the same ones in the screenshots.

```svelte
import Wallet from '@lucide/svelte/icons/wallet';

<Wallet size={20} aria-hidden="true" class="text-text-muted" />
```

**Always import from `@lucide/svelte/icons/<kebab-name>`, never from the package
root.** The root is a barrel over 7,586 files, and a named import from it makes
Vite parse every one of them before tree-shaking: measured here, that is a
**50-minute** production build against seconds for the per-icon path. Same
reason, same rule: do not re-export icons through `$lib/components/ui`.

| Size | Use |
|---|---|
| 14 | Delta arrows, chevrons in small text |
| 16 | Inline in buttons and alerts |
| 18 | Admin sidebar |
| 20 | Sidebar items, icon buttons, stat cards |
| 24 | Landing feature icons, empty states |

Colour comes from the surrounding text (`text-text-muted` at rest, the accent
colour inside a stat card). An icon never carries a colour a token does not name.

**Accessibility rule, no exceptions:**
- Decorative icon → `aria-hidden="true"`. This is nearly always the case.
- Icon-only control → `aria-hidden="true"` on the icon **and** `aria-label` on
  the button. The label goes on the thing that is focusable.
- An icon is never the only carrier of meaning. Status is a `Badge` with text.

---

## 8. Responsive

Tailwind's defaults, which are the breakpoints legacy compiled against:

| Prefix | min-width |
|---|---|
| `sm` | 40rem / 640px |
| `md` | 48rem / 768px |
| `lg` | 64rem / 1024px |
| `xl` | 80rem / 1280px |

**Mobile-first.** Write the phone layout unprefixed and add breakpoints upward.
The application had zero `@media` queries before this phase, which meant its
390px layout was accidental (UI_AUDIT.md F4).

The patterns to reach for, all from legacy:

```
grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4     stat rows
grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4   offer grid
flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between    page headers
```

Wide content — tables above all — goes inside `.gm-table-scroll`, which scrolls
itself. **The page body must never scroll horizontally.**

> **Do not copy legacy's mobile navigation, because it has none.** Both sidebars
> are `hidden lg:flex` with no substitute, so below 1024px the authenticated app
> is reachable only by URL (DESIGN_SYSTEM.md §22.3). The replacement is
> `MobileNav` — §6.

---

## 9. Accessibility conventions

Semantic HTML first. ARIA is for what HTML cannot say — a `<div role="button">`
is a bug, not a shortcut.

**Focus.** One global rule: `:focus-visible` draws a 2px `brand-700` (`#047857`)
outline at a 2px offset. Form fields additionally turn their border `brand-600`
and gain a `brand-100` ring — the legacy look, at a contrast ratio that passes.

`outline: none` appears in exactly two places, and **neither may be widened**:

1. `:focus:not(:focus-visible)` on form fields, so the brand ring stands alone
   when someone *clicks* into a field while the outline still appears for anyone
   arriving by keyboard. Legacy drops the outline unconditionally, which is why
   the audit records zero visible focus states.
2. `main[tabindex="-1"]:focus` — the skip link's target. `<main>` is not an
   interactive control; the ring would be drawn around the whole content region
   and read as a stray border. Every control inside it keeps its own.

Verified over CDP with real Tab presses rather than by reading the rule:
`outline: 2px solid rgb(4, 120, 87)` on a link-button, a `<button>` and an
`<input>`, all matching `:focus-visible`.

**Forms.** Every control has a real `<label for>`. `labelHidden` hides it
visually and keeps it for screen readers; there is no bare-placeholder field.
Errors are `role="alert"`, referenced by `aria-describedby`, and the control is
`aria-invalid`.

**Buttons.** `<button>` for actions, `<a href>` for navigation. A disabled link
drops its `href` — `aria-disabled` alone announces the state without preventing
activation. `loading` implies `disabled` and `aria-busy`.

**Live regions.** `role="alert"` for errors and warnings, `role="status"` for
confirmations, and neither for copy that was already on the page.

**Motion.** Every animation in the kit is decorative and stops under
`prefers-reduced-motion: reduce`.

**Targets.** Icon-only buttons are 40px square by default, 32px only in dense
table rows.

---

## 9.1 The authentication card

DESIGN_SYSTEM.md §15.4 and §19. One component, `AuthCard`, and five routes that
differ only in their copy and their fields.

```
routes/(auth)/+layout.svelte   the tinted page: min-h-screen, items-center,
                               bg-gradient-to-b from-brand-50/60 to-white
AuthCard                       the card: gem, title, subtitle, body, small print
```

```svelte
<AuthCard title="Welcome back" subtitle="Log in to continue earning.">
  {#if form?.message}<Alert variant="error" class="mb-4">{form.message}</Alert>{/if}

  <form method="POST" class="flex flex-col gap-4">
    <Input label="Email" name="email" type="email" required />
    <Input label="Password" name="password" type="password" required />
    <Button type="submit" block>Log in</Button>
  </form>

  {#snippet footer()}
    New to GemOne? <a href="/register" class="font-semibold text-brand-600">Create one</a>
  {/snippet}
</AuthCard>
```

Three things about it are worth knowing before changing one of these pages.

**The mark is inside the card, and it is a link.** Phase 2 put the logo in a
header bar at the far left of a page whose form column was centred; its own
review called it orphaned. §19 has the gem centred above the title *inside* the
card, which is where it is now — and since `/` is a landing page, it links
there rather than being decoration.

**The header and footer are centred; the body is not.** Centring a column of
labelled fields makes every label start at a different x-position, so the
`children` region resets to `text-left`.

**The form has no `action`.** `<form method="POST">` posts to the current URL
including its query string, which is how `/login?next=/payouts` survives into
the action. Writing `action="/login"` silently drops it and the redirect after
a successful login goes to the dashboard instead of where the person was going.

---

## 9.2 The landing page

DESIGN_SYSTEM.md §18. Eight full-bleed bands in a flat list on `bg-white`, one
component each, composed by `routes/+page.svelte`:

```
Hero · PipelineStrip · Features · HowItWorks · WaysToEarn · Guarantees · FactsBar · CtaBanner
```

plus `LandingNav` above and `LandingFooter` below. Every band centres its own
content with `Container` at 72rem, which is legacy's `mx-auto max-w-6xl px-6`.

**The copy lives in `landing/content.ts`, not in the markup**, and the note at
the top of that file is the rule the whole folder is written to: *nothing on
the public page asserts a fact about GemOne that is not true of the system as
built.* Three of legacy's bands state user counts, payout totals, named
testimonials and six offer-network partnerships. The shapes are reproduced
exactly and the contents are not — D82 has the table of what changed and why.
Read it before adding a statistic.

**Nothing here is a one-off style that should have been a recipe.** The two
hero pills are `Button size="lg"`, which is already `px-6 py-3 text-base`; the
header pill is the default size; the feature and guarantee cards are `Card`.
What *is* written inline is the marketing-only geometry — the phone frame, the
rotated props, the six tinted tiles, the `rounded-3xl` slab — because each of
those shapes appears exactly once in the product and a recipe for a single
caller is a recipe nobody can change safely.

**`PhoneMockup` is `aria-hidden`.** It is a picture of the product drawn in
HTML; read aloud it becomes sample data announced as though it were the
reader's own balance.

### The mobile menu

Below `md`, legacy's header is logo + "Sign up" and nothing else — no links, no
hamburger, no way to reach a section (§18.3). `LandingNav` adds a disclosure
button instead:

- a real `<button>` carrying `aria-expanded` and `aria-controls`;
- Escape closes it — a panel that only closes by hitting the same small target
  again is a trap for anyone not using a pointer;
- choosing a link closes it, since every link is an in-page anchor and the
  panel would otherwise cover what it just scrolled to.

It is **not** a modal. The panel pushes the page down rather than covering it,
so there is no focus trap to get wrong and no scroll lock to leak.

---

## 9.3 The dashboard

DESIGN_SYSTEM.md §16, §11.2, §15.5. Four panels, each taking already-loaded
data:

```
BalanceGrid       four StatCards — available · pending · locked · lifetime
RecentActivity    the last five ledger movements, and all four of its states
EarningsOverview  a stacked proportion bar plus the three lifetime totals
AccountCard       email, status, member since
```

Three things about it generalise to the pages still to be built.

### Meaning lives in a module, not a template

`$lib/rewards/ledger.ts` turns a `RewardTransactionRecord` into words: what
happened (`describe`), where the points are now (`statusOf`), the glyph, the
grouped amount, the relative time. Every one of those is a small judgement
about somebody's money, and judgements about money belong somewhere a test can
reach them — `ledger.spec.ts` is 20 tests over a fixture record.

The components import it and render. None of them decides anything.

### The clock is a parameter

`relativeTime(iso, now)` takes the reference instant rather than reading
`Date.now()`. The page renders on the server and again when it hydrates; a
function with its own clock says "4 minutes ago" in the HTML and "5 minutes
ago" a beat later in the browser. The load reads the clock once, through
`$lib/time.ts` — the app's single seam, and the reason the repo's
`no-restricted-syntax` ban on bare `new Date()` is satisfied honestly rather
than dodged.

### A panel owns its own four states

`RecentActivity` takes a **promise** and renders loading / empty / error /
populated itself. `+page.server.ts` returns that promise unawaited, so
SvelteKit streams it: the balance cards paint immediately and the list fills
when the ledger answers.

The promise **never rejects** — the load resolves
`{ ok: true, items } | { ok: false }`. A rejected streamed promise takes the
whole page to the error screen, discarding balances that loaded perfectly well;
a resolved failure is a card that says so on a page that still works. D83 has
the longer argument, including why this replaces the `redirect(303, '/login')`
that every page used to answer *any* failed call with.

Copy this shape for the panels in later phases. The rule it encodes: **the
session is the layout's business, and everything else is data.**

### What the API could not tell it — both since filled

Two blanks were left deliberately blank here rather than guessed, and each was
closed by the phase that actually needed it:

- **No offer name on a row.** The ledger record carried a conversion id and no
  title, so every credit read "Offer completed". Closed in phase 5 by recording
  the name when the points move (`sourceLabel`, D85, TODO T77).
- **No currency equivalent.** Legacy prints `≈ $12.56 USD` under every points
  figure. Closed in phase 6 — the rate was always in configuration and simply
  unreachable; `GET /payouts/options` exposes it (D86, TODO T78). The dashboard
  still shows points only, because phase 6's scope was `/payouts`.

Neither was ever filled with a plausible number in the meantime, which is the
part worth copying.

---

## 9.4 The statement

DESIGN_SYSTEM.md §11.3, §12. `/earnings` is the dashboard's shape reused, with
three differences worth copying into the pages still to come.

### The wallet stat card, not the dashboard one

Legacy has two stat-card treatments and this screen gets the second:
`StatCard filled`, a whole-card tint with no icon (§11.3), against the
dashboard's icon-on-a-circle (§11.2). A page one click from another should not
open with the same row of cards.

### One table that drops columns instead of scrolling

At 390px four columns do not fit. **When** and **Status** are
`hidden sm:table-cell` and reappear inside the first cell under the movement
name — same DOM, same rows, no second markup tree, and no sideways scroll.
Verified: at 390 the visible headers are `Movement` and `Points`, and the table
itself does not overflow.

Use this before reaching for a card-list variant. Two layouts of the same data
is two things to keep in step.

### Filters and pagination are URLs

The filter is a `<form method="GET">` and the pager is two `<a>`s. The result
is `?type=CHARGEBACK_DEBIT&offset=20` — bookmarkable, shareable, survives a
reload, undone by the Back button, and working with JavaScript off. No store,
no fetch, no spinner of its own; the server load reads `url.searchParams`.

Two details that are easy to get wrong:

- **Changing the filter drops `offset`.** Page 3 of the old result set is not
  page 3 of the new one — it is usually past the end, which renders empty and
  reads as "there is nothing here".
- **A value the UI does not know is discarded, not forwarded.**
  `?type=NONSENSE` reaching the API is a 400, which becomes the panel's error
  state — a filter nobody chose breaking a page that works. `readType` falls
  back to "everything".

### The offer name

`sourceLabel` on each row: the offer title as it was shown at click time,
recorded when the points moved (D85). Rows written before that column existed
show no second line. This is what closed TODO T77 — the field is on the
contract now, so any surface listing ledger movements can use it.

---

## 9.5 The withdrawal form

DESIGN_SYSTEM.md §9.1, §10. `/payouts` is the first screen in this kit that
*writes*, and three of its rules are worth copying into every form after it.

### A form that cannot succeed is not rendered

The panel has three shapes, chosen in this order: the rules could not be loaded
→ an `ErrorState`; the balance is under the configured minimum → an
`EmptyState` naming the shortfall and pointing at `/offers`; otherwise the
form. A submit button the server is certain to refuse is worse than no button —
it teaches people the product is broken.

Both refusals quote the API's own minimum. Nothing on this screen holds a
number the server did not send.

### Field errors and form errors are different errors

An API failure is split once, in `+page.server.ts`:

- a validation failure's `fields` array, and the domain codes that are really
  about one control (`PAYOUT_AMOUNT_OUT_OF_RANGE` → amount,
  `PAYOUT_DESTINATION_INVALID` → destination), go **on the control**, which is
  what `Field` turns into `aria-invalid` + `aria-describedby` + a `role="alert"`
  message;
- everything else — an insufficient balance, the daily cap, a 503 — stays a
  banner above the form, because it is about the request, not about a box.

Never both. The same sentence twice trains people to ignore the region that
matters. `describe()` is unit-tested for exactly this split.

### Duplicate submission, and what actually prevents it

`use:enhance` sets a `submitting` flag: the button goes `disabled` with
`aria-busy="true"` and a spinner, **and** the enhance callback cancels a
submission that arrives while one is open. The second is not redundant — a form
can be submitted with Enter from any field, where a disabled button is not in
the way. Verified by holding the API open for six seconds and activating the
form six times: one request.

The success path calls `update()`, which is what re-runs every load — so the
balance cards, the topbar pill and the history all refresh from one place
rather than from three fetches written here.

### Points as money

`approxCash()` mirrors `toCashMinor` in the API exactly, integer division and
rounding down included, and an integration test pins them together. It is a
preview; the value stored on the request is the server's. Both the rate and the
currency come from `GET /payouts/options` — when that call fails the line is
omitted, never defaulted.

---

## 9.6 The offer wall

DESIGN_SYSTEM.md §3.5, §17.1. The card grid, and the three things about it
worth carrying forward.

### The pager finally moved

`Pager` is in `ui/` because this is the second screen to need it. It was
`earnings/StatementPager.svelte` and moved verbatim with two new props — `base`
and `label` — the moment a second caller appeared, rather than being copied. A
second copy is where two pagers start disagreeing about whether the last page
shows a Next.

### A card is one link, to us

Legacy's card is an `<a target="_blank">` straight to the network. Ours cannot
be: a click has to be **recorded before the user leaves** (PROJECT.md §4.3), and
the URL to leave for is built server-side by the offer's adapter from a template
the wall contract deliberately withholds. So the card links to `/offers/[id]`,
and the button there is a `<form method="POST">` whose action records the click
and then redirects.

That button says **"Start at Mock"**, not "Start this offer". Pressing it leaves
GemOne for a third party, and a button that does not say so is a surprise.

### Two empty states, again

"No offers match your search" wants the filters cleared. "No offers are
available right now" is a different fact, and on this platform it has a specific
cause: the wall only lists offers from providers a click would be accepted for,
so an empty catalog usually means none is enabled. Telling somebody their search
matched nothing when they searched for nothing would be a lie about their own
screen.

The grid is a `<ul>` — it is a list of things, and "list, 12 items" is the one
piece of structure a wall of cards otherwise loses entirely.

---

## 10. The showcase

```
pnpm --filter @gemone/web dev   →   http://localhost:5173/dev/ui
```

Every component, variant and state on one page. It is how this phase was
verified at 390 / 768 / 1024 / 1440 and how the next phase's changes get checked
against it.

It **404s in a production build**: the guard is `if (!dev) error(404)` in
`+page.server.ts`, and `dev` is a build-time constant, so the branch is not a
runtime permission check that could be misconfigured.

---

## 11. Compatibility rules that are meant to die

Three blocks in `app.css` exist only to keep the pre-phase-1 pages coherent.
Delete each as its pages migrate:

| Rule | Why | Removed when |
|---|---|---|
| `label:not([class])` | Those pages wrap the control inside the label (the legacy pattern) and relied on the old stylesheet for spacing | Every form uses `Input`/`Field` |
| `.gm-legacy-flow` | Preflight removes default margins; these pages have no spacing utilities | Every page owns its layout |
| `.error` / `.notice` | Class names those pages already use, mapped onto the alert recipe | Every notice uses `Alert` |

The bare-element selectors on `input`, `button[type='submit']`, `h1`–`h4` and
`table` are **not** in this list. Those are the design system's element
defaults and stay.
