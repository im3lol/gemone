# UI/UX Audit — current `apps/web` against the legacy design reference

> **Status:** analysis only. No application code was modified to produce this
> document. It audits the current SvelteKit app as it actually renders, against
> [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and the 42 captures in
> [design/legacy/](design/legacy/).
>
> **Method.** Every finding below is either read from `apps/web/src` or observed
> in the running stack. The current app was rendered at 1440×900 and 390×844 for
> all 12 pages using the local stack on `:8080`, with real sessions. Where a
> finding is a judgement rather than an observation it says so.
>
> **Counts:** 15 routes (12 with a UI), **57 distinct findings** — 14 P0, 27 P1,
> 13 P2, 3 P3. (`A4` and `U1` are the same defect, listed in two tables for
> navigability and counted once.)

---

## 1. Executive summary

**The current UI is not a weaker version of the legacy design. It is an
unstyled prototype that never had a design applied to it.**

That distinction matters because it changes what the work is. There is no drift
to correct and no theme to adjust — there is no design layer at all:

| Measured in `apps/web/src` | Count |
|---|---|
| CSS custom properties / design tokens | **0** |
| `@media` queries in the entire application | **0** |
| ARIA attributes, `role=`, or `alt=` | **0** |
| `+error.svelte` boundaries | **0** |
| `use:enhance` / pending-state handling | **0** |
| CSS transitions or animations | **0** |
| Icons of any kind | **0** |
| Shared UI components | **0** |
| Separate `<style>` blocks with duplicated hex colours | **8** |
| Distinct hardcoded colours, none of them the brand green | **14** |

The app is 12 pages of semantic HTML with per-page `<style>` blocks. It works —
the previous end-to-end verification proved every flow functions — but visually
it is at the level of an unstyled form. The brand green `#10b981` **does not
appear anywhere**; the primary button is black `#111`, links are the browser
default blue `#0645ad`, and the only greenish colour in the app is `#0a7`, which
is not a token from the design system.

Three structural facts dominate everything else:

1. **There is no landing page.** `/` redirects to `/login` or `/dashboard`. The
   entire public marketing surface documented in DESIGN_SYSTEM §18 — hero, phone
   mockup, features, social proof, stats, CTA, footer — does not exist. This is
   not a styling gap; it is a missing product surface.
2. **Every page is 34rem wide.** `main { max-width: 34rem }` in the root layout
   applies to tables, offer lists and the admin payout queue alike. The app
   cannot present a data table or an offer grid at any viewport.
3. **The app is not responsive.** With zero media queries, the mobile layout is
   whatever the desktop CSS happens to collapse into — and at 390px **the header
   navigation overflows horizontally and is clipped**, which is a functional
   defect, not a cosmetic one.

Alongside those, the **admin surface is 5 of 39 endpoints**: the platform cannot
be operated from a browser. Providers cannot be registered, configuration cannot
be changed, fraud holds cannot be released, and the offer catalog cannot be
synced without direct API calls.

**Assessment:** the redesign is effectively a first implementation of the UI
layer, not a refactor of an existing one. The good news is that the substrate is
sound — the routes, load functions, form actions and BFF are all in place and
verified working, so this is a presentation-layer project with a very low risk of
touching business logic.

---

## 2. Priority levels

| Level | Meaning | Count |
|---|---|---|
| 🔴 **P0** | Broken, missing, or actively harmful to use | **14** |
| 🟠 **P1** | High — the product looks unfinished or is hard to use without it | **27** |
| 🟡 **P2** | Medium — noticeable quality gap | **13** |
| 🟢 **P3** | Polish | **3** |
| | **Total** | **57** |

Findings are numbered by area: **F** foundation · **S** shell/navigation ·
**L** landing · **A** authentication · **P** app pages · **AD** admin ·
**U** UX (independent of legacy).

---

## 3. Foundation findings

These are the root causes. Almost every page-level finding below is a symptom of
one of these, which is why §8 puts them first.

| ID | Pri | Finding | Legacy reference |
|---|---|---|---|
| **F1** | 🔴 P0 | **No design token layer.** Zero CSS custom properties. Colours, spacing, radius and type are literal values repeated across 8 `<style>` blocks. There is no single place to change the brand. | DS §2.1, §3.1 — legacy defines an `@theme` block with an 11-step brand scale |
| **F2** | 🔴 P0 | **The brand colour is absent.** `#10b981` / `#059669` appear nowhere. Primary buttons are `#111` black; links are `#0645ad`; "points" use `#0a7`, which is in no palette. The product has no visual identity. | DS §3.1 |
| **F3** | 🔴 P0 | **Wrong typeface.** `font-family: system-ui, sans-serif`. Geist Sans is not loaded and there is no display/body distinction. | DS §4.1 |
| **F4** | 🔴 P0 | **Zero responsive CSS.** No `@media` query exists in the application. Layout at 390px is accidental. | DS §22.1 — legacy uses `sm/md/lg/xl` deliberately |
| **F5** | 🟠 P1 | **Radius is 4–6px throughout.** Legacy's silhouette is `rounded-2xl` (16px) containers with `rounded-full` controls; the current app reads as generic form UI. | DS §6 |
| **F6** | 🟠 P1 | **No shadows.** Cards are flat 1px boxes. Legacy uses `shadow-sm` on 49 surfaces to separate white cards from the grey field. | DS §8 |
| **F7** | 🟠 P1 | **Neutral palette is off.** Background `#fafafa` vs `slate-50 #f8fafc`; borders `#e5e5e5`/`#eee`/`#ccc` vs `slate-100 #f1f5f9` / `slate-200 #e2e8f0`. Three different border colours are used for the same job. | DS §3.2, §7 |
| **F8** | 🟠 P1 | **No icon system.** Zero icons. Legacy uses `lucide-react` at four defined sizes across navigation, stat cards and buttons — icons carry a large share of the visual identity. | DS §20.1 |
| **F9** | 🟡 P2 | **No hover, focus or transition treatment.** No `:hover` beyond browser defaults, no `:focus-visible`, no `transition`. | DS §21.3–21.4 |
| **F10** | 🟡 P2 | **Styling is duplicated per page, not shared.** Table CSS is written three times (earnings, payouts, admin payouts) with slightly different values each time. | DS §2.2 |

---

## 4. Landing page audit

**The landing page does not exist.** This section audits an absence, so it is
structured as a build specification rather than a list of defects.

### 4.1 Current state

`apps/web/src/routes/+page.server.ts` is nine lines:

```ts
export const load: PageServerLoad = ({ locals }) => {
  redirect(303, locals.session ? '/dashboard' : '/login');
};
```

Its comment says *"A marketing landing page is M6's problem (PROJECT.md §7)"* —
but M6 in PROJECT.md lists deployment, beta, documentation and *"Legal pages
published"*, and **does not mention a landing page**. So the landing page is
referenced as planned while being in no milestone. Worth resolving explicitly
rather than inheriting the ambiguity.

| ID | Pri | Finding |
|---|---|---|
| **L1** | 🔴 P0 | **No public landing page.** A logged-out visitor is sent straight to a login form. There is no way to learn what GemOne is before creating an account. |
| **L2** | 🔴 P0 | **No public shell.** No marketing navbar and no footer exist. The only header in the app is the authenticated one. |
| **L3** | 🟠 P1 | **No legal pages.** `/terms`, `/privacy`, `/cookies` do not exist, though M6 requires "Legal pages published" and legacy ships all three plus a shared `LegalPage` frame. |
| **L4** | 🟡 P2 | **The landing page belongs to no milestone.** Code comment and PROJECT.md disagree. |

### 4.2 The landing page is a marketing page, not a catalog

Worth stating plainly because it is the most likely mistake: **the legacy landing
page contains no offers.** No offer grid, no wall, no pricing, no live catalog.
The product is communicated entirely through:

- the **phone mockup** showing a miniature of the real dashboard (DS §18.5), and
- the **six category tiles** — Play Games, Surveys, App Offers, Watch Videos,
  Shopping, Referrals (DS §18.9).

A rebuilt landing page that renders real offers on the public route would be a
different product decision, not a reproduction of the legacy design. It would
also leak the catalog to unauthenticated visitors, which the current API does not
allow — `/offers` requires a bearer token (`OffersController` has no `@Public()`).

### 4.3 What has to be built, section by section

Every row is fully specified in DESIGN_SYSTEM §18 with exact classes and values.

| # | Section | Spec | Screenshot | Pri |
|---|---|---|---|---|
| 1 | Sticky navbar, 64px, `bg-white/80 backdrop-blur` | DS §18.3 | [03](design/legacy/landing/03-navbar-and-hero-desktop-1440.png) | 🔴 P0 |
| 2 | Hero — 3-line hand-broken H1 at `text-5xl sm:text-6xl`, dual CTA, avatar+stars proof | DS §18.4 | [02](design/legacy/landing/02-hero-fold-desktop-1440.png) | 🔴 P0 |
| 3 | Phone mockup + 5 rotated floating props + sparkles | DS §18.5 | [03](design/legacy/landing/03-navbar-and-hero-desktop-1440.png) | 🟠 P1 |
| 4 | Partners strip, `text-slate-300` wordmarks | DS §18.6 | [04](design/legacy/landing/04-partners-strip-desktop-1440.png) | 🟡 P2 |
| 5 | Features row — 5 cards, solid `brand-500` icon tiles | DS §18.7 | [05](design/legacy/landing/05-features-row-desktop-1440.png) | 🟠 P1 |
| 6 | How it works — 3 numbered `brand-50` circles | DS §18.8 | [06](design/legacy/landing/06-how-it-works-desktop-1440.png) | 🟠 P1 |
| 7 | Ways to earn — 6 tinted tiles with `bg-white/70` icon plates | DS §18.9 | [07](design/legacy/landing/07-ways-to-earn-desktop-1440.png) | 🟠 P1 |
| 8 | Testimonials — 3 cards, green tick, per-item amount colour | DS §18.10 | [08](design/legacy/landing/08-testimonials-desktop-1440.png) | 🟡 P2 |
| 9 | Stats bar — `rounded-3xl` dark gradient slab | DS §18.11 | [09](design/legacy/landing/09-stats-bar-desktop-1440.png) | 🟠 P1 |
| 10 | CTA banner — `bg-brand-50`, `rounded-3xl`, largest button | DS §18.12 | [10](design/legacy/landing/10-cta-banner-desktop-1440.png) | 🟠 P1 |
| 11 | Footer — brand column + 4 link columns | DS §18.13 | [11](design/legacy/landing/11-footer-desktop-1440.png) | 🟠 P1 |
| 12 | Legal page frame, `max-w-3xl`, arbitrary-variant prose | DS §18.14 | [auth/05](design/legacy/auth/05-legal-terms-desktop-1440.png) | 🟠 P1 |

### 4.4 Landing-specific requirements that are easy to miss

- **Only two bands are tinted** — hero and testimonials — and both use a vertical
  `brand-50` gradient at reduced opacity, not a flat fill (DS §18.2). Getting
  this wrong flattens the whole page.
- **Section padding is not uniform**: `py-10` / `py-12` / `py-14` / `py-16` /
  `lg:py-24`. That variation is the page's rhythm.
- **Hero CTAs are larger than app buttons** — `px-6 py-3` at `text-base`, versus
  `px-5 py-2.5 text-sm` everywhere else (DS §18.4, §9.1).
- **The H1 is hand-broken with `<br />`** and must not reflow (DS §18.4).
- **The stats slab is the only dark surface** on the public site and uses
  `rounded-3xl` (24px), larger than any card.
- **Content data is static copy**, not API-driven — legacy keeps it in
  `lib/data.ts`. The landing page should not require the API to render, which
  also means it can be cached and stays up if the API is down.
- **Decide the truth of the numbers.** Legacy's "30,000+ Active Users / $2M+ Paid"
  are invented placeholder copy. Publishing them on a real site would be false
  advertising. Either replace with true figures or drop the stats band. **This is
  a legacy flaw, not a design to copy** — see §9.

### 4.5 Landing responsive

Fully specified in DS §18.15. The landing page reflows cleanly at every width and
hides nothing — it is the part of legacy that survives narrow viewports best.
The **one** thing not to inherit is the missing mobile menu (§9, N1).

---

## 5. Page-by-page audit

Format: current state → problems → legacy reference → direction → priority.

### 5.1 `/` — root

- **Current:** 303 redirect to `/login` or `/dashboard`. No page.
- **Problems:** L1, L2.
- **Legacy:** full marketing page (DS §18).
- **Direction:** render the landing page for anonymous visitors; keep the
  redirect to `/dashboard` for authenticated ones.
- **Priority:** 🔴 P0

### 5.2 `/login`

- **Current:** `<h1>Log in</h1>`, two stacked labelled inputs, black submit
  button, two plain links. On the bare `#fafafa` page in a 34rem column.
  ([current render](design/legacy/auth/01-login-desktop-1440.png) is the *legacy*
  target; the current app has no card at all.)
- **Problems:** A1, A2, A3, A6, A7, F1–F4.
- **Legacy:** centred `max-w-sm` card — `rounded-2xl border border-slate-100
  bg-white p-8 shadow-sm` — on a `from-brand-50/60 to-white` gradient, with the
  gem mark, "Welcome back", and a full-width pill submit (DS §19).
- **Direction:** build the auth card shell once and use it for all five auth
  routes.
- **Priority:** 🟠 P1

### 5.3 `/register`

- **Current:** same as login plus a `<small>At least 12 characters.</small>` hint.
- **Problems:** A1–A3, A5, A6; no referral banner support.
- **Legacy:** same card, "Create your account" / "Start earning rewards in
  seconds.", optional display-name field, and a `?ref=` invitation banner
  (DS §19).
- **Direction:** same card; add the referral banner only if referrals exist in
  the current API — **they do not**, so treat that as out of scope and do not
  copy it.
- **Priority:** 🟠 P1

### 5.4 `/forgot-password`

- **Current:** single email field; on success replaces the form with a `.notice`
  paragraph.
- **Problems:** A1–A3, A6. The success state is a grey box with no icon or
  reassurance styling.
- **Legacy:** **no equivalent** — legacy has no forgot-password flow at all.
- **Direction:** use the auth card; design a proper success state. No legacy
  reference exists, so follow the system rather than a screenshot.
- **Priority:** 🟠 P1

### 5.5 `/reset-password`

- **Current:** hidden token + one password field; success swaps to a notice.
- **Problems:** A1–A3, A6. No indication of password requirements until failure.
- **Legacy:** no equivalent.
- **Direction:** auth card; show the policy up front; confirm-password field is a
  judgement call (the API does not require one).
- **Priority:** 🟠 P1

### 5.6 `/verify-email`

- **Current:** if not verified, renders **a text input asking the user to type a
  verification token**, with a Verify button.
- **Problems:** **A4 🔴** — the emailed link already carries `?token=…`; the page
  should consume it automatically and only fall back to manual entry on failure.
  Asking a user to copy a 43-character token is a broken flow, and it is the
  single worst UX defect in the app.
- **Legacy:** no equivalent.
- **Direction:** auto-submit on arrival; show three clean states (verifying /
  verified / failed with a resend action).
- **Priority:** 🔴 P0

### 5.7 `/dashboard`

- **Current:** a definition list of email / status / member-since, plus a notice
  reading *"Offers and balances arrive in later milestones. This page exists to
  prove the session works end to end."*
- **Problems:** **P1 🔴** — this is a developer scaffold shipped as the primary
  landing surface for a logged-in user. It shows no balance, no offers, no
  activity, and tells the user the product is unfinished.
- **Legacy:** the richest screen in the product — greeting, 5-card stat row with
  a purple level card, daily bonus strip, horizontally scrolling offer rail, and
  a 320px right rail with achievements / referrals / recent activity
  ([app/01](design/legacy/app/01-dashboard-desktop-1600.png)).
- **Direction:** rebuild from data that actually exists today: balance
  (`/rewards/balance`), recent ledger (`/rewards/history`), recommended offers
  (`/offers`), and payout status (`/payouts`). **Do not** port the level/XP card,
  daily bonus, achievements or referral card — none of those exist in the current
  API and inventing them would be fiction.
- **Priority:** 🔴 P0

### 5.8 `/offers`

- **Current:** a search input, two `<select>`s and a Filter button, then an
  unstyled `<ul>` of links: bold title, green points, `GAME · mock`.
- **Problems:** P2, P3, P4, S1 (34rem column), F5–F8.
- **Legacy:** responsive card grid — `sm:2 / lg:3 / xl:4` — each card a
  `rounded-2xl` white card with a coloured tile, difficulty + category badges,
  points beside a USD equivalent, and `hover:border-brand-200 hover:shadow-md`
  ([app/08](design/legacy/app/08-surveys-offer-grid-desktop-1600.png)).
- **Direction:** offer card grid. **Note the blocking dependency:** legacy offer
  tiles are coloured by a per-offer `color` hex from the provider; the current
  `WallOffer` contract has `imageUrl` but no colour. Either use `imageUrl` with a
  deterministic colour fallback derived from the offer id, or accept single-colour
  tiles. Decide before building (DS §3.5).
- **Priority:** 🟠 P1

### 5.9 `/offers/[id]`

- **Current:** back link, title, `1715 points` in `#0a7`, description,
  requirements, a black "Start this offer" button, a notice.
- **Problems:** P5, plus no image/tile, no badges, no provider attribution, no
  indication the button opens a third-party site.
- **Legacy:** no dedicated detail page — legacy cards link straight out to the
  provider. **The current detail page is an improvement over legacy**, so design
  it from the system rather than copying.
- **Direction:** keep the page; give it a hero tile, badges, a prominent reward
  figure and an explicit "opens in a new tab / at the provider" affordance.
- **Priority:** 🟠 P1

### 5.10 `/earnings`

- **Current:** three flex boxes (Available / Pending / Locked), a "Request a
  payout" text link, and a bare table of raw enum types.
- **Problems:** P6, P7, P8, P11, S1. Verified in the render: **the available
  balance shows `-1500` in plain black text** with no colour, sign treatment or
  explanation, which is exactly the state a user is most likely to panic about.
- **Legacy:** four tinted stat cards, a primary Withdraw pill next to a secondary
  Earn-more button, and a ledger table with type badges and `brand-600`/`red-500`
  signed amounts ([app/03](design/legacy/app/03-wallet-desktop-1600.png)).
- **Direction:** tinted stat cards + badge-driven table. Design an explicit
  negative-balance state with an explanation — legacy has no reference for it
  because legacy never showed one.
- **Priority:** 🟠 P1

### 5.11 `/payouts`

- **Current:** a sentence with the available balance, a three-field form, and a
  history table.
- **Problems:** P9, P10, P11. The method `<select>` has one hardcoded option
  (`paypal`) with a code comment admitting it drifts from configuration. No
  minimum/maximum is shown until the API rejects the request — and it does reject
  with `PAYOUT_AMOUNT_OUT_OF_RANGE`, which the user sees only after submitting.
- **Legacy:** a `380px` form card beside a history table, with the minimum stated
  in the subtitle and status badges in the table
  ([app/05](design/legacy/app/05-withdraw-desktop-1600.png)).
- **Direction:** two-column form + history; surface min/max before submission;
  status badges. Consider exposing enabled methods and limits through the API
  rather than hardcoding — that is an API change, so record it rather than doing
  it here.
- **Priority:** 🟠 P1

### 5.12 `/admin/payouts`

- **Current:** an `<h1>`, five status links as a "tab" row (raw enum labels,
  bold-when-active only), and a table with a "Review" link per row.
- **Problems:** AD2, AD3, P10, S7. At 390px the tabs wrap into two ragged lines
  and the header nav is clipped
  (verified render).
- **Legacy:** admin shell with a grouped 240px sidebar, a topbar with search, and
  status badges in the table
  ([admin/03](design/legacy/admin/03-withdrawals-desktop-1600.png)).
- **Direction:** build the admin shell first; then this becomes a table page
  inside it with proper tabs and badges.
- **Priority:** 🟠 P1

### 5.13 `/admin/payouts/[id]`

- **Current:** two definition lists and, for pending payouts, **two separate
  stacked forms** — Approve and Reject — each with its own reason input and an
  identical black button.
- **Problems:** AD3, AD4, U9. Approve and Reject are visually identical; there is
  no confirmation; and the destructive action is not distinguished. Given this
  screen moves real money, that is a real risk.
- **Legacy:** a decision card with a primary Approve and a distinct outlined-red
  Reject, plus an account-context panel
  (DS §9.4 — legacy never renders a solid red button).
- **Direction:** one decision card; primary/destructive distinction; a confirm
  step on Reject and on Mark-paid.
- **Priority:** 🟠 P1

### 5.14 Non-page routes

| Route | Type | Note |
|---|---|---|
| `/logout` | form action | No UI needed |
| `/api/admin/[...path]` | BFF proxy | No UI; already the mechanism any new admin screen will use |

---

## 6. Shell, navigation and UX findings

### 6.1 Shell

| ID | Pri | Finding | Legacy reference |
|---|---|---|---|
| **S1** | 🔴 P0 | **`main { max-width: 34rem }` on every page.** A 544px column for tables, offer grids and the admin queue. This single rule caps the quality ceiling of every screen. | DS §15.2 — legacy content columns are full-width with `px-4 sm:px-6 lg:px-8` |
| **S2** | 🔴 P0 | **No sidebar.** Navigation is five inline text links in a header. | DS §14.2 — 256px sidebar, grouped, with icons and an active pill |
| **S3** | 🔴 P0 | **The header overflows at 390px.** Verified: "gemone" collides with "Offers" and "Dashboard"/"Log out" are clipped off-screen. Not cosmetic — links become unreachable. | DS §22.3 |
| **S4** | 🟠 P1 | **No active navigation state.** Nothing indicates the current page. | DS §14.2 — `bg-brand-50 text-brand-700` pill |
| **S5** | 🟠 P1 | **No identity or balance in the shell.** The user's balance is only visible on two pages. | DS §14.3 — identity pill with avatar, name and `◈ 12,560` in `brand-600` |
| **S6** | 🟡 P2 | **Brand is the lowercase word "gemone"** in bold system font. No mark. | DS §20.2 — SVG gem + wordmark |
| **S7** | 🟠 P1 | **No admin navigation.** `/admin` 404s; `/admin/payouts` is reachable only by typing the URL, and nothing in the authenticated header links to it. | DS §14.4 |

### 6.2 UX problems independent of the legacy design

These would be problems even if the visual design were perfect.

| ID | Pri | Finding |
|---|---|---|
| **U1** | 🔴 P0 | **Email verification requires manual token entry** (see §5.6). |
| **U2** | 🔴 P0 | **No error boundary.** There is no `+error.svelte` anywhere. A failed `load` renders SvelteKit's default error page — no shell, no navigation, no recovery path. Every page can reach this: all `load` functions throw on a non-OK API response. |
| **U3** | 🟠 P1 | **No loading or pending states.** Zero `use:enhance`. Every form is a full page navigation with no feedback; a slow payout submission looks like nothing happened, inviting double submission. |
| **U4** | 🟠 P1 | **No accessibility work.** Zero ARIA attributes; no `:focus-visible` styling; error messages are not associated with their fields; the status "tabs" in the admin queue are links with no `aria-current`. |
| **U5** | 🟠 P1 | **Inconsistent terminology.** "Earnings" vs "Payouts" vs "points" vs "balance" vs "available"; the API says `PAYOUT`, the UI says both "payout" and "withdraw". Legacy uses Wallet / Withdraw / Transactions consistently. Pick one vocabulary and apply it to navigation, headings and copy. |
| **U6** | 🟠 P1 | **Weak action feedback.** Success is a grey `.notice` paragraph; there is no toast, no inline confirmation and no optimistic state. |
| **U7** | 🟡 P2 | **Filtering requires an explicit submit.** Search + two selects + a Filter button, with no active-filter chips and no way to clear. |
| **U8** | 🟡 P2 | **Inconsistent pagination.** `/offers` and `/earnings` have Previous/Next; `/payouts` and both admin pages render the first page only, with no indication more exists. |
| **U9** | 🟡 P2 | **No confirmation on irreversible admin actions.** Reject and Mark-paid both move money and both are one click. |
| **U10** | 🟢 P3 | **No breadcrumbs or page-level context** in admin; the only back affordance is a `←` text link. |

### 6.3 Auth findings

| ID | Pri | Finding |
|---|---|---|
| **A1** | 🟠 P1 | No auth card — forms sit directly on the page background |
| **A2** | 🟠 P1 | No gradient background on auth routes |
| **A3** | 🟠 P1 | No logo mark and no welcome copy |
| **A4** | 🔴 P0 | Manual verification-token entry (= U1) |
| **A5** | 🟡 P2 | Password policy shown only as "At least 12 characters"; the API enforces more and rejects after submission |
| **A6** | 🟠 P1 | No pending state on submit |
| **A7** | 🟡 P2 | Errors are a page-level red box, never attached to the offending field |
| **A8** | 🟢 P3 | No password visibility toggle |

### 6.4 App page findings

| ID | Pri | Finding |
|---|---|---|
| **P1** | 🔴 P0 | Dashboard is a placeholder that tells users the product is unfinished |
| **P2** | 🟠 P1 | Offers render as a text list, not cards |
| **P3** | 🟠 P1 | Categories shown as raw enums (`APP_INSTALL`) |
| **P4** | 🟠 P1 | Sort options shown as raw values (`reward_desc`) |
| **P5** | 🟠 P1 | Offer detail has no tile, badges or provider attribution |
| **P6** | 🟠 P1 | Negative balance rendered as plain black text with no explanation |
| **P7** | 🟠 P1 | Ledger types shown as raw enums (`CONVERSION_CREDIT`) |
| **P8** | 🟠 P1 | Signed amounts have no colour treatment |
| **P9** | 🟠 P1 | Payout limits invisible until the API rejects; methods hardcoded |
| **P10** | 🟡 P2 | Payout and admin statuses are raw enums, not badges |
| **P11** | 🟡 P2 | Empty states are plain paragraphs with no design |
| **P12** | 🟢 P3 | Tables have no horizontal scroll container |

### 6.5 Admin findings

| ID | Pri | Finding |
|---|---|---|
| **AD1** | 🔴 P0 | 34 of 39 admin endpoints have no UI (§7) |
| **AD2** | 🔴 P0 | No admin shell; `/admin` is a 404 |
| **AD3** | 🟠 P1 | Approve and Reject are visually identical stacked forms |
| **AD4** | 🟡 P2 | No confirmation on destructive/irreversible actions |

---

## 7. Admin UI gap

The API is complete; the browser surface is not. **39 admin endpoints exist; 5
have a UI.**

### 7.1 Existing UI

| Screen | Endpoints covered |
|---|---|
| `/admin/payouts` | `GET /admin/payouts` |
| `/admin/payouts/[id]` | `GET /admin/payouts/:id`, `POST :id/approve`, `POST :id/reject`, `POST :id/settle` |

`POST /admin/payouts/:id/fail` exists in the API with no UI even on the one
screen that is built.

### 7.2 Existing API capability with no UI

| Area | Endpoints | What is impossible from a browser today |
|---|---|---|
| **Providers** | 7 | Register a provider, enable/disable it, edit sync interval or postback IP ranges, reset health, inspect adapters. **The offer wall stays empty until this exists** — it is the first thing a new deployment must do. |
| **Catalog** | 5 | List offers, view one, activate/deactivate an offer, trigger a sync, read sync-run history |
| **Configuration** | 5 | Read or change any of the **37 business-rule keys** — reward rate, hold period, payout min/max, fraud thresholds — and read their history. P3 ("everything configurable") is unreachable from the UI. |
| **Fraud** | 5 | See the held-conversion queue, clear or confirm a hold, browse evaluations, read a user's signals. **Held points stay held.** |
| **Users** | 5 | List/search users, view one, suspend/reinstate, revoke sessions, read the audit log |
| **Clicks / Conversions / Postbacks** | 6 | Any investigation of a disputed conversion |
| **Payouts** | 1 remaining | Mark a payout failed |

### 7.3 Missing screens

| # | Screen | Endpoints | Why it matters | Pri |
|---|---|---|---|---|
| 1 | **Admin shell** — sidebar, topbar, `/admin` index | — | Nothing else is reachable without it | 🔴 P0 |
| 2 | **Providers** — list, create, detail, enable toggle, health reset | 7 | Blocks the entire money flow on a fresh deployment | 🔴 P0 |
| 3 | **Catalog** — offer list, offer detail, activate toggle, sync trigger, sync-run history | 5 | Operating the wall day to day | 🔴 P0 |
| 4 | **Fraud queue** — held list, review action, evaluations, user signals | 5 | Held user money cannot be released otherwise | 🔴 P0 |
| 5 | **Configuration** — key list, detail with history, edit, reset | 5 | 37 business rules, all admin-only | 🟠 P1 |
| 6 | **Users** — search, detail, status change, session revoke | 4 | Support and abuse response | 🟠 P1 |
| 7 | **Audit log** — filterable list | 1 | Every admin action is already recorded; nothing reads it | 🟠 P1 |
| 8 | **Payout `fail` action** on the existing detail screen | 1 | Completes the state machine | 🟠 P1 |
| 9 | **Conversions / clicks / postbacks** — investigation views | 6 | Disputes and provider debugging | 🟡 P2 |

### 7.4 Recommended admin order

1. Admin shell (nothing works without it)
2. Providers → 3. Catalog → 4. Fraud queue *(these three unblock operations)*
5. Configuration → 6. Users → 7. Audit log
8. Payout `fail` + confirmations
9. Investigation views

**Note:** the BFF proxy at `/api/admin/[...path]` already forwards every admin
endpoint with authorization intact, so **no backend work is required** for any of
these screens. This is purely UI.

---

## 8. Component audit

There are **no shared UI components** in `apps/web` — not one. Every page writes
its own markup and CSS. These are the components the audit implies; the count
after each name is how many current pages would use it immediately.

### 8.1 Foundation (build first)

| Component | Used by | Spec |
|---|---|---|
| **Token layer** (CSS custom properties or Tailwind `@theme`) | all | DS §3–§8 |
| **`Button`** — primary pill / secondary pill / small rect / destructive outline / icon | 12 | DS §9.1–9.6 |
| **`Input` / `Select` / `Field`** — label + control + hint + error | 7 | DS §10.1–10.2 |
| **`Card`** — `rounded-2xl border-slate-100 bg-white p-5 shadow-sm` | 9 | DS §11.1 |
| **`Badge`** — 10 tones + the enum→tone maps | 5 | DS §13.1–13.2 |
| **`Table`** — header/rows/numeric/scroll container | 4 | DS §12 |
| **`Alert` / `Notice`** — error + success inline | 8 | DS §10.3 |
| **`EmptyState`** — dashed border, centred copy, optional action | 5 | DS §17.2 |
| **`PageHeader`** — title + subtitle + optional right action | 12 | DS §15.2 |

### 8.2 Application shell

| Component | Spec |
|---|---|
| **`AppShell`** — sidebar + topbar + content column | DS §15.2 |
| **`Sidebar`** — grouped nav, icons, active pill, `hidden lg:flex` | DS §14.2 |
| **`MobileNav`** — **no legacy reference; must be designed** (§9, N1) | — |
| **`Topbar`** — identity pill with balance, icon buttons | DS §14.3 |
| **`AdminShell` / `AdminSidebar` / `AdminTopbar`** | DS §14.4–14.5 |

### 8.3 Domain components

| Component | Spec |
|---|---|
| **`StatCard`** — label, tinted circular icon, big number, unit, accent sub-line | DS §11.2 |
| **`TintedStatCard`** — whole-card tint variant | DS §11.3 |
| **`OfferCard`** — tile, badges, points + USD, truncated copy | DS §17.1 |
| **`OfferGrid`** — `sm:2 lg:3 xl:4` + empty state | DS §17.1–17.2 |
| **`LedgerRow` / `AmountCell`** — signed colour treatment | DS §12 |
| **`StatusBadge`** — payout / ledger / user status maps | DS §13.2 |

### 8.4 Missing patterns with no legacy reference

Legacy has none of these, so they must be designed from the system rather than
copied. Flagged explicitly so nobody goes looking for a screenshot:

| Component | Why it is needed |
|---|---|
| **`LoadingState` / skeletons** | U3 — legacy has none either (DS §25.8) |
| **`ErrorBoundary` page** | U2 — legacy has no `error.tsx` (DS §25.9) |
| **`ConfirmDialog` / modal** | AD4, U9 — legacy has no modal anywhere |
| **`Toast`** | U6 |
| **`Pagination`** | U8 — legacy paginates nothing |
| **`Tabs`** | admin queue filters |
| **`FilterBar` with active chips** | U7 |

### 8.5 Marketing components

| Component | Spec |
|---|---|
| **`MarketingNav`**, **`MarketingFooter`** | DS §18.3, §18.13 |
| **`Hero`**, **`PhoneMockup`**, **`FloatingProp`** | DS §18.4–18.5 |
| **`FeatureCard`**, **`StepCircle`**, **`CategoryTile`**, **`TestimonialCard`**, **`StatsSlab`**, **`CtaBanner`** | DS §18.7–18.12 |
| **`LegalPage`** | DS §18.14 |

---

## 9. Legacy flaws — documented, not to be copied

DESIGN_SYSTEM already marks these. Repeated here so they are not reintroduced
during the rebuild.

| # | Legacy flaw | What to do instead |
|---|---|---|
| **N1** | **No mobile navigation.** Both legacy sidebars are `hidden … lg:flex` with no substitute; below 1024px the authenticated app has no navigation at all (DS §22.3). | Build a real mobile nav. DS §22.3 records the intended design from the hero mockup: a four-item bottom bar, active item `font-semibold text-brand-600`. |
| **N2** | **No `:focus-visible` styling anywhere** (DS §18.16). | Extend the documented input focus treatment — `brand-400` border + `brand-100` ring — to every focusable control. |
| **N3** | **Buttons with no hover state** — the six "Explore" tiles (DS §18.16). | Every interactive element gets a state. |
| **N4** | **No loading states, no skeletons, no spinners, no `error.tsx`** (DS §25.8–25.9). | Design them; do not inherit the absence. |
| **N5** | **Dead navigation** — 18 of 23 legacy admin sidebar items are `href="#"`, and the landing nav links all go nowhere. | Ship navigation only for screens that exist. |
| **N6** | **Invented marketing statistics** — "30,000+ Active Users", "$2M+ Paid to Users", and three fabricated testimonials with names and payout amounts (DS §18.10–18.11). | Do not publish these as fact. Use real numbers or remove the sections until there are real numbers and real consenting testimonials. |
| **N7** | **Placeholder brand assets** — the gem logo is commented in legacy as "swap for real brand asset when available"; offer tiles are a letter on a colour block. | Fine to ship as-is, but record them as placeholders rather than finished design. |

---

## 10. Responsive and mobile audit

### 10.1 Current state — measured

| Viewport | Behaviour |
|---|---|
| 1440px | Every page is a 544px column centred in the viewport. ~62% of the screen is empty on data-heavy pages. |
| 390px | **Header nav overflows horizontally and clips.** Content column falls back to `padding: 2rem 1.5rem` with no adjustment. The earnings three-bucket flex row squeezes to three ~100px cells. Tables force a wider-than-viewport scroll on the page body rather than inside a container. |

There are **zero media queries**, so nothing above is a designed breakpoint — it
is default flow behaviour.

### 10.2 Findings

| ID | Pri | Finding |
|---|---|---|
| **S3** | 🔴 P0 | Header clips at mobile; navigation links unreachable |
| **F4** | 🔴 P0 | No responsive system at all |
| **R1** | 🟠 P1 | Data tables have no `overflow-x` container; they widen the page instead |
| **R2** | 🟠 P1 | Stat rows use fixed flex with no wrap or column stacking |
| **R3** | 🟡 P2 | No touch-target sizing; links are default-size text in dense rows |

`S3` and `F4` are repeated here from §6.1 and §3 because they are responsive
defects as much as structural ones; they are counted once, in their home section.

### 10.3 Target behaviour

Adopt the documented breakpoints (DS §22.1): `sm 640 · md 768 · lg 1024 · xl 1280`.

| Surface | < 640 | 640–1023 | ≥ 1024 |
|---|---|---|---|
| App shell | Topbar + **bottom nav** (N1) | same | Sidebar + topbar |
| Stat rows | 1 column | 2 columns | 4–5 columns |
| Offer grid | 1 column | 2 columns | 3–4 columns |
| Tables | horizontal scroll inside the card | same | full width |
| Landing | single column, all bands kept | 2-up grids, nav links appear | full layouts |
| Admin | table → scroll container; nav via drawer | same | sidebar |

---

## 11. Recommended implementation order

Ordered so each phase makes the next cheaper, and so the platform becomes
operable as early as possible.

| # | Phase | Contents | Why here |
|---|---|---|---|
| **1** | **Design foundation** | Token layer, Geist, base reset, the 9 foundation components (§8.1) | Everything else is a consumer of this. F1–F10. |
| **2** | **App shell + navigation** | `AppShell`, sidebar, topbar with balance, **mobile nav**, active states, remove the 34rem cap, `+error.svelte` | S1–S6, U2, N1. Fixes the clipped mobile header (P0) and unblocks every page. |
| **3** | **Authentication** | Auth card shell across all five routes; **fix email verification** (P0); pending states | A1–A8, U1, U3. Small, self-contained, and it is the first thing a new user sees. |
| **4** | **Dashboard** | Replace the placeholder with real balance / activity / offers | P1 (P0). Highest-visibility screen. |
| **5** | **Offers** | Card grid, badges, humanised labels, filter bar, offer detail | P2–P5, U7 |
| **6** | **Earnings / payouts** | Stat cards, ledger badges, signed amounts, negative-balance state, payout form with visible limits | P6–P11 |
| **7** | **Admin shell** | Sidebar, topbar, `/admin` index, nav entry from the app | AD2 (P0) |
| **8** | **Admin — operations** | Providers → Catalog → Fraud queue | AD1 (P0). **After this the platform is operable from a browser.** |
| **9** | **Admin — the rest** | Configuration, Users, Audit log, payout `fail`, confirm dialogs | AD1, AD3, AD4, U9 |
| **10** | **Landing page** | Marketing shell, all 9 bands, legal pages | L1–L3 |
| **11** | **Responsive polish** | Breakpoint pass across every screen at 390 / 768 / 1440 | §10 |
| **12** | **Accessibility + visual QA** | Focus-visible everywhere, ARIA, contrast, keyboard paths, final diff against the legacy captures | U4, N2, N3 |

### Why the landing page is at 10 and not 2

The brief's suggested order puts it second. Recommending otherwise, with the
reasoning stated so the call is yours to overturn:

- The landing page is **standalone** — it shares only the token layer with the
  app, so it does not block or get blocked by anything after phase 1.
- Nothing about it is on the critical path to a working product. The platform
  currently **cannot be operated from a browser at all** (AD1/AD2), and that
  gates real usage in a way a marketing page does not.
- It is the **largest single phase** (nine bespoke sections, a phone mockup, five
  floating props) and the one most likely to expand in scope.
- Two of its sections — stats and testimonials — are **blocked on a content
  decision** (N6): they cannot ship with legacy's invented numbers.

If launch marketing is date-driven rather than readiness-driven, move it to 5 —
after the app shell and dashboard, so the phone mockup mirrors a dashboard that
actually looks like the screenshot.

---

## 12. Before/after success criteria

Measurable, so "done" is not a matter of opinion.

### 12.1 Foundation

| Criterion | Now | Target |
|---|---|---|
| CSS custom properties / theme tokens | 0 | Single source; **0 hardcoded hex values** outside it |
| Distinct border colours in use | 3 (`#e5e5e5`, `#eee`, `#ccc`) | 2 (`slate-100` containers, `slate-200` controls) |
| `@media` queries | 0 | Every layout component responds at `sm/md/lg/xl` |
| Shared UI components | 0 | ≥ 15 (§8.1–8.3) |
| Per-page `<style>` blocks with duplicated rules | 8 | 0 duplicated rules |
| Brand green present | no | `#10b981` primary / `#059669` hover on every primary action |
| Typeface | `system-ui` | Geist Sans loaded with a fallback chain |

### 12.2 Visual conformance

- Primary actions are **`rounded-full`, `bg-brand-500`, `hover:bg-brand-600`**.
- Containers are **`rounded-2xl border-slate-100 bg-white shadow-sm`** on a
  `slate-50` field.
- **No raw enum reaches the screen.** `APP_INSTALL` → "App install",
  `CONVERSION_CREDIT` → "Offer completed", `reward_desc` → "Highest reward".
- Every status value renders as a **`Badge`** using the documented tone maps.
- A side-by-side of each rebuilt screen against its legacy capture in
  `docs/design/legacy/` shows the same colour, radius, weight and spacing system.

### 12.3 Completeness

| Criterion | Now | Target |
|---|---|---|
| Public landing page | none | Live at `/` with all 9 bands |
| Legal pages | 0 | 3 (`/terms`, `/privacy`, `/cookies`) |
| Admin endpoints reachable from a browser | 5 / 39 | ≥ 34 / 39 (investigation views optional) |
| Placeholder text visible to users | 1 ("arrives in later milestones") | 0 |
| Pages with a designed empty state | 0 | all list/table pages |
| Pages with a loading state | 0 | all form submissions and navigations |
| Error boundaries | 0 | root + admin |

### 12.4 Operability — the decisive test

**A new administrator can, using only a browser:** register a provider, enable
it, trigger a catalog sync, see offers appear on the wall, change a configuration
value, release a held conversion, and approve and settle a payout.

Today that sequence requires 7 direct API calls. Target: **0**.

### 12.5 Responsive

- At **390px**: no horizontal page scroll on any route; every navigation
  destination reachable; every touch target ≥ 44×44px.
- At **768px** and **1440px**: no layout wider than its container; no data table
  overflowing its card.
- The 390px header clipping defect (S3) is gone — verified by re-rendering the
  same captures used in this audit.

### 12.6 Accessibility

- Every interactive element has a visible `:focus-visible` state.
- Form errors are programmatically associated with their inputs.
- Body text meets WCAG AA contrast against its background; the current
  `#666`-on-`#fff` (5.7:1) passes, but `slate-400` on white (3.0:1) **does not** —
  legacy uses it for captions, so it needs checking rather than copying.
- Every page is fully navigable by keyboard.

---

## 13. Appendix — audit inputs

| Input | Detail |
|---|---|
| Routes audited | **15** — 12 with a UI, plus `/`, `/logout`, `/api/admin/[...path]` |
| Current-app renders | 18 captures at 1440×900 and 390×844, all 12 pages, real sessions on the local stack |
| Legacy reference | `docs/DESIGN_SYSTEM.md` (25 sections) + 42 captures in `docs/design/legacy/` |
| Legacy source | consulted on branch `legacy` (`e9215139`) read-only, via `git show` |
| API surface | 39 admin endpoints counted from `apps/api/src/modules/admin/*.controller.ts` |
| Source measurements | `apps/web/src` — token/media-query/ARIA/enhance/error-boundary counts in §1 |

The current-app screenshots were working artefacts and are **not** committed —
they show local fixture data and are reproducible from the running stack. Only
the legacy reference captures are kept in the repository, since those are the
thing that must outlive the branch.

---

## 14. Implementation status

| Phase | Status | Where it landed |
|---|---|---|
| **1 — Design foundation** | Done | `apps/web/src/app.css`, `apps/web/src/lib/components/ui/`, documented in [UI_KIT.md](UI_KIT.md) |
| **2 — Application shell** | Done | `apps/web/src/lib/components/shell/`, route groups `(app)` / `(auth)` |
| **3 — Authentication + landing** | Done | `apps/web/src/lib/components/auth/`, `apps/web/src/lib/components/landing/`, `routes/(auth)/`, `routes/+page.svelte` |
| **4 — Dashboard (MVP)** | Done | `apps/web/src/lib/components/dashboard/`, `apps/web/src/lib/rewards/ledger.ts`, `routes/(app)/dashboard/` |
| **5 — Earnings** | Done | `apps/web/src/lib/components/earnings/`, `routes/(app)/earnings/`, plus the API's `source_label` (D85) |
| **6 — Payouts** | Done | `apps/web/src/lib/components/payouts/`, `apps/web/src/lib/payouts/`, `routes/(app)/payouts/`, plus `GET /payouts/options` (D86) |
| **7 — Offers** | Done | `apps/web/src/lib/components/offers/`, `apps/web/src/lib/offers/`, `routes/(app)/offers/` and `offers/[id]/`, `ui/Pager.svelte`. **No API change** |
| **8 — Admin payout review** | Done | `apps/web/src/lib/components/admin/`, `apps/web/src/lib/admin/`, `routes/admin/payouts/` and `payouts/[id]/`. **No API change**; plus `QUEUE_PREFIX` (D88, closing T81) |
| **9 — Providers + MVP consistency** | Done | `routes/admin/providers/`, `$lib/admin/providers.ts`; `WallOffer.providerName` (closing T82); the rate on the `(app)` layout (D89, closing T83) |
| 10–12 | Not started | — |

Phase 1 closes **F1–F10** (the foundation findings) and supplies the nine
components §8.1 lists, plus Modal, Spinner, Skeleton and ErrorState from §8.4.
It also removes the `main { max-width: 34rem }` cap behind **S4** and stops the
390px header clipping its own links (**S1**).

Phase 2 closes the shell findings: a real sidebar and topbar, and the mobile
bottom bar legacy never had (**S1**, **S2**).

Phase 3 closes **§10** — the landing page, ranked 10/10 for a reason this audit
argues at length: `/` used to redirect to `/login`, so the product's entire
public face was a password form. It now renders the eight-band marketing page
of DESIGN_SYSTEM.md §18, and the authentication cards of §19 replace the
element-default forms. The mobile navigation gap §18.3 records is closed with a
disclosure menu. Every page-level finding from §4–§8 remains open until its
phase.

Phase 4 rebuilds `/dashboard`, which this audit records as one of the screens
with no design at all — a definition list of three profile fields under a
notice explaining that balances arrive later. It now shows the three balance
buckets and lifetime earnings, the recent ledger, a proportion summary and the
account panel, with all four of loading / empty / error / populated actually
reachable (**U2**, **U3**). Five of legacy's eight dashboard blocks are
deliberately absent — D84 lists them and why.

Phase 5 rebuilds `/earnings`, which this audit records as a 34rem column
containing an unstyled three-cell table whose "What" column printed the raw
enum name. It is now the wallet's tinted balance row (DS §11.3) over a real
statement: type filter, pagination, all four states, and — the part that needed
an API change — the **offer's own name on every row** (D85, closing TODO T77).
The table drops two columns into the first cell below `sm` rather than
scrolling sideways.

Phase 6 rebuilds `/payouts`, which this audit records as element-default inputs
under a bare `<h1>` — and, worse, a method dropdown with `['paypal']` written
into the component, contradicting PROJECT.md §4.6's promise that enabling a
payment method needs no deployment. It is now the wallet row in its withdrawal
reading (available / still clearing / **reserved**, the bucket `/earnings`
leaves out), a form whose every rule is read from configuration, and the
request history with all four states. The form is not rendered at all when it
could not succeed — no options loaded, or a balance under the configured
minimum — because a submit button the server is certain to refuse teaches
people the product is broken.

It closes **T78**: the points-to-currency rate was never invented, it was
already `payouts.points_per_currency_unit` and simply unreachable by the person
it prices. `GET /payouts/options` exposes it, so the amount field can quote
`≈ $12.50 USD` as you type — and when that call fails, the cash line disappears
rather than falling back to a number nobody configured. It also closes the
second half of **T74**.

Phase 7 rebuilds `/offers` and `/offers/[id]`, which §5.8 and §5.9 record as a
bare filter row over an unstyled `<ul>` printing `GAME · mock` under each title.
It is now the responsive card grid of DS §17.1 — 4 / 3 / 2 / 1 columns, coloured
tile, category badge, reward beside its cash equivalent, description and
provider — over a filter bar that is still a plain `GET` form, and a detail page
with a hero tile, badges and a CTA that says where it goes.

**It is the one phase that changed no API at all.** `GET /offers` already took
`category`, `search`, `sort`, `limit` and `offset`; `GET /offers/:id` and
`POST /clicks` already existed and already refused what they should. The whole
stage is presentation over contracts that were built for it.

§5.8's blocking dependency — *"legacy offer tiles are coloured by a per-offer
`color` hex; the current `WallOffer` has none. Decide before building"* — is
resolved the way DS §3.5 anticipated: **derived from the offer id** into
legacy's own observed palette (D87). §5.9's missing affordance is closed too:
the button reads "Start at Mock", not "Start this offer".

One element of §17.1 is deliberately absent. Legacy's card shows a difficulty
badge (`Easy` / `Medium`) and nothing in our catalog knows how hard an offer is.
Inferring it from the reward would be a claim about someone's time with nothing
behind it.

Phase 8 rebuilds `/admin/payouts` and `/admin/payouts/[id]`, and **closes the
product loop**. Every phase before it built one more step of
landing → auth → offers → click → conversion → reward → balance → withdrawal,
and every withdrawal arrived in a queue with no screen to be decided on. There
is one now: a filterable queue, a review page carrying the account context
§11.3 specifies, and the four transitions the state machine permits.

It changed no API. `GET /admin/payouts`, `GET /admin/payouts/:id`, and the
approve / reject / settle / fail endpoints all existed, complete with the
review context, the audit entry on the destination read, and the row lock that
makes two admins clicking Approve safe.

Two things this page does **not** show, both because the contract does not
carry them and both correctly:

- **The payment destination is absent from the queue.** `AdminPayoutSummary`
  has no destination at all (DATABASE.md §3.5) — a list that showed them would
  put every user's bank details in one response and one screenshot. It is on
  the detail view, where reading it writes an audit entry.
- **There is no email or name.** The account column is a short form of the id.
  What a payout review is actually decided on — account age, status, balances,
  conversion and chargeback counts, fraud signals — is all on the detail view.

The admin shell DS §14.4 specifies is still not built, and still deliberately:
a five-group sidebar whose links lead to pages that do not exist is worse than
none (AD1). The holding layout gained one link, to the one screen there is.

Phase 9 adds `/admin/providers` and closes the last two consistency debts.

The provider screen takes the operator's first job out of a terminal: every
phase before it registered the mock provider, enabled it and triggered its
catalog sync with hand-written API calls, and those three *are* "connect a
provider". It lists providers with their switch, their health signal and their
latest sync run's counts, and it distinguishes the three states that look alike
from the outside — disabled (a decision), down (a signal, deliberately not a
switch), and no adapter (a build problem, with the registry's own reason).

Nothing on it names a network. It renders a slug, a display name and a set of
declared capabilities, and would render AdGem and the mock identically — P1
carried through to the pixels.

**T82** is closed by `WallOffer.providerName`, resolved from the registry
snapshot the wall already consults, so a name on every card costs the same
nothing the slug did. **T83** is closed by loading the rate once on the `(app)`
layout: `/dashboard` and `/earnings` gained the cash caption they lacked, and
`/offers` and `/payouts` **dropped** the calls they were each making (D89).

Phase 10 closes the packaging debt, the statement's missing axis, and the last
open operational loop.

**T79** is closed by giving `@gemone/contracts` both module formats (D90). The
workaround it had accumulated across six phases — enum members spelled out as
string literals in five `$lib` modules — is undone rather than documented
further, and three `Object.keys(…) as X[]` casts became `Object.values(THE_ENUM)`
with no cast at all.

**T80** is closed by moving the status derivation into the contract as *data*,
so the API builds its `where` clause from the same rules the browser renders
(D91). `/earnings` gained a second select. What matters is underneath it: the
API filters and counts with one `where`, so the pager's total is the filtered
total — the "1–20 of 28 above a list of four" that T80 refused to ship.

`/admin/fraud` is the last screen in the loop the product already had end to
end everywhere else. A conversion is scored, held, and now decided: the queue
is oldest-first because a held conversion is somebody who earned points and
cannot spend them, each entry carries the score and the rules that produced it,
and there are exactly two buttons because the API accepts exactly two
decisions. There are deliberately **no risk bands** — the threshold that makes
a score meaningful is per-rule configuration, and a High/Medium/Low badge drawn
in a component would be a fraud rule written in a presentation module (D92).

Phase 11 adds the two remaining admin screens and closes the second half of the
oldest infrastructure debt.

`/admin/users` is composed entirely from endpoints that already existed — the
account, its withdrawals, its conversions, its fraud signals and the audit
entries against it, each through the `userId` filter that endpoint already had.
No endpoint was added (D93). Searching by part of an address, which is what a
search box is for, had never worked: the service matched with `contains` and the
DTO validated `@IsEmail`, so only complete addresses passed. Fixed in the API
with a regression test, not worked around in the browser.

`/admin/settings` contains **no list of settings**. It renders whatever
`GET /admin/configuration` says is registered — thirty-seven keys across seven
namespaces — grouped by the namespace each key declares, with the control chosen
by the declared type and the validation left entirely to the key's own schema
(D94). A hand-written form would be a second declaration of keys that are
declared in code, and it would omit the thirty-eighth.

**T81 is fully closed.** D88 isolated the queues in phase 8 and left the
database, on the grounds that no test had failed because of it. The risk was
the other way round: the suite *deletes* from eleven tables, and it was deleting
from the developer's database — three admin accounts in this phase alone. The
suite now derives its own `_test` database, creates and migrates it, and refuses
to run against anything not named that way (D95).

Phase 12 closes the three debts phase 11 left, and the first of them turned out
to be larger than it was filed as.

**T86** was recorded as a 502 for a mistyped payout reference. Reproducing it
through the real route found two `500`s as well, whose cause was that the id was
interpolated into the API path unencoded — so `..%2Fusers` fetched the admin
*user list* into the payout page and crashed rendering it. Fixed with an
`apiPath` tag applied to every route that puts a caller-controlled value in a
path, and a `failedDetailLoad` that keeps invalid / missing / forbidden /
upstream apart instead of collapsing them (D96).

**T88** gives configuration writes a precondition, using the `updatedAt` the
contract already carried. `null` means "I read a key with nothing stored", which
is distinct from omitting the field — and the check runs under a row lock inside
the write's own transaction, because otherwise both writers pass it (D97).

**T87** is implemented rather than deferred: the investigation found every guard
a per-provider editor needs already present and already tested, so the screen
exposes `?scopeId=<provider>` and adds nothing to the API (D98). It surfaced a
miscount — `overrideCount` had been every stored row rather than the
provider-scoped ones the contract documents, so one override plus a global value
read as "2 providers".

Phase 13 closes **T84**, the last figure `/admin/users/[id]` was missing.
`GET /admin/users/:id/balance` returns the accounting service's own answer
unchanged — the same call the payout review context has always made, now
reachable for an account that has never requested a withdrawal. Nothing sums the
conversions on the page into a total: that ignores maturation, chargebacks and
locks, and a number on an admin screen that disagrees with the ledger is worse
than no number, which is why phase 11 shipped without one. The screen shows the
three buckets and never a fourth — `total` exists so nobody adds them up wrongly,
not so an operator can confirm a withdrawal against points still inside a hold
period (D99).

Phase 14 closes **T85**. `/admin/users/[id]` grows a second card in its left
column — the standing and the role are two decisions, and a promotion under a
heading that says "Standing" would read as a variety of suspension. One button,
because there are two roles and the account holds one of them, styled
destructive only in the direction that removes access, and carrying the sentence
a demotion most needs: it is not a suspension, and the account's sessions and
points are untouched. On the administrator's own account the card explains
instead of offering a control, the pattern the standing card already used —
and the API remains the control (D100).

Phase 15 closes **T89** and changes nothing on the screen, which is the result
worth recording. The status card already renders the API's own message beside the
form it came from, so a refusal an operator had never seen before — *"that would
leave the platform with no administrator who can sign in"* — explains itself with
no rule restated in the browser. That is the property D93 set for this screen,
tested here by a refusal it was never written for (D101).

Departures from what this audit and DESIGN_SYSTEM.md record are deliberate and
are logged as [DECISIONS.md](DECISIONS.md) D79–D101.
