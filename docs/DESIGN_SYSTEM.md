# GemOne Design System — extracted from the `legacy` branch

> **Purpose.** The `legacy` branch (`e9215139`, Next.js) carries the GemOne visual
> identity we are keeping. The current `main` branch carries the architecture we
> are keeping. This file plus the 42 screenshots in `docs/design/legacy/` are the
> working design reference, so nobody has to check out another branch to rebuild
> a screen. Everything here was read out of the legacy implementation or measured
> from it running.
>
> **`legacy` is kept permanently** as a historical reference branch. It is not to
> be deleted, rewritten or archived. This document does not replace it — it makes
> consulting it optional.
>
> **Two design targets, both first-class.** The **public landing page** (§18) and
> the **authenticated application** (§11–§17, §19). They share a token system but
> not their layouts: the landing page uses full-bleed tinted bands, a top nav and
> a phone mockup; the app uses a fixed sidebar over a `slate-50` field. Neither
> can be derived from the other.
>
> **How to read it.** Every value here is either **VERIFIED** — copied from legacy
> source or measured from its compiled CSS / a rendered screenshot — or marked
> **INFERRED**, which means it is a judgement about intent rather than a fact in
> the code. There are only a handful of the latter and each is labelled inline.
> Nothing is written from general design knowledge.
>
> **The rebuilt system lives in [UI_KIT.md](UI_KIT.md).** This file stays a
> record of what `legacy` did and is not edited to match the rebuild. Read
> UI_KIT.md to write a screen; read this one to find out what a value was and
> where it came from. The two places the implementation deliberately departs
> from what is recorded here — the focus treatment and the label markup — are in
> [DECISIONS.md](DECISIONS.md) D80.
>
> **What this is not.** It is not an instruction to port the legacy *code*. The
> legacy app is Next.js + React; the current app is SvelteKit. What transfers is
> the visual language: colours, shape, weight, spacing, and the specific
> component recipes below.

---

## 0. Provenance — how these values were obtained

| Method | What it produced |
|---|---|
| `git show origin/legacy:apps/web/…` on all 31 pages + 24 components | Every class string quoted in this file |
| Ran the legacy app: `pnpm install` + `next dev` on an extracted copy | A live server on `:4300` |
| Downloaded the **compiled Tailwind v4 bundle** it served | Resolved hex values, rem sizes, shadow definitions, breakpoints |
| Rendered a throwaway page listing every utility the app uses, then re-read the bundle | Exact values for utilities the public pages don't emit (`shadow-md`, `rounded-xl`, …) |
| Headless Chromium screenshots at 1440/1600/768/390 px | **42 captures** — every page, plus per-section slices of the landing page at desktop and mobile (§0.1) |

The authenticated pages fetch from a NestJS API that is not in this repository.
To render them, a **stub API** returned the shapes `apps/web/lib/*.ts` declare, and
a small proxy injected the session cookie. No legacy file was modified to do
this. This matters for one thing only: the **recharts charts render blank in the
screenshots** (they need client hydration and a measured container). Their
configuration in §20 is therefore read from source, not from a picture.

All fixture data in the screenshots is invented for rendering — "Ashley Morgan",
`ashley@example.com`, `GEM-A7X2Q`, the balances and the payout rows are
placeholders. **No real credential, token, cookie, session or personal datum
appears in any image or anywhere in this document.**

---

## 0.1 Screenshot index

42 captures live under `docs/design/legacy/`. Paths below are repository-relative
to `docs/`, so the links resolve from this file.

### Landing — public / marketing (20)

| File | View |
|---|---|
| [landing/01-full-page-desktop-1440.png](design/legacy/landing/01-full-page-desktop-1440.png) | Whole page, 1440×4000 |
| [landing/02-hero-fold-desktop-1440.png](design/legacy/landing/02-hero-fold-desktop-1440.png) | Above the fold, 1440×900 |
| [landing/03-navbar-and-hero-desktop-1440.png](design/legacy/landing/03-navbar-and-hero-desktop-1440.png) | Navbar + hero |
| [landing/04-partners-strip-desktop-1440.png](design/legacy/landing/04-partners-strip-desktop-1440.png) | Partners strip |
| [landing/05-features-row-desktop-1440.png](design/legacy/landing/05-features-row-desktop-1440.png) | Five feature cards |
| [landing/06-how-it-works-desktop-1440.png](design/legacy/landing/06-how-it-works-desktop-1440.png) | Three numbered steps |
| [landing/07-ways-to-earn-desktop-1440.png](design/legacy/landing/07-ways-to-earn-desktop-1440.png) | Six tinted tiles |
| [landing/08-testimonials-desktop-1440.png](design/legacy/landing/08-testimonials-desktop-1440.png) | Social proof cards |
| [landing/09-stats-bar-desktop-1440.png](design/legacy/landing/09-stats-bar-desktop-1440.png) | Dark gradient stats slab |
| [landing/10-cta-banner-desktop-1440.png](design/legacy/landing/10-cta-banner-desktop-1440.png) | Closing CTA |
| [landing/11-footer-desktop-1440.png](design/legacy/landing/11-footer-desktop-1440.png) | Five-column footer |
| [landing/12-full-page-tablet-768.png](design/legacy/landing/12-full-page-tablet-768.png) | Whole page at `md` |
| [landing/13-full-page-mobile-390.png](design/legacy/landing/13-full-page-mobile-390.png) | Whole page at 390 |
| [landing/14-hero-mobile-390.png](design/legacy/landing/14-hero-mobile-390.png) | Mobile header + hero |
| [landing/15-partners-features-mobile-390.png](design/legacy/landing/15-partners-features-mobile-390.png) | Mobile partners + features |
| [landing/16-how-it-works-mobile-390.png](design/legacy/landing/16-how-it-works-mobile-390.png) | Mobile steps, stacked |
| [landing/17-ways-to-earn-mobile-390.png](design/legacy/landing/17-ways-to-earn-mobile-390.png) | Mobile tiles |
| [landing/18-testimonials-mobile-390.png](design/legacy/landing/18-testimonials-mobile-390.png) | Mobile testimonials |
| [landing/19-stats-cta-footer-mobile-390.png](design/legacy/landing/19-stats-cta-footer-mobile-390.png) | Mobile stats + CTA + footer |
| [landing/20-upper-page-mobile-390.png](design/legacy/landing/20-upper-page-mobile-390.png) | Upper page at 390 (superseded by 13, kept as the original capture) |

### Auth and legal — public (5)

| File | View |
|---|---|
| [auth/01-login-desktop-1440.png](design/legacy/auth/01-login-desktop-1440.png) | Login card |
| [auth/02-signup-with-referral-desktop-1440.png](design/legacy/auth/02-signup-with-referral-desktop-1440.png) | Signup with `?ref=` banner |
| [auth/03-login-mobile-390.png](design/legacy/auth/03-login-mobile-390.png) | Login at 390 |
| [auth/04-signup-with-referral-mobile-390.png](design/legacy/auth/04-signup-with-referral-mobile-390.png) | Signup at 390 |
| [auth/05-legal-terms-desktop-1440.png](design/legacy/auth/05-legal-terms-desktop-1440.png) | Legal page frame |

### Authenticated app (13)

| File | View |
|---|---|
| [app/01-dashboard-desktop-1600.png](design/legacy/app/01-dashboard-desktop-1600.png) | Dashboard — sidebar, topbar, stat row, offer rail |
| [app/02-dashboard-mobile-390.png](design/legacy/app/02-dashboard-mobile-390.png) | Dashboard at 390 (**no navigation** — §22.3) |
| [app/03-wallet-desktop-1600.png](design/legacy/app/03-wallet-desktop-1600.png) | Tinted stat cards + ledger table |
| [app/04-transactions-desktop-1600.png](design/legacy/app/04-transactions-desktop-1600.png) | Full ledger table |
| [app/05-withdraw-desktop-1600.png](design/legacy/app/05-withdraw-desktop-1600.png) | Form + history split |
| [app/06-offerwalls-desktop-1600.png](design/legacy/app/06-offerwalls-desktop-1600.png) | Provider cards |
| [app/07-earn-offerwall-embed-desktop-1600.png](design/legacy/app/07-earn-offerwall-embed-desktop-1600.png) | Embedded wall / setup card |
| [app/08-surveys-offer-grid-desktop-1600.png](design/legacy/app/08-surveys-offer-grid-desktop-1600.png) | Offer card grid |
| [app/09-referrals-desktop-1600.png](design/legacy/app/09-referrals-desktop-1600.png) | Gradient hero + stats |
| [app/10-achievements-desktop-1600.png](design/legacy/app/10-achievements-desktop-1600.png) | Locked/unlocked badge grid |
| [app/11-daily-bonus-desktop-1600.png](design/legacy/app/11-daily-bonus-desktop-1600.png) | Streak strip + 7-day grid |
| [app/12-notifications-desktop-1600.png](design/legacy/app/12-notifications-desktop-1600.png) | Divided list rows |
| [app/13-settings-desktop-1600.png](design/legacy/app/13-settings-desktop-1600.png) | Two form cards |

### Admin (4)

| File | View |
|---|---|
| [admin/01-dashboard-desktop-1600.png](design/legacy/admin/01-dashboard-desktop-1600.png) | Grouped sidebar, metric cards, 12-col rows, KPI strip |
| [admin/02-users-desktop-1600.png](design/legacy/admin/02-users-desktop-1600.png) | Search + user table + row actions |
| [admin/03-withdrawals-desktop-1600.png](design/legacy/admin/03-withdrawals-desktop-1600.png) | Approve / Reject queue |
| [admin/04-fraud-desktop-1600.png](design/legacy/admin/04-fraud-desktop-1600.png) | Flagged accounts + signals |

Charts appear blank in `admin/01` — see §0 and §25.

---

## 1. Design philosophy / visual identity

Six properties define the look. They are stated as measurements, because that is
how they are reproducible.

1. **White page, one green.** The app is white and light-grey with a single
   saturated emerald accent. There is no secondary brand colour. Every other hue
   in the UI is *semantic* (status, category) and appears only as a pale tint
   behind small text.
2. **Rounded, approaching soft.** `rounded-2xl` (16px) is the card radius and is
   used **50 times**; `rounded-full` **41 times** for buttons, avatars and icon
   buttons. Nothing in the app has a square corner by choice.
3. **Hairline borders, almost no shadow.** Cards are separated by a
   `border-slate-100` (#f1f5f9) hairline plus `shadow-sm`. `shadow-sm` is used
   **49 times**; `shadow-md` **2**, `shadow-lg` **1**, `shadow-2xl` **1**. The
   surface reads flat.
4. **Small text, heavy weights.** `text-sm` (124 uses) and `text-xs` (76) carry
   almost all body copy, while numbers and headings jump to `font-bold` /
   `font-extrabold`. The contrast is weight and size, not colour.
5. **Emoji as illustration.** There is no icon illustration set and no image
   assets beyond the SVG logo. Emoji (💎 🎁 🎮 📋 🏆 👣) fill every decorative
   slot, usually inside a tinted rounded square.
6. **Light only.** `grep -rn "dark:"` over the entire legacy web app returns
   **0 matches**. There is no dark theme, no `prefers-color-scheme` handling, and
   no theme toggle.

**Tone (INFERRED, from copy + shape):** consumer-friendly and rewarding rather
than corporate — first-name greetings ("Ashley! 👋"), streaks, badges, levels,
"You're on fire! 🔥". The admin area is the same system with the playfulness
turned down: smaller headings, denser rows, no emoji in structure.

---

## 2. Technology and conventions

**VERIFIED** from `apps/web/package.json`, `postcss.config.mjs`, `app/globals.css`.

| Concern | Choice |
|---|---|
| CSS framework | **Tailwind CSS v4** via `@tailwindcss/postcss` — no `tailwind.config.js`; configuration lives in CSS |
| Framework | Next.js `16.2.10`, React `19.2.4`, App Router, server components by default |
| Icons | **`lucide-react` ^1.24.0** |
| Charts | **`recharts` ^3.9.2** |
| Font | **`geist` ^1.7.2** — `GeistSans` loaded through `next/font` |
| Component library | **None.** No shadcn/ui, no Radix, no Headless UI, no MUI |
| Styling convention | Utility classes written inline in JSX. No CSS modules, no `styled-components`, no `cva`/`clsx` |

### 2.1 The whole stylesheet

`app/globals.css` is 34 lines. This is its complete non-`@theme` content — there
are exactly three custom rules in the entire application:

```css
@import "tailwindcss";

html { -webkit-font-smoothing: antialiased; }

body {
  background: #ffffff;
  color: #0f172a;
}

/* hide scrollbars on horizontal offer rails */
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
```

Note `body` sets `#0f172a` literally, while Tailwind v4's `slate-900` resolves to
`#0f172b`. A one-digit difference, present in legacy, invisible in practice.

### 2.2 Repeating a class string

Legacy repeats utility strings by hand rather than extracting them. There is
**one** exception in the entire codebase — `components/dashboard/SettingsForms.tsx`:

```ts
const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400";
```

**Recommendation when rebuilding (INFERRED):** the recipes in §9–§13 are stable
enough to become real components. Extracting them changes no pixels.

---

## 3. Color palette

### 3.1 Brand — the only custom scale

Declared in `app/globals.css` inside `@theme`. This overrides Tailwind's
`brand-*` namespace and is the **one** design token legacy defines itself. The
comment in the file reads: *"GemOne brand green — emerald, matching the design
tokens (#059669 primary)"*.

| Token | Hex | Where it is actually used |
|---|---|---|
| `brand-50` | `#ecfdf5` | Active nav item background, badge `green`, daily-bonus card, referral card, achievement tiles, CTA banner |
| `brand-100` | `#d1fae5` | Focus ring (`focus:ring-brand-100`), card borders on unlocked achievements, hero prop tile |
| `brand-200` | `#a7f3d0` | Hover border on offer cards (`hover:border-brand-200`) |
| `brand-300` | `#6ee7b7` | Decorative sparkle `✦`, "how it works" arrow |
| `brand-400` | `#34d399` | **Input focus border** (`focus:border-brand-400`), decorative sparkle |
| `brand-500` | `#10b981` | **Primary button fill**, progress bars, hero headline accent, feature icon tiles, notification dot |
| `brand-600` | `#059669` | **Primary button hover**, link text, positive amounts, balance figure |
| `brand-700` | `#047857` | Text on `brand-50` chips, gradient end, referral hero end |
| `brand-800` | `#065f46` | Landing stats bar gradient start |
| `brand-900` | `#064e3b` | Declared, **not used in any component** |
| `brand-950` | `#022c22` | Landing stats bar gradient end |

Verbatim from `globals.css`:

```css
@theme {
  --color-brand-50:  #ecfdf5;
  --color-brand-100: #d1fae5;
  --color-brand-200: #a7f3d0;
  --color-brand-300: #6ee7b7;
  --color-brand-400: #34d399;
  --color-brand-500: #10b981;
  --color-brand-600: #059669;
  --color-brand-700: #047857;
  --color-brand-800: #065f46;
  --color-brand-900: #064e3b;
  --color-brand-950: #022c22;
}
```

> **Important — the brand scale is Tailwind v3's `emerald`, not v4's.** Legacy
> hard-codes these hexes, so they are stable regardless of Tailwind version.
> Tailwind v4's *own* `emerald-500` resolves to `#00bb7f`, a visibly different
> green. Reproduce the table above literally; do not substitute `emerald-*`.

### 3.2 Neutrals — Tailwind v4 `slate`

**VERIFIED** by reading the compiled bundle the running app served. These are v4
values and differ slightly from v3.

| Token | Hex | Role in legacy |
|---|---|---|
| `slate-50` | `#f8fafc` | **App background** behind sidebar layouts; nav hover; "how it works" tiles |
| `slate-100` | `#f1f5f9` | **The hairline border colour on every card**; dividers; icon-button hover; progress track |
| `slate-200` | `#e2e8f0` | Input borders; secondary button border; avatar circles |
| `slate-300` | `#cad5e2` | Partner logos on the landing page (deliberately faint) |
| `slate-400` | `#90a1b9` | Tertiary text: units, timestamps, captions, table headers, icons at rest |
| `slate-500` | `#62748e` | Secondary text: subtitles, labels, inactive nav |
| `slate-600` | `#45556c` | Body copy in testimonials and table cells |
| `slate-700` | `#314158` | Form field labels; secondary button text |
| `slate-800` | `#1d293d` | Nav hover text; table name cells |
| `slate-900` | `#0f172b` | **All headings and primary numbers**; dark chips ("Play"/"App"); phone-mockup frame |

### 3.3 Semantic colours

Used as **`-50` background + `-600`/`-700` text** pairs for badges, and as
`-50` tint + `-600` icon for stat cards. Values are Tailwind v4, measured.

| Family | `-50` | `-100` | `-500` | `-600` | `-700` | Meaning in legacy |
|---|---|---|---|---|---|---|
| amber | `#fffbeb` | `#fef3c6` | `#f99c00` | `#dd7400` | `#b75000` | Pending, Medium difficulty, Survey category, warnings, "setup needed" |
| blue | `#eff6ff` | `#dbeafe` | `#3080ff` | `#155dfc` | `#1447e6` | Today's earnings, Sign-Up category, Withdrawal/Approved/Processing |
| purple | `#faf5ff` | `#f3e8ff` | `#ac4bff` | `#9810fa` | `#8200da` | Level/XP card, Game category, Bonus ledger type, Total paid |
| red | `#fef2f2` | `#ffe2e2` | `#fb2c36` | `#e40014` | — | Errors, Hard difficulty, Rejected/Failed, reversals, fraud |
| emerald | `#ecfdf5` | `#d0fae5` | `#00bb7f` | — | `#007956` | Badge tone `emerald`, app-install activity |
| indigo | `#eef2ff` | `#e0e7ff` | — | `#4f39f6` | `#432dd7` | Video category |
| pink | `#fdf2f8` | `#fce7f3` | — | `#e30076` | `#c4005c` | Shopping category |
| orange | `#fff7ed` | — | — | `#f05100` | — | Declared in the badge palette, **never used** |

Additional `slate-200`/`amber-200`/`amber-300`/`blue-400`/`purple-400`/`red-200`
appear in single spots (avatars, hero props, destructive button borders).

### 3.4 Fixed brand-of-others hexes

Hard-coded, not tokens — `lib/admin.ts` and `components/landing/Hero.tsx`:

```
paypal      #003087      amazon      #ff9900
visa        #1a1f71      googleplay  #00a672
```

### 3.5 Offer tile colours

Every offer carries its own `color` hex **from the provider API** (legacy
`provider.types.ts`: `color: string; // hex for the tile`) and a one-character
`icon`. The tile is a solid block of that colour with the letter in white bold.
Observed values from the legacy adapters:

```
#b91c1c  RAID: Shadow Legends      #dc2626  MONOPOLY GO!
#4f46e5  Sofi: Bank & Invest       #111827  TikTok
#059669  Quick Survey              #f59e0b  Coin Master
#10b981  Yuno Surveys              #00d54b  Cash App
```

**This is a real constraint on the rebuild:** the offer card design assumes a
per-offer colour exists. If the current API does not supply one, a deterministic
colour must be derived (e.g. hash of the offer id into a fixed palette), or the
tiles all collapse to one colour and the wall loses its texture.

### 3.6 The logo's own greens

`components/ui/Logo.tsx` — a hand-written SVG gem, three flat facets, **not**
brand tokens:

```
#039855  body        #12b76a  right facet        #32d583  top facet (85% opacity)
```

`#12b76a` also appears as the "earnings" series colour in the admin charts.

---

## 4. Typography

### 4.1 Family

```css
--font-sans:    var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
--font-display: var(--font-geist-sans), ui-sans-serif, sans-serif;
```

Both resolve to **Geist Sans** (`next/font` emits `"GeistSans", "GeistSans Fallback"`).
`font-display` and `font-sans` are therefore the *same typeface* — `font-display`
marks intent, not a second font. Applied at the root:

```tsx
<html lang="en" className={`${GeistSans.variable} h-full`}>
  <body className="min-h-full font-sans antialiased text-slate-900">
```

`font-display` is applied to: the landing H1, all section H2s, page `<h1>`s in the
dashboard and admin, the auth card title, legal page titles, and the landing
stats figures.

### 4.2 Scale — measured from the compiled bundle

| Class | Size | Line height | Used for |
|---|---|---|---|
| `text-[10px]` | 10px | — | Store-badge chips, "Unlocked/Locked", uppercase micro-labels |
| `text-[11px]` | 11px | — | Sidebar group titles, nav count badges, "Live" pill |
| `text-xs` | `0.75rem` (12px) | `1rem` | Captions, timestamps, table headers, unit labels, badge text |
| `text-sm` | `0.875rem` (14px) | `1.25rem` | **Default body size** — nav, table cells, buttons, form fields |
| `text-base` | `1rem` | `1.5rem` | Used once (an activity emoji) |
| `text-lg` | `1.125rem` (18px) | `1.75rem` | Card section headings, partner logos |
| `text-xl` | `1.25rem` (20px) | `1.75rem` | Admin metric values, referral hero heading, logo wordmark |
| `text-2xl` | `1.5rem` (24px) | `2rem` | Auth card title, admin page `<h1>`, CTA banner heading, donut centre |
| `text-3xl` | `1.875rem` (30px) | `2.25rem` | **Stat card numbers**, dashboard page `<h1>`, landing section H2s |
| `text-4xl` | `2.25rem` (36px) | `2.5rem` | Legal page titles, decorative emoji |
| `text-5xl` | `3rem` | `1` | Landing H1 (mobile), "how it works" emoji |
| `text-6xl` | `3.75rem` | `1` | Landing H1 (≥`sm`), CTA banner emoji |

### 4.3 Weights

Only four are used. Frequency across all pages and components:

| Class | Value | Count | Applied to |
|---|---|---|---|
| `font-medium` | 500 | 84 | Nav items, labels, secondary emphasis, table headers |
| `font-bold` | 700 | 76 | Card headings, stat numbers, names, logo |
| `font-semibold` | 600 | 54 | Buttons, links, "View all" actions, badges |
| `font-extrabold` | 800 | 7 | Page `<h1>` in the dashboard, landing H1, landing stat figures |

There is **no `font-normal`, no `font-light`, no `font-black`** anywhere.

### 4.4 Tracking and leading

| Class | Value | Where |
|---|---|---|
| `tracking-tight` | `-0.025em` | Landing H1, logo wordmark |
| `tracking-wide` | `0.025em` | `text-[10px]` uppercase micro-labels in the referral card |
| `tracking-wider` | `0.05em` | Admin sidebar group titles |
| `leading-[1.05]` | 1.05 | Landing H1 only |
| `leading-relaxed` | 1.625 | Legal page body |

### 4.5 The heading recipes, verbatim

```
Landing H1     font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl
Landing H2     font-display text-3xl font-bold text-slate-900
App page H1    font-display text-3xl font-extrabold text-slate-900
Admin page H1  font-display text-2xl font-bold text-slate-900
Card heading   text-lg font-bold text-slate-900        (larger cards)
Card heading   font-bold text-slate-900                 (rail/admin cards, inherits text-base)
Page subtitle  mt-1 text-slate-500       /  admin: mt-1 text-sm text-slate-500
```

---

## 5. Spacing system

Tailwind v4's base unit: `--spacing: 0.25rem` (4px). `p-5` = 1.25rem = 20px.

### 5.1 The values legacy actually uses

| Step | rem / px | Typical role |
|---|---|---|
| `1` | 0.25 / 4 | Icon-to-text gaps in tight chips |
| `1.5` | 0.375 / 6 | Small button vertical padding (`py-1.5`) |
| `2` | 0.5 / 8 | Badge/chip gaps, `px-2` on badges |
| `2.5` | 0.625 / 10 | **Standard button vertical padding** (`py-2.5`), nav item `py-2.5` |
| `3` | 0.75 / 12 | Input padding, table cell `py-3`, list-row gaps |
| `4` | 1 / 16 | **Grid gutter** (`gap-4`), section spacing inside cards |
| `5` | 1.25 / 20 | **Card padding** (18 of 33 cards), **block spacing** (`space-y-5`, `gap-5`) |
| `6` | 1.5 / 24 | Larger card padding (11 cards), page horizontal padding at `sm` |
| `8` | 2 / 32 | Page horizontal padding at `lg`, auth card padding, landing inner padding |
| `10` | 2.5 / 40 | Landing section gaps, footer top spacing |

### 5.2 The two rhythms

Legacy uses **two** gutters and holds them consistently:

- **`gap-4`** — between cards inside a *stat row* (`grid gap-4 sm:grid-cols-2 xl:grid-cols-5`)
- **`gap-5` / `space-y-5`** — between *major blocks* of a page

### 5.3 Page-level padding

```
Dashboard/app content column   px-4 sm:px-6 lg:px-8
Admin content column           px-6 pb-10          (no responsive step — admin is desktop-first)
Landing sections               mx-auto max-w-6xl px-6
Legal pages                    mx-auto max-w-3xl px-6 py-16
```

Every dashboard page ends with a literal `<div className="h-8" />` as bottom
spacing — a legacy quirk worth reproducing as real padding instead.

### 5.4 Containers

| Class | Value | Used by |
|---|---|---|
| `max-w-6xl` | `72rem` (1152px) | Every landing section, footer |
| `max-w-3xl` | `48rem` (768px) | Legal pages |
| `max-w-md` | `28rem` | Admin search field |
| `max-w-sm` | `24rem` | **Auth card**, hero phone column |
| `max-w-xs` | `20rem` | Footer blurb |

---

## 6. Border radius

Measured from the compiled bundle.

| Class | Value | Count | What it shapes |
|---|---|---|---|
| `rounded-sm` | `0.25rem` (4px) | 1 | Payment-method colour swatch in the admin table |
| `rounded-md` | `0.375rem` (6px) | 2 | **Badges**, referral copy button |
| `rounded-lg` | `0.5rem` (8px) | 27 | **Inputs and selects**, small rectangular buttons, inline notices, store chips |
| `rounded-xl` | `0.75rem` (12px) | 18 | Offer tile image blocks, activity icon squares, inner tiles, day cards |
| `rounded-2xl` | `1rem` (16px) | **50** | **Every card.** Also the auth card, achievement tiles, sidebar promo |
| `rounded-3xl` | `1.5rem` (24px) | 2 | Landing stats bar, CTA banner |
| `rounded-full` | pill | 41 | **Buttons**, avatars, icon buttons, progress bars, badges on nav, status pills |
| `rounded-[2.5rem]` | 40px | 1 | Hero phone mockup frame |

**The rule that reproduces the identity:** container = `rounded-2xl`, control =
`rounded-full`, field = `rounded-lg`, inner block = `rounded-xl`, badge =
`rounded-md`.

---

## 7. Borders

| Pattern | Class | Where |
|---|---|---|
| **Card edge** | `border border-slate-100` | Every card — this is the signature |
| **Field edge** | `border border-slate-200` | Inputs, selects, secondary buttons |
| Section rule | `border-b border-slate-100` / `border-t border-slate-100` | Navbar, admin topbar, footer, testimonial footers |
| Table row rule | `divide-y divide-slate-50` | **All tables** — lighter than the card border |
| Sidebar edge | `border-r border-slate-100` | Both sidebars |
| Sidebar group rule | `<hr className="my-3 border-slate-100" />` | User sidebar, between nav groups |
| Empty state | `border border-dashed border-slate-200` | `OffersGrid` empty state |
| Hover accent | `hover:border-brand-200` | Offer cards, offerwall cards |
| Destructive | `border border-red-200` | Suspend / Reject buttons |
| Warning panel | `border border-amber-200` | AdGem "not configured" card |
| Avatar ring | `border-2 border-white` | Overlapping hero avatars |
| Focus | `focus:border-brand-400` + `focus:ring-2 focus:ring-brand-100` | All inputs |

All borders are **1px** except the avatar ring (2px) and the phone mockup
(`border-[10px] border-slate-900`).

---

## 8. Shadows

Measured from the compiled bundle — the literal `--tw-shadow` values:

```css
shadow-sm   0 1px 3px 0 #0000001a, 0 1px 2px -1px #0000001a
shadow-md   0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a
shadow-lg   0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a
shadow-2xl  0 25px 50px -12px #00000040
```

Usage is deliberately lopsided — **49 × `shadow-sm`**, 2 × `shadow-md`,
1 × `shadow-lg`, 1 × `shadow-2xl`:

- `shadow-sm` — every card, every primary button, achievement tiles, "ways to earn" tiles
- `shadow-md` — **hover only**, on offer cards and offerwall cards (`hover:shadow-md`)
- `shadow-lg` — hero floating props
- `shadow-2xl` — hero phone mockup

There is no `shadow-xl` and no coloured shadow anywhere.

---

## 9. Buttons

Five recipes. These are the exact strings from legacy.

### 9.1 Primary — pill, brand-500, white

```
rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-60
```

Size variants observed:

| Context | Padding | Text |
|---|---|---|
| Navbar "Sign up" | `px-5 py-2` | `text-sm` |
| Standard action (Withdraw, Save, Claim) | `px-5 py-2.5` | `text-sm` |
| Hero CTA | `px-6 py-3` | inherits `text-base` |
| CTA banner | `px-7 py-3` | inherits |
| Full-width form submit | `w-full … py-2.5` | `text-sm` |

Disabled: `disabled:opacity-60`, and `disabled:cursor-not-allowed` on the daily
bonus button only.

### 9.2 Secondary — pill, white, slate border

```
rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50
```

### 9.3 Small rectangular — table row actions

```
rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60
```
Search submit uses `px-4 py-2 text-sm`.

### 9.4 Destructive — outlined red, never filled

```
rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-60
```

**No destructive action in legacy is a solid red button.** Suspend and Reject are
both pale red on a red hairline.

### 9.5 Neutral control — admin toolbar

```
inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600
```
Carries a `ChevronDown` at 4×4 in `text-slate-400`.

### 9.6 Icon button — circular

```
grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100
```
Icon inside at `h-5 w-5`. No border, no background at rest.

### 9.7 Pending-state labels

Buttons swap their label while submitting rather than showing a spinner. There is
**no spinner component in legacy.** Observed strings: `"Please wait…"`,
`"Claiming…"`, `"Saving…"`, `"Updating…"`, `"Requesting…"`.

---

## 10. Inputs and forms

### 10.1 The field

```
w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition
focus:border-brand-400 focus:ring-2 focus:ring-brand-100
```
Disabled adds `disabled:bg-slate-50 disabled:text-slate-400`.

The focus treatment is the identity detail: **the border turns `brand-400`
(#34d399) and a 2px `brand-100` (#d1fae5) ring appears outside it.** No blue
browser outline survives (`outline-none`).

### 10.2 Label

Labels wrap their input; the text is a `<span>`, not a `for=` attribute:

```tsx
<label className="block">
  <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
  <input … />
</label>
```

Helper text sits below: `mt-1 block text-xs text-slate-400`.

### 10.3 Inline notices

Same shape, two colours — these are the only "alert" components in legacy:

```
error    rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600
success  rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700
```

### 10.4 Search field with shortcut hint (admin topbar)

```
w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-12 text-sm outline-none focus:border-brand-400
```
`Search` icon absolutely positioned `left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400`;
a `⌘K` chip at `right-3`, `rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-400`.

Note this field is `bg-slate-50` — the *only* filled input in the app.

---

## 11. Cards

Seen in [app/01-dashboard](design/legacy/app/01-dashboard-desktop-1600.png),
[app/03-wallet](design/legacy/app/03-wallet-desktop-1600.png) and
[landing/05-features-row](design/legacy/landing/05-features-row-desktop-1440.png).

### 11.1 The standard card — used 30 times verbatim

```
rounded-2xl border border-slate-100 bg-white p-5 shadow-sm
```

`p-6` for form cards and the wallet activity card; `p-4` for compact offer cards;
`p-8` for the auth card; `p-2` for the notification list (rows supply their own
padding); `p-12` for the empty state.

### 11.2 Stat card (dashboard)

Label top-left, tinted circular icon top-right, big number, unit, coloured
sub-line:

```tsx
<div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
  <div className="flex items-start justify-between">
    <p className="text-sm font-medium text-slate-500">{label}</p>
    <span className="grid h-9 w-9 place-items-center rounded-full {tint} {accent}">
      <Icon className="h-5 w-5" />
    </span>
  </div>
  <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
  <p className="text-xs text-slate-400">{unit}</p>
  <p className="mt-2 text-xs font-medium {accent}">{sub}</p>
</div>
```

The four dashboard tint/accent pairs, verbatim:

| Card | tint | accent |
|---|---|---|
| Current Balance | `bg-brand-50` | `text-brand-600` |
| Today's Earnings | `bg-blue-50` | `text-blue-600` |
| Pending Rewards | `bg-amber-50` | `text-amber-600` |
| Completed Offers | `bg-purple-50` | `text-purple-600` |

### 11.3 Tinted stat card (wallet)

A variant where the **whole card** is tinted and there is no icon:

```
rounded-2xl border border-slate-100 p-5 shadow-sm {tint}
```
with `bg-brand-50` / `bg-amber-50` / `bg-blue-50` / `bg-purple-50` for
Available / Pending / Total earned / Total withdrawn.

### 11.4 Level card — the only gradient card in the dashboard

```
rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-white p-5 shadow-sm
```
Contains `Level {n}` in `text-lg font-bold`, the rank in `text-sm font-semibold
text-purple-600`, a 💎 at `text-3xl`, and an XP bar:

```
track  h-2 rounded-full bg-purple-100
fill   h-2 rounded-full bg-purple-500   (inline style width: N%)
```

### 11.5 Accent cards without a border

Two cards drop the border and lean on the tint:

```
Daily bonus   rounded-2xl border border-brand-100 bg-brand-50 p-5
Referral      rounded-2xl bg-brand-50 p-5                        (no border at all)
```

### 11.6 Gradient hero card (referrals page)

```
rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-6 text-white shadow-sm
```
Inside it, translucent surfaces: `bg-white/15` for the code field and secondary
button, solid `bg-white` with `text-brand-700` for the primary. The same gradient
appears in the hero phone's balance panel.

### 11.7 Card header row

```tsx
<div className="flex items-center justify-between">
  <h2 className="text-lg font-bold text-slate-900">{title}</h2>
  <a className="text-sm font-semibold text-brand-600">View all offers</a>
</div>
<p className="text-sm text-slate-500">{subtitle}</p>
```
Rail cards use the smaller pair: `font-bold text-slate-900` + `text-xs font-semibold text-brand-600`.

Bottom links are `mt-3 inline-block text-sm font-semibold text-brand-600` and end
with a literal `→` character, not an icon.

---

## 12. Tables

Seen in [app/04-transactions](design/legacy/app/04-transactions-desktop-1600.png),
[admin/02-users](design/legacy/admin/02-users-desktop-1600.png) and
[admin/03-withdrawals](design/legacy/admin/03-withdrawals-desktop-1600.png).

One recipe, used on wallet, transactions, withdrawals, admin users, admin
withdrawals, admin recent-withdrawals and offer performance.

```tsx
<div className="overflow-x-auto">
  <table className="w-full text-sm">
    <thead>
      <tr className="text-left text-xs font-medium text-slate-400">
        <th className="pb-3 font-medium">Type</th>
        …
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-50">
      <tr>
        <td className="py-3">…</td>
      </tr>
    </tbody>
  </table>
</div>
```

Fixed properties:

- **No header background, no header border** — only `text-slate-400` at `text-xs`
- **No vertical rules, no zebra striping, no row hover**
- Row separator is `divide-slate-50` (#f8fafc), *lighter* than the card border
- Cell padding is vertical only: `pb-3` on headers, `py-3` on cells
- Numeric columns: `text-right`, and `font-semibold text-slate-900`
- Signed amounts: `text-brand-600` when `>= 0`, `text-red-500` when negative, with an explicit `+` prefix
- Dates: `whitespace-nowrap text-slate-400`
- Secondary text in a cell sits under the primary as `text-xs text-slate-400`
- Always wrapped in `overflow-x-auto`, inside a standard card

**Empty state:** `py-8 text-center text-sm text-slate-400` — plain sentence, no
illustration.

---

## 13. Badges and status indicators

Seen in [app/03-wallet](design/legacy/app/03-wallet-desktop-1600.png) (ledger types),
[app/08-surveys](design/legacy/app/08-surveys-offer-grid-desktop-1600.png) (difficulty + category) and
[admin/03-withdrawals](design/legacy/admin/03-withdrawals-desktop-1600.png) (payout status).

### 13.1 The Badge component — legacy's only real UI primitive

`components/ui/Badge.tsx`, complete:

```tsx
const tones = {
  green:   "bg-brand-50 text-brand-700",
  emerald: "bg-emerald-50 text-emerald-700",
  amber:   "bg-amber-50 text-amber-600",
  blue:    "bg-blue-50 text-blue-600",
  indigo:  "bg-indigo-50 text-indigo-600",
  purple:  "bg-purple-50 text-purple-600",
  red:     "bg-red-50 text-red-600",
  slate:   "bg-slate-100 text-slate-600",
  orange:  "bg-orange-50 text-orange-600",
  pink:    "bg-pink-50 text-pink-600",
};

<span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium {tone}" />
```

Shape: **`rounded-md` (6px), `px-2 py-0.5`, `text-xs font-medium`.** Note badges
are the *least* round thing in the UI — a deliberate contrast against the pills.
Default tone is `slate`. `orange` is defined but never used.

### 13.2 The tone maps — reproduce these exactly

**Offer difficulty**
```
Easy → green      Medium → amber      Hard → red
```

**Offer category**
```
game → purple    survey → amber    app → slate
signup → blue    shopping → pink   video → indigo
```
Labels: `Game`, `Survey`, `App`, `Sign Up`, `Shopping`, `Video`.

**Ledger entry type**
```
BONUS → purple   EARN → green   WITHDRAWAL → blue
REVERSAL → red   ADJUSTMENT → slate
```

**Withdrawal / payout status**
```
PAID → green       PENDING → amber      APPROVED → blue
PROCESSING → blue  REJECTED → red       FAILED → red
```

**User status**
```
ACTIVE → green    FLAGGED → amber    SUSPENDED → red
```

**Fraud severity**
```
high → red    medium → amber    low → slate
```

Badge text is the **raw enum value, uppercase** (`PAID`, `WITHDRAWAL`,
`SUSPENDED`) — legacy does not humanise them.

### 13.3 Non-Badge status pills

Legacy also uses one-off pills that are *not* the Badge component:

| Pill | Class | Where |
|---|---|---|
| Offerwall live/setup | `rounded-full px-2 py-0.5 text-[11px] font-semibold` + `bg-brand-50 text-brand-700` or `bg-amber-100 text-amber-700` | Offerwalls page |
| Achievement unlocked | `rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700` | Achievements page |
| Nav count badge | `grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-semibold text-white` | User sidebar |
| Notification count | `absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-red-500 text-[10px] font-semibold text-white` | Admin topbar bell |

### 13.4 Progress bars

Two heights, always a `rounded-full` track with a `rounded-full` fill and an
inline `width: N%`:

```
h-2   track bg-slate-100 / bg-purple-100   fill bg-brand-500 / bg-purple-500
h-1.5 track bg-slate-100                   fill bg-brand-500|bg-blue-500|bg-purple-500|bg-amber-500
```

---

## 14. Navigation, header, sidebar

Seen in [landing/03-navbar-and-hero](design/legacy/landing/03-navbar-and-hero-desktop-1440.png) (public),
[app/01-dashboard](design/legacy/app/01-dashboard-desktop-1600.png) (user sidebar + topbar) and
[admin/01-dashboard](design/legacy/admin/01-dashboard-desktop-1600.png) (grouped admin sidebar).

### 14.1 Landing navbar

Full treatment in §18.3 — the public header is a landing-page component.

```
sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur
inner: mx-auto flex h-16 max-w-6xl items-center justify-between px-6
links: hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex
       hover:text-slate-900
```
Height **64px**, translucent white with `backdrop-blur`. Logo left, links centre
(hidden below `md`), "Log in" text link + "Sign up" pill right. The "Earn" link
carries a `ChevronDown` at `h-3.5 w-3.5`.

### 14.2 User sidebar

```
sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-100 bg-white p-4 lg:flex
```

**256px wide, hidden below `lg` (1024px) with no mobile replacement** — see §22.

Nav item:
```
flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition
active:   bg-brand-50 text-brand-700
inactive: text-slate-500 hover:bg-slate-50 hover:text-slate-800
```
Icon `h-5 w-5`. Note the item radius is `rounded-xl` (12px), not the card's 16px.

Three groups separated by `<hr className="my-3 border-slate-100" />`, with
`space-y-1` between items and **no group titles**:

1. Dashboard · Earn · Offerwalls · Surveys · Watch Videos · Tasks · Daily Bonus
2. Wallet · Withdraw · Transactions · Referrals · Achievements
3. Notifications · Settings

Footer promo card, pinned bottom:
```
mt-4 rounded-2xl bg-slate-50 p-4
title  text-sm font-bold text-slate-900   "Get the app"
body   mt-1 text-xs text-slate-500        "Earn on the go. Anytime, anywhere."
chips  grid flex-1 place-items-center rounded-lg bg-slate-900 py-1.5 text-[10px] font-semibold text-white
```

### 14.3 User topbar

```
flex items-center justify-end gap-4 py-2
```
Right-aligned only — **no page title in the topbar**; the title lives in the page
body. Contents, left to right: Gift icon-button → Bell icon-button → identity
pill → Logout icon-button.

The identity pill is a recognisable detail:
```
flex items-center gap-3 rounded-full border border-slate-100 py-1 pl-1 pr-3
avatar   grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-lg   (🙂 emoji)
name     text-sm font-semibold text-slate-900
balance  text-xs font-medium text-brand-600     prefixed with "◈ "
```
The balance is formatted `toLocaleString("en-US")` and prefixed with the literal
character **◈ (U+25C8)** — a text stand-in for the gem.

### 14.4 Admin sidebar

```
sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-100 bg-white lg:flex
```

**240px** — narrower than the user sidebar. Header is `px-5 py-4` with a smaller
logo (`textClass="text-lg font-bold text-slate-900"`) and a `Menu` icon at
`h-5 w-5 text-slate-400` (decorative — it has no handler).

Group title:
```
px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400
```

Item — **`rounded-lg`, tighter than the user sidebar's `rounded-xl`**:
```
flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition
active:   bg-brand-50 text-brand-700
inactive: text-slate-500 hover:bg-slate-50 hover:text-slate-800
```
Icon `h-[18px] w-[18px]`. Groups use `space-y-5`, items `space-y-0.5`.

Five groups: **Main** (Dashboard, Users, Offers, Offerwalls, Surveys, Providers) ·
**Financial** (Wallets, Ledger, Withdrawals, Transactions, Payouts) ·
**Risk & Security** (Fraud Detection, IP Monitoring, Device Fingerprints,
Chargebacks) · **Engagement** (Referrals, Achievements, Notifications, Support
Tickets) · **System** (Reports, Audit Logs, Settings).

Only 5 of these 23 items have an `href`; the rest render as `<a href="#">`.

### 14.5 Admin topbar

```
sticky top-0 z-20 flex items-center gap-4 border-b border-slate-100 bg-white/90 px-6 py-3 backdrop-blur
```
Search field (`ml-auto`, `max-w-md`, hidden below `sm`) → bell with red count →
avatar + "Admin / Super Admin" + `ChevronDown`.

Unlike the user topbar, the admin topbar **has a bottom border and a background**,
because admin content scrolls under it.

---

## 15. Page layouts

### 15.1 Marketing (`/`, `/terms`, `/privacy`, `/cookies`)

```tsx
<div className="bg-white">
  <Navbar />
  <main>…</main>
  <Footer />
</div>
```
Full-bleed white sections, each `mx-auto max-w-6xl px-6`, vertical rhythm
`py-10` → `py-16`.

### 15.2 Authenticated app

```tsx
<div className="flex min-h-screen bg-slate-50">
  <DashboardSidebar current="…" />
  <div className="flex-1 px-4 sm:px-6 lg:px-8">
    <DashboardTopbar name={…} balance={…} />
    {/* page header */}
    {children}
    <div className="h-8" />
  </div>
</div>
```

**The app background is `bg-slate-50` while cards are `bg-white`.** That single
contrast is what makes the app feel layered despite near-zero shadow.

`PageShell` wraps this with an optional header:
```tsx
<div className="py-4">
  <h1 className="font-display text-3xl font-extrabold text-slate-900">{title}</h1>
  <p className="mt-1 text-slate-500">{subtitle}</p>
</div>
```

The dashboard uses a bespoke variant of the header (`Welcome`):
```tsx
<p className="text-sm text-slate-400">Welcome back,</p>
<h1 className="font-display text-3xl font-extrabold text-slate-900">{first}! 👋</h1>
<p className="mt-1 text-slate-500">Let's continue your earning journey today.</p>
```
Only the **first name** is shown: `(name ?? "there").split(" ")[0]`.

### 15.3 Admin

```tsx
<div className="flex min-h-screen bg-slate-50">
  <AdminSidebar current="…" />
  <div className="flex-1">
    <AdminTopbar />
    <div className="space-y-5 px-6 pb-10">…</div>
  </div>
</div>
```
The header is inside the content column and pairs a title block with a right-side
control (`Last 7 days`), stacking at `sm`.

### 15.4 Auth

```tsx
<main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white px-4">
  <AuthForm … />
</main>
```

### 15.5 Grid patterns

| Purpose | Class |
|---|---|
| Dashboard stat row (5 cards incl. level) | `grid gap-4 sm:grid-cols-2 xl:grid-cols-5` |
| Wallet stat row (4 cards) | `grid gap-4 sm:grid-cols-2 xl:grid-cols-4` |
| Dashboard main + right rail | `grid gap-5 xl:grid-cols-[1fr_320px]` |
| Offer grid | `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` |
| Offerwall grid | `grid gap-5 sm:grid-cols-2 xl:grid-cols-3` |
| Achievements grid | `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` |
| Withdraw page | `grid gap-5 lg:grid-cols-[380px_1fr]` |
| Settings / fraud | `grid gap-5 lg:grid-cols-2` |
| Admin 3-column rows | `grid gap-5 lg:grid-cols-12` with `lg:col-span-5` / `-4` / `-3` |
| Landing features | `grid gap-5 sm:grid-cols-2 lg:grid-cols-5` |
| Ways to earn | `grid gap-5 sm:grid-cols-2 lg:grid-cols-6` |
| Footer | `grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]` |

The **`320px` right rail** and the **`380px` withdraw form** are the two fixed
column widths in the app.

---

## 16. Dashboard patterns

Seen in [app/01-dashboard](design/legacy/app/01-dashboard-desktop-1600.png) and
[app/02-dashboard-mobile](design/legacy/app/02-dashboard-mobile-390.png).

Composition order on `/dashboard`:

1. `Welcome` — greeting header
2. `StatCards` — 4 stat cards + the purple level card, in one 5-column row
3. Two-column split `xl:grid-cols-[1fr_320px]`:
   - **Left** (`space-y-5`): `DailyBonusCard`, `RecommendedOffers`
   - **Right** (`space-y-5`): `Achievements`, `ReferralCard`, `RecentActivity`

### 16.1 Daily bonus card

Full-width `bg-brand-50` strip. `md:flex-row`, stacking on mobile. Contains a 💎
at `text-4xl`, title + streak line, a **7-dot week strip**, and a claim button.

The dots — the most distinctive small component in legacy:
```
base    grid h-7 w-7 place-items-center rounded-full text-xs font-semibold
done    bg-brand-500 text-white                       (shows "✓")
today   bg-brand-100 text-brand-700 ring-2 ring-brand-400
future  border border-slate-200 bg-white text-slate-400   (shows the day number)
```
Preceded by `Day {n} of 7` in `text-xs font-medium text-slate-500`.

### 16.2 Recommended offers rail

Horizontally scrolling row inside a card:
```
mt-4 flex gap-4 overflow-x-auto no-scrollbar
card: w-[180px] shrink-0 rounded-2xl border border-slate-100 p-3
      transition hover:border-brand-200 hover:shadow-sm
tile: grid h-24 w-full place-items-center rounded-xl text-2xl font-bold text-white
```
Ends with a circular chevron affordance:
`my-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-400`.

The `.no-scrollbar` class from `globals.css` is what makes this rail feel native.

### 16.3 Achievements teaser

`grid grid-cols-3 gap-2 text-center`, each tile:
```
mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl shadow-sm
unlocked  bg-brand-50            + emoji
locked    bg-slate-100 grayscale + 🔒
title     mt-2 text-xs font-bold   (text-slate-900 / text-slate-400)
state     text-[10px] text-slate-400   "Unlocked" / "Locked"
```
The full page uses `h-16 w-16` tiles at `text-3xl` inside bordered cards.

### 16.4 Recent activity list

```
row     flex items-center gap-3
icon    grid h-9 w-9 place-items-center rounded-xl {tint} text-base
title   text-sm font-medium text-slate-900
time    text-xs text-slate-400
amount  text-sm font-bold text-brand-600   with an explicit "+" when >= 0
```
Emoji and tint per activity kind:
```
survey → 📋 bg-blue-50        app_install → 📱 bg-emerald-50
offer  → 🎯 bg-purple-50      bonus       → 🎁 bg-amber-50
video  → ▶️ bg-pink-50        fallback    → ✨ bg-slate-50
```

Relative time is hand-written, not a library: `"just now"`, `"5 minutes ago"`,
`"3 hours ago"`, `"Yesterday"`, `"4 days ago"`. The notifications page uses a
terser set: `"5m ago"`, `"3h ago"`, `"yesterday"`, `"4d ago"`.

### 16.5 Continue earning row

Progress-bearing row: colour-block letter tile (`h-11 w-11 rounded-xl`), name +
badges, a labelled progress bar (`Progress` / `{n}%` in `text-xs text-slate-400`),
and a right-aligned points figure. `flex-col` on mobile, `sm:flex-row`.

---

## 17. Offerwall and offer card patterns

Seen in [app/08-surveys](design/legacy/app/08-surveys-offer-grid-desktop-1600.png) (grid),
[app/01-dashboard](design/legacy/app/01-dashboard-desktop-1600.png) (rail),
[app/06-offerwalls](design/legacy/app/06-offerwalls-desktop-1600.png) (provider cards) and
[app/07-earn](design/legacy/app/07-earn-offerwall-embed-desktop-1600.png) (embed / setup card).

### 17.1 Offer card (grid)

```tsx
<a className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md"
   target="_blank" rel="noopener noreferrer">
  <div className="grid h-28 w-full place-items-center rounded-xl text-3xl font-bold text-white"
       style={{ background: offer.color }}>{offer.icon}</div>
  <p className="mt-3 truncate text-sm font-bold text-slate-900">{title}</p>
  <div className="mt-1 flex flex-wrap gap-1">
    <Badge tone={DIFF_TONE[difficulty]}>{difficulty}</Badge>
    <Badge tone={CAT_TONE[category]}>{CAT_LABEL[category]}</Badge>
  </div>
  <div className="mt-2 flex items-baseline gap-1">
    <span className="text-lg font-bold text-slate-900">{points.toLocaleString()}</span>
    <span className="text-xs text-brand-600">≈ ${payoutUsd}</span>
  </div>
  <p className="mt-1 truncate text-xs text-slate-400">{description}</p>
</a>
```

Fixed characteristics:
- The whole card is an `<a>` that opens the provider in a new tab
- The image slot is a **solid colour block with one letter**, not a photo —
  `h-28` in the grid, `h-24` in the rail
- Difficulty badge always precedes category badge
- Points and the USD equivalent share a baseline; the `≈ $` is `text-brand-600`
- Both title and description `truncate` to a single line

### 17.2 Empty state

```
rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center
p: text-sm text-slate-400
```
Copy pattern: `"No {thing} available right now — check back soon."`

### 17.3 Offerwall card

```
group rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition hover:border-brand-200 hover:shadow-md
logo   grid h-14 w-14 place-items-center rounded-2xl text-xl font-bold text-white   (provider colour, first letter)
title  text-lg font-bold text-slate-900  + status pill
blurb  mt-1 text-sm text-slate-500
link   mt-4 inline-block text-sm font-semibold text-brand-600 group-hover:underline   "Open wall →"
```

### 17.4 Embedded wall

```
overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm
iframe: h-[calc(100vh-220px)] min-h-[560px] w-full border-0
```
The `100vh - 220px` accounts for topbar + page header.

### 17.5 Not-configured card

The warning-panel pattern:
```
rounded-2xl border border-amber-200 bg-amber-50 p-8
emoji 🧩 at text-4xl, heading text-lg font-bold text-slate-900,
body text-sm text-slate-600, ordered list list-decimal space-y-2 pl-5 text-sm text-slate-700
inline code: rounded bg-white px-1.5 py-0.5 text-xs
```

---

## 18. Landing page (public / marketing)

> The landing page is a **first-class design target**, not a by-product of the
> app. It is the only part of GemOne a logged-out visitor sees, and it uses
> shapes that appear nowhere else: full-bleed tinted sections, a 3xl-radius dark
> stats bar, a phone mockup, and a nav that is not a sidebar. **The authenticated
> dashboard design is not sufficient to reproduce it.**

**Screenshots:** [full page](design/legacy/landing/01-full-page-desktop-1440.png) ·
[tablet](design/legacy/landing/12-full-page-tablet-768.png) ·
[mobile](design/legacy/landing/13-full-page-mobile-390.png)

Source: `app/page.tsx`, `components/landing/{Navbar,Hero,sections,Footer}.tsx`,
copy in `lib/data.ts`.

### 18.0 Coverage map

| Concern | Where |
|---|---|
| Hero layout | §18.4 |
| Hero typography | §18.4 (headline recipe), §4.5 |
| Headlines / text hierarchy | §18.4, §18.8, §4.2, §4.5 |
| CTA styles + sizes | §18.4, §18.12, §9.1 |
| Navigation / header | §18.3 |
| Section spacing + backgrounds | §18.2 |
| Cards and feature sections | §18.7, §18.9, §18.10 |
| Product presentation | §18.5 (phone mockup), §18.9 (earning categories) |
| Decorative elements | §18.5 (floating props, sparkles) |
| Social proof | §18.4 (avatar stack + stars), §18.6 (partners), §18.10 (testimonials) |
| Statistics | §18.11 |
| Footer | §18.13 |
| Legal pages | §18.14 |
| Mobile layout + responsive | §18.15 |
| Mobile navigation | §18.3 (and the gap it names) |
| Button styles and interaction states | §18.16, §9 |
| Exact colours / type / spacing / radius / shadow | §3–§8, quoted inline throughout §18 |

**One thing the landing page deliberately does not contain: offer cards.** There
is no live offer wall, no offer grid and no pricing on the public page — the
product is shown *only* through the phone mockup (§18.5) and the six
category tiles (§18.9). The offer-card recipes in §17 belong to the
authenticated app. A rebuilt landing page that drops real offers onto the public
page is a change to the design, not a reproduction of it.

### 18.1 Composition

`app/page.tsx` is a flat list — nine bands, in this order, on `bg-white`:

```tsx
<div className="bg-white">
  <Navbar />
  <main>
    <Hero />        <Partners />    <Features />
    <HowItWorks />  <WaysToEarn />  <Testimonials />
    <StatsBar />    <CtaBanner />
  </main>
  <Footer />
</div>
```

Every band is full-bleed; content is centred by `mx-auto max-w-6xl px-6`
(**1152px**). The page is ~3400px tall at 1440, ~7200px at 390.

### 18.2 Section rhythm and backgrounds

The vertical rhythm is *not* uniform — it is the tempo of the page and worth
copying exactly.

| # | Section | Vertical padding | Background | Screenshot |
|---|---|---|---|---|
| 1 | Navbar | `h-16` (64px) | `bg-white/80 backdrop-blur` + `border-b border-slate-100` | [03](design/legacy/landing/03-navbar-and-hero-desktop-1440.png) |
| 2 | Hero | `py-16 lg:py-24` | `bg-gradient-to-b from-brand-50/60 to-white` | [02](design/legacy/landing/02-hero-fold-desktop-1440.png) |
| 3 | Partners | `py-10` | `bg-white` + `border-y border-slate-100` | [04](design/legacy/landing/04-partners-strip-desktop-1440.png) |
| 4 | Features | `py-12` | `bg-white` | [05](design/legacy/landing/05-features-row-desktop-1440.png) |
| 5 | How it works | `py-16` | `bg-white` | [06](design/legacy/landing/06-how-it-works-desktop-1440.png) |
| 6 | Ways to earn | `py-16` | `bg-white` (tiles carry the colour) | [07](design/legacy/landing/07-ways-to-earn-desktop-1440.png) |
| 7 | Testimonials | `py-16` | `bg-gradient-to-b from-brand-50/70 to-brand-50/30` | [08](design/legacy/landing/08-testimonials-desktop-1440.png) |
| 8 | Stats bar | `pb-4 pt-8` | `bg-white`, dark card inside | [09](design/legacy/landing/09-stats-bar-desktop-1440.png) |
| 9 | CTA banner | `py-14` | `bg-white`, `bg-brand-50` card inside | [10](design/legacy/landing/10-cta-banner-desktop-1440.png) |
| 10 | Footer | `py-12` | `bg-white` + `border-t border-slate-100` | [11](design/legacy/landing/11-footer-desktop-1440.png) |

**Only two bands are tinted** — the hero and the testimonials — and both use a
*vertical brand-50 gradient at low opacity*, not a flat fill. Everything between
them is white. That alternation is what gives the page its rhythm.

### 18.3 Navigation / header

```
header  sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur
inner   mx-auto flex h-16 max-w-6xl items-center justify-between px-6
links   hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex
        each: flex items-center gap-1 transition hover:text-slate-900
login   hidden text-sm font-medium text-slate-600 hover:text-slate-900 sm:block
signup  rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white
        shadow-sm transition hover:bg-brand-600
right   flex items-center gap-3
```

- **64px tall, sticky, translucent with `backdrop-blur`** — content scrolls
  visibly underneath. This is the only blurred surface on the public site.
- Links: `How it works · Earn · Rewards · Blog · Support`, all `href="#"` in
  legacy. **"Earn" alone carries a `ChevronDown` at `h-3.5 w-3.5`** — a dropdown
  affordance with no dropdown behind it.
- Logo left at `h-8 w-8` mark + `text-xl font-bold tracking-tight` wordmark.

**Responsive:** links vanish below `md` (768px); "Log in" vanishes below `sm`
(640px). At 390px the header is **logo + "Sign up" pill only** — see
[14-hero-mobile](design/legacy/landing/14-hero-mobile-390.png). There is **no
hamburger and no mobile menu** — the same gap as the app (§22.3).

### 18.4 Hero

Two columns at `lg`, stacked below: `mx-auto grid max-w-6xl items-center gap-10
px-6 py-16 lg:grid-cols-2 lg:py-24`.

**Headline — the single most recognisable element:**

```
font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl
```

Three hand-broken lines, with the third in brand green:

```
Earn Rewards.
Your Way.
Anytime, Anywhere.     ← <span className="text-brand-500">
```

`48px → 60px` at `sm`, line-height `1.05`, tracking `-0.025em`. The `<br />`
breaks are literal — the headline is **not** allowed to reflow.

**Sub-headline:** `mt-6 max-w-md text-lg text-slate-500` — "Complete offers, play
games, take surveys and earn real rewards. Turn your time into real value with
GemOne." The `max-w-md` (28rem) keeps it to ~3 lines.

**CTA pair** — `mt-8 flex flex-wrap items-center gap-3`:

```
primary    inline-flex items-center gap-2 rounded-full bg-brand-500 px-6 py-3
           font-semibold text-white shadow-sm transition hover:bg-brand-600
           "Start earning now"  + <ArrowRight className="h-4 w-4" />
secondary  inline-flex items-center gap-2 rounded-full border border-slate-200
           bg-white px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50
           <Play className="h-4 w-4" /> + "How it works"
```

Note the hero CTAs are **`px-6 py-3`** and inherit `text-base` — larger than the
`px-5 py-2.5 text-sm` used everywhere else. The icon *follows* the label on the
primary and *precedes* it on the secondary.

**Social proof cluster** — `mt-8 flex items-center gap-3`:

```
avatars  flex -space-x-2, each: grid h-9 w-9 place-items-center rounded-full
         border-2 border-white bg-slate-200 text-sm      (👩 🧑 👨)
stars    flex text-amber-400, 5 × <Star className="h-4 w-4 fill-current" />
label    text-sm font-medium text-slate-500   "30,000+ happy users"
```

The `-space-x-2` overlap plus `border-2 border-white` is the standard avatar-stack
treatment and appears only here.

### 18.5 Hero visual — phone mockup and floating props

Right column: `relative mx-auto h-[520px] w-full max-w-sm`.

**Phone frame:**
```
relative mx-auto w-[280px] rounded-[2.5rem] border-[10px] border-slate-900 bg-white shadow-2xl
notch: absolute left-1/2 top-0 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-slate-900
body:  space-y-4 p-4 pt-8
```
280px wide, **40px radius, 10px `slate-900` bezel**, and the only `shadow-2xl` on
the page.

**Screen contents** — a miniature of the real dashboard, which is what makes the
hero read as a product shot:
```
greeting  text-sm font-semibold text-slate-800     "Hi, Ashley! 👋"
balance   rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-white
            label  text-xs text-white/80        "Your Balance"
            value  text-3xl font-bold           "12,560"
            sub    text-xs text-white/80        "Points · ≈ $512.56"
activity  rounded-xl bg-slate-50 px-3 py-2, each row:
            icon  grid h-6 w-6 place-items-center rounded-lg bg-brand-100 text-[11px]
            label text-xs font-medium text-slate-700
            pts   text-xs font-bold text-brand-600
tabbar    flex justify-around border-t border-slate-100 pt-3 text-[10px] text-slate-400
            active item: font-semibold text-brand-600
```
Rows: `🎮 Game Mission +1,200 · 📋 Survey completed +800 · 📱 App install +1,000 ·
▶️ Video watched +200`. Tab bar: `Home · Earn · Wallet · Profile`.

**Floating props** — absolutely positioned, each
`absolute grid place-items-center rounded-2xl shadow-lg`:

| Content | Class |
|---|---|
| 🎁 | `left-0 top-8 h-16 w-16 rotate-[-12deg] bg-amber-100 text-3xl` |
| 🎮 | `bottom-16 left-2 h-16 w-16 rotate-6 bg-brand-100 text-3xl` |
| PayPal | `right-2 top-16 h-14 w-20 rotate-6 bg-[#003087] text-xs font-bold text-white` |
| amazon | `bottom-24 right-0 h-14 w-20 -rotate-6 bg-slate-900 text-xs font-bold text-white` |
| 🪙 | `bottom-4 right-10 h-14 w-14 bg-amber-300 text-2xl` |

Plus two bare sparkles: `absolute right-16 top-4 text-2xl text-brand-400` and
`absolute left-8 top-40 text-xl text-brand-300`, both the character `✦`.

The rotations (`-12deg`, `6deg`, `-6deg`) are the whole effect — without them the
props read as a grid.

> **INFERRED:** the source comments both the phone and the props as
> *"CSS/emoji placeholders, swap for real 3D renders"*. The composition is
> intentional; the rendering was meant to be upgraded.

### 18.6 Partners strip — social proof

```
section  border-y border-slate-100 bg-white py-10
label    text-center text-sm font-medium text-slate-400
          "Trusted by top offer partners"
row      mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4
name     text-lg font-semibold text-slate-300
```

Names: `AdGem · CPX Research · TOROX · timewall · lootably · ayet studios`.

**Deliberately faint** — `text-slate-300` (#cad5e2) is the lightest text on the
site. These are wordmarks-as-text, not logos, and they are meant to recede.

### 18.7 Features row

Five equal cards: `grid gap-5 px-6 sm:grid-cols-2 lg:grid-cols-5`.

```
card   rounded-2xl border border-slate-100 bg-white p-6 text-center shadow-sm
icon   mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-500 text-white
         <Icon className="h-6 w-6" />
title  mt-4 text-sm font-bold text-slate-900
text   mt-1 text-xs text-slate-500
```

**The only place on the site with a solid `brand-500` icon tile.** Everywhere else
icons sit on a pale tint. Icons: `Gift, DollarSign, Shield, Zap, Headphones`.

Copy: *Many Ways to Earn · Real Rewards · Safe & Secure · Instant Updates ·
24/7 Support*.

### 18.8 How it works

```
section  bg-white py-16, inner mx-auto max-w-6xl px-6 text-center
h2       font-display text-3xl font-bold text-slate-900   "How GemOne Works"
sub      mt-2 text-slate-500                              "Start earning in 3 simple steps"
row      mt-12 flex flex-col items-start justify-center gap-8 md:flex-row
```

Each step:
```
circle  relative grid h-28 w-28 place-items-center rounded-full bg-brand-50 text-5xl
number  absolute -top-1 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center
        rounded-full bg-brand-500 text-sm font-bold text-white
title   mt-5 font-bold text-slate-900
text    mt-1 max-w-[200px] text-sm text-slate-500
arrow   mt-4 hidden h-5 w-5 text-brand-300 md:block   (between steps, not after the last)
```

**112px pale-green circle with a 28px green numbered badge overlapping its top
edge** — the signature of this section. Emoji: 🧑‍💻 🚀 👛.
Copy: *Create an account · Complete offers · Get rewarded*.

The connecting `ArrowRight` appears only at `md` and above.

### 18.9 Ways to earn — the colour section

Six tinted tiles: `mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-6`.

```
tile   rounded-2xl p-5 text-center {tint}          ← no border, no shadow
icon   mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/70 text-3xl shadow-sm
title  mt-4 text-sm font-bold text-slate-900
text   mt-1 text-xs text-slate-500
button mt-4 w-full rounded-lg py-1.5 text-xs font-semibold {btn}
```

The exact pairs from `lib/data.ts` — these six tints are **the app's whole
semantic palette used decoratively in one row**, and reproducing them is what
makes the section recognisable:

| Emoji | Title | tile tint | button |
|---|---|---|---|
| 🎮 | Play Games | `bg-purple-50` | `bg-purple-100 text-purple-700` |
| 📋 | Surveys | `bg-blue-50` | `bg-blue-100 text-blue-700` |
| 📱 | App Offers | `bg-emerald-50` | `bg-emerald-100 text-emerald-700` |
| ▶️ | Watch Videos | `bg-amber-50` | `bg-amber-100 text-amber-700` |
| 🛍️ | Shopping | `bg-pink-50` | `bg-pink-100 text-pink-700` |
| 👥 | Referrals | `bg-indigo-50` | `bg-indigo-100 text-indigo-700` |

Note the icon plate is **`bg-white/70`** — translucent white over the tint, with
`shadow-sm`. A solid white plate loses the effect.

The button label is `Explore` on all six and is **not** a link in legacy.

### 18.10 Testimonials

Band tinted `bg-gradient-to-b from-brand-50/70 to-brand-50/30`, three cards
`mt-10 grid gap-6 md:grid-cols-3` (note `gap-6`, wider than the page's usual
`gap-5`).

```
card    rounded-2xl border border-slate-100 bg-white p-6 text-left shadow-sm
avatar  grid h-11 w-11 place-items-center rounded-full bg-slate-200 text-lg   (🙂)
name    flex items-center gap-1 text-sm font-bold text-slate-900
        + verified tick: <span className="text-brand-500">✔</span>
stars   flex text-amber-400, 5 × <Star className="h-3.5 w-3.5 fill-current" />
quote   mt-4 text-sm text-slate-600      wrapped in &ldquo; &rdquo;
footer  mt-4 flex items-center justify-between border-t border-slate-100 pt-4
amount  text-sm font-bold, colour inline from data
via     text-xs text-slate-400
```

The three entries, with their **inline** amount colours — these are hard-coded per
testimonial, not tokens:

| Name | Amount | Via | Colour |
|---|---|---|---|
| Alex Johnson | $250+ | PayPal | `#2563eb` |
| Sophie Martin | $180+ | Amazon | `#f59e0b` |
| Michael Chen | $500+ | Gift Cards | `#12b76a` |

The green `✔` after each name and the `border-t` above the payout line are the
two details that make these read as proof rather than decoration.

### 18.11 Stats bar

A dark full-width slab — the **only** dark surface on the public site.

```
outer  bg-white pb-4 pt-8, inner mx-auto max-w-6xl px-6
slab   grid gap-6 rounded-3xl bg-gradient-to-r from-brand-800 to-brand-950
       px-8 py-10 sm:grid-cols-2 lg:grid-cols-4
item   text-center text-white
value  font-display text-3xl font-extrabold
label  mt-1 text-sm text-brand-100/80
```

`rounded-3xl` (24px) — larger than every card on the site — with a **horizontal**
gradient `#065f46 → #022c22`. Labels are `brand-100` at 80% opacity, not white.

Figures: `30,000+ Active Users · $2M+ Paid to Users · 1M+ Offers Completed ·
50+ Reward Options`.

### 18.12 CTA banner

```
outer  bg-white py-14, inner mx-auto max-w-6xl px-6
card   flex flex-col items-center gap-6 rounded-3xl bg-brand-50 px-8 py-10
       text-center md:flex-row md:justify-between md:text-left
left   flex items-center gap-5
emoji  text-6xl                                    (🧰)
h2     font-display text-2xl font-bold text-slate-900   "Ready to start earning?"
p      mt-1 text-slate-500
cta    inline-flex items-center gap-2 rounded-full bg-brand-500 px-7 py-3
       font-semibold text-white shadow-sm transition hover:bg-brand-600
       "Sign up for free" + <ArrowRight className="h-4 w-4" />
note   mt-2 text-xs text-slate-400          "It takes less than 30 seconds!"
```

`rounded-3xl` again, `bg-brand-50`, **no border and no shadow**. The largest CTA
padding on the site (`px-7 py-3`), and the reassurance line under the button.

### 18.13 Footer

```
footer  border-t border-slate-100 bg-white py-12
grid    mx-auto max-w-6xl px-6, grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]
```

Brand column (1.4fr) then four link columns:

```
blurb    mt-4 max-w-xs text-sm text-slate-500
           "Earn rewards. Your way. Anytime, anywhere."
socials  mt-4 flex gap-3 text-slate-400, each:
           grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-sm
           characters: 💬  𝕏  📷  ▶️
col head h4 text-sm font-bold text-slate-900
col list mt-4 space-y-2.5 text-sm text-slate-500, links hover:text-slate-900
bottom   mt-10 border-t border-slate-100 pt-6 text-center text-sm text-slate-400
           "© 2026 GemOne. All rights reserved."
```

Columns: **Platform** (How it works, Earn, Rewards, Referrals, Blog) ·
**Company** (About us, Careers, Press, Terms of Service, Privacy Policy) ·
**Support** (Help Center, Contact us, Payment Proofs, Community) ·
**Legal** (Terms of Service, Privacy Policy, Cookie Policy, GDPR).

Only three links resolve — `/terms`, `/privacy`, `/cookies`; the rest are `#`.
Note `space-y-2.5` (10px) between links, tighter than the app's usual spacing.

### 18.14 Legal pages

Same public frame (`Navbar` + `Footer`) with a narrow column —
[screenshot](design/legacy/auth/05-legal-terms-desktop-1440.png):

```
main   mx-auto max-w-3xl px-6 py-16
h1     font-display text-4xl font-extrabold text-slate-900
date   mt-2 text-sm text-slate-400        "Last updated: …"
prose  mt-8 space-y-6 text-slate-600 leading-relaxed
       [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900
       [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mt-1
       [&_a]:font-medium [&_a]:text-brand-600
note   mt-12 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700
```

`text-4xl` here is the largest page title in the product, and the arbitrary-variant
prose block is the only place legacy styles descendants rather than elements
directly.

### 18.15 Landing responsive behaviour

Verified against [tablet 768](design/legacy/landing/12-full-page-tablet-768.png)
and [mobile 390](design/legacy/landing/13-full-page-mobile-390.png).

| Band | 390 (base) | 640 `sm` | 768 `md` | 1024 `lg` |
|---|---|---|---|---|
| Navbar | logo + Sign up | + "Log in" | + 5 nav links | — |
| Hero | 1 column, text then phone | H1 `text-6xl` | — | 2 columns, `py-24` |
| Partners | wrapped, centred | — | — | — |
| Features | 1 column | 2 columns | — | 5 columns |
| How it works | vertical, no arrows | — | horizontal row + arrows | — |
| Ways to earn | 1 column | 2 columns | — | 6 columns |
| Testimonials | 1 column | — | 3 columns | — |
| Stats bar | 1 column | 2 columns | — | 4 columns |
| CTA banner | stacked, centred | — | row, `justify-between`, left-aligned | — |
| Footer | 1 column | — | 5 columns `1.4fr + 4×1fr` | — |

Mobile section shots:
[hero](design/legacy/landing/14-hero-mobile-390.png) ·
[partners + features](design/legacy/landing/15-partners-features-mobile-390.png) ·
[how it works](design/legacy/landing/16-how-it-works-mobile-390.png) ·
[ways to earn](design/legacy/landing/17-ways-to-earn-mobile-390.png) ·
[testimonials](design/legacy/landing/18-testimonials-mobile-390.png) ·
[stats + CTA + footer](design/legacy/landing/19-stats-cta-footer-mobile-390.png)

Notes that only show up in the rendered captures:

- The hero **keeps its full `h-[520px]` phone column on mobile**, so the phone and
  all five floating props remain — the props are not hidden at any width.
- The H1 stays hand-broken on mobile, giving four visual lines at 390px.
- The stats slab keeps `rounded-3xl` and stacks to a single column, becoming a
  tall dark block ~400px high.
- The partners strip wraps to two rows of three at 390px.
- **No band is hidden and nothing is replaced at any breakpoint** — the landing
  page is purely a reflow, which is why it survives narrow widths far better than
  the authenticated app does.

### 18.16 Landing interaction states

Every interactive element on the public page and its state, from source:

| Element | Rest | Hover | Notes |
|---|---|---|---|
| Nav link | `text-slate-600` | `text-slate-900` | `transition` |
| "Log in" | `text-slate-600` | `text-slate-900` | hidden `< sm` |
| "Sign up" pill | `bg-brand-500` | `bg-brand-600` | `shadow-sm`, `transition` |
| Hero primary | `bg-brand-500` | `bg-brand-600` | `transition` |
| Hero secondary | `bg-white border-slate-200` | `bg-slate-50` | `transition` |
| CTA banner button | `bg-brand-500` | `bg-brand-600` | `transition` |
| "Explore" tile button | tinted | *none* | no hover state defined |
| Footer link | `text-slate-500` | `text-slate-900` | no `transition` class |

There is **no focus-visible styling, no active/pressed state, and no animation**
anywhere on the landing page. `transition` is used bare, with no duration.

> **INFERRED — worth fixing rather than copying:** the missing focus ring and the
> "Explore" buttons with no hover state are omissions, not decisions. The form
> fields in §10 *do* have a designed focus treatment (`brand-400` border +
> `brand-100` ring) — extending that to public buttons and links matches the
> system rather than departing from it.

---

## 19. Authentication pages

Seen in [auth/01-login](design/legacy/auth/01-login-desktop-1440.png),
[auth/02-signup-with-referral](design/legacy/auth/02-signup-with-referral-desktop-1440.png),
[auth/03-login-mobile](design/legacy/auth/03-login-mobile-390.png) and
[auth/04-signup-mobile](design/legacy/auth/04-signup-with-referral-mobile-390.png).

Single component (`AuthForm`) drives both `/login` and `/signup`.

```
page  flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white px-4
card  w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-8 shadow-sm
```

Header, centred:
```
GemMark at h-11 w-11
h1  mt-4 font-display text-2xl font-bold text-slate-900
p   mt-1 text-sm text-slate-500
```

Copy — reproduce these strings:

| Mode | Title | Subtitle | Submit | Footer |
|---|---|---|---|---|
| login | "Welcome back" | "Log in to continue earning." | "Log in" | "New to GemOne? **Create one**" |
| signup | "Create your account" | "Start earning rewards in seconds." | "Sign up" | "Already have an account? **Log in**" |

Form: `mt-6 space-y-4`. Fields — signup adds an optional "Display name" first;
both have Email (`you@example.com`) and Password (`••••••••`, `minLength=8` on
signup). Submit is the **full-width pill** (§9.1). Footer link:
`font-semibold text-brand-600`.

**Referral banner** — shown on `/signup?ref=CODE`:
```
mt-4 rounded-lg bg-brand-50 px-3 py-2 text-center text-xs font-medium text-brand-700
"🎁 You were invited! You'll both start earning together."
```

There is no "forgot password" link, no social login, and no divider in legacy.

---

## 20. Icons, charts and imagery

### 20.1 Icons — lucide-react

Sizes, by role:

| Size | Class | Used for |
|---|---|---|
| 18px | `h-[18px] w-[18px]` | Admin sidebar items |
| 20px | `h-5 w-5` | User sidebar items, topbar icon buttons, stat card icons, KPI icons |
| 16px | `h-4 w-4` | Inline button icons, chevrons, fraud counter icons |
| 14px | `h-3.5 w-3.5` | Navbar chevron, delta arrows, small stars |
| 24px | `h-6 w-6` | Landing feature icons (white on `bg-brand-500`) |

Icons at rest are `text-slate-400` (decorative) or inherit the item's text colour
(navigation). Icons in stat cards take the card's accent colour.

The icons legacy imports, by area:

- **User sidebar:** Home, Gamepad2, LayoutGrid, ClipboardList, PlayCircle, CheckSquare, Gift, Wallet, ArrowDownToLine, Receipt, Users, Trophy, Bell, Settings
- **User topbar:** Gift, Bell, LogOut
- **Admin sidebar:** LayoutDashboard, Users, Gift, LayoutGrid, ClipboardList, Boxes, Wallet, BookOpen, ArrowDownToLine, ArrowLeftRight, Banknote, ShieldAlert, Globe, Fingerprint, CreditCard, Share2, Trophy, Bell, LifeBuoy, BarChart3, ScrollText, Settings, Menu
- **Admin topbar:** Search, Bell, ChevronDown
- **Dashboard stats:** DollarSign, TrendingUp, Clock, CheckCircle2
- **Admin metrics:** Users, Wallet, Send, Target, Flag, ArrowUpRight, Calendar, ChevronDown
- **Admin KPIs / fraud:** ShieldCheck, CreditCard, CircleDollarSign, Activity, AlertCircle, Ban
- **Landing:** ArrowRight, Play, Star, Gift, DollarSign, Shield, Zap, Headphones, ChevronDown

### 20.2 The logo

Hand-written SVG in `components/ui/Logo.tsx`, `viewBox="0 0 32 32"`, three paths
forming a faceted gem. Default `h-8 w-8`; `h-11 w-11` on the auth card.

```tsx
<path d="M8 4h16l6 10-14 14L2 14 8 4Z" fill="#039855" />
<path d="M16 4h8l6 10-14 14 0-24Z" fill="#12b76a" />
<path d="M8 4h16l-4 8H12L8 4Z" fill="#32d583" opacity="0.85" />
```

Wordmark: `font-display text-xl font-bold tracking-tight text-slate-900`, gap-2
from the mark. Admin uses `text-lg`.

The source comment reads *"simple SVG gem/hexagon, swap for real brand asset when
available"* — so this is a placeholder that shipped.

### 20.3 Emoji

Emoji are load-bearing, not decoration. The recurring set:

```
💎 level / daily bonus / gem      🎁 referrals / bonus      👋 greeting
🙂 avatars                        🧑‍💼 admin avatar          🔒 locked achievement
👣 first steps   🔥 on a roll     🏆 offer master   💰 big earner
🏦 cashed out    🤝 recruiter     👑 high roller
🎮 games   📋 surveys   📱 apps   ▶️ video   🛍️ shopping   👥 referrals
🧩 setup needed  🧰 CTA banner    ✦ decorative sparkles
```

Avatars are always an emoji on a circle: `grid h-9 w-9 place-items-center
rounded-full bg-slate-200 text-lg`.

### 20.4 Charts — recharts

**NOT VISUALLY VERIFIED.** The charts require client hydration and a measured
container; they render blank in the headless captures. Everything below is read
from `components/ui/charts.tsx`.

**Shared axis styling:**
```
CartesianGrid  vertical={false}  stroke="#f1f5f9"
XAxis/YAxis    tickLine={false}  axisLine={false}
tick           { fill: "#94a3b8", fontSize: 12 }   (11 on the fraud chart)
```
Note `#94a3b8` is *Tailwind v3* slate-400, hard-coded — it does not match v4's
`#90a1b9`.

**`AreaTrend`** — platform overview, height 300, two series with gradient fills:
```
earnings  stroke #12b76a  strokeWidth 2.5  fill 0%→#12b76a@0.25 → 100%@0
payouts   stroke #3b82f6  strokeWidth 2.5  fill 0%→#3b82f6@0.20 → 100%@0
YAxis     width 44, ticks [0,2000,4000,6000,8000,10000], formatted `$${v/1000}K`
```

**`LineTrend`** — fraud, height 170:
```
stroke #f43f5e  strokeWidth 2.5  dot { r: 3, fill: "#f43f5e" }
fill   0%→#f43f5e@0.15 → 100%@0
ticks  [0, 250, 500, 750]
```

**`Donut`** — users overview, fixed `h-[200px] w-[200px]`:
```
innerRadius 66  outerRadius 92  paddingAngle 2  stroke none
startAngle 90   endAngle -270
centre overlay: text-2xl font-bold text-slate-900 + text-xs text-slate-400
segment colours: #12b76a active, #3b82f6 new, #f59e0b flagged, #f43f5e suspended
```

**`Sparkline`** — inside admin metric cards, height 40–48, single area,
`strokeWidth 2`, gradient `0.35 → 0`, `dot={false}`, `isAnimationActive={false}`,
coloured by the card's metric colour.

Legend markers are plain dots, not chart elements:
`<span className="h-2.5 w-2.5 rounded-full bg-brand-500" />`.

### 20.5 No raster assets

`apps/web/public/` contains only the unused Create-Next-App SVGs
(`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) plus
`app/favicon.ico`. **The design ships zero product images.**

---

## 21. Component styling patterns

Rules that hold across the whole legacy app:

1. **Centring is `grid place-items-center`, not flex.** Used for every avatar,
   icon button, tile and badge circle — 40+ occurrences. `flex items-center
   justify-center` appears only on full-page auth layouts.
2. **Fixed-size boxes are `h-N w-N`,** always square, always with
   `place-items-center`.
3. **`transition` with no duration or easing class.** 15 uses, always the bare
   utility — legacy never sets `duration-*` or `ease-*`. There are **no keyframe
   animations and no `animate-*` classes** in the app.
4. **Hover is a colour or border change**, never a transform. The only compound
   hover is the offer card: `hover:border-brand-200 hover:shadow-md`.
5. **`group` / `group-hover:` is used exactly once** — the offerwall card's
   "Open wall →" underline.
6. **Disabled = `disabled:opacity-60`.** Every submit button.
7. **Right-aligned actions are text links**, `text-sm font-semibold text-brand-600`,
   ending in a literal `→`.
8. **Vertical stacks use `space-y-*`; grids use `gap-*`.** Not mixed.
9. **`mt-*` is applied to the following element** rather than `mb-*` on the
   preceding one — `mt-1`, `mt-2`, `mt-3`, `mt-4`, `mt-5` throughout.
10. **Conditional styling is a ternary in a template literal**, or a
    `Record<Key, string>` lookup table at module scope (`CAT_TONE`, `DIFF_TONE`,
    `TYPE_TONE`, `STATUS_TONE`). No `clsx`, no `cva`.
11. **Numbers are always `toLocaleString("en-US")`.** Points never appear raw.
12. **Money is always shown twice** — points as the primary figure and an
    `≈ $X.XX` equivalent in a smaller, coloured line.

---

## 22. Responsive and mobile behavior

### 22.1 Breakpoints — Tailwind v4 defaults, measured from the bundle

| Prefix | min-width | px |
|---|---|---|
| `sm` | `40rem` | 640 |
| `md` | `48rem` | 768 |
| `lg` | `64rem` | 1024 |
| `xl` | `80rem` | 1280 |

`2xl` is never used.

The landing page has its own breakpoint table in §18.15; the table below covers
the authenticated app and admin.

### 22.2 What changes, by breakpoint

| Breakpoint | Change |
|---|---|
| `sm` (640) | Stat grids go 1 → 2 columns; offer grid 1 → 2; page padding `px-4` → `px-6`; admin page headers go row-wise; landing H1 `text-5xl` → `text-6xl`; admin search appears |
| `md` (768) | Landing nav links appear; "how it works" becomes a row; testimonials 3-up; footer 5-column; daily bonus card goes row-wise |
| `lg` (1024) | **Both sidebars appear**; page padding → `px-8`; offer grid → 3 columns; admin 12-column rows split; withdraw/settings split into two columns |
| `xl` (1280) | Stat rows → 4–5 columns; offer grid → 4 columns; dashboard right rail appears (`xl:grid-cols-[1fr_320px]`) |

### 22.3 Mobile behaviour — verified from a 390px render

Evidence: [app/02-dashboard-mobile](design/legacy/app/02-dashboard-mobile-390.png)
(authenticated, **no navigation**) versus
[landing/13-full-page-mobile](design/legacy/landing/13-full-page-mobile-390.png)
(public, reflows cleanly).

- **Both sidebars are `hidden … lg:flex` with no mobile substitute.** There is no
  hamburger, no drawer, no bottom tab bar. Below 1024px the authenticated app has
  **no navigation at all** — every page is reachable only by URL.
- The `Menu` icon in the admin sidebar header is decorative and has no handler.
- The topbar stays visible and right-aligned.
- Cards stack to one column; the level card keeps its gradient.
- The recommended-offers rail keeps scrolling horizontally — it is the intended
  mobile affordance.
- The dashboard right rail moves below the main column.

> **This is the clearest defect in the legacy design and should not be carried
> over.** The rest of the mobile layout is sound; the missing navigation is not a
> style choice to preserve. Everything else in this document reproduces legacy
> faithfully — this one item is flagged as **INFERRED intent: fix, don't copy.**
>
> The hero mockup shows what the mobile navigation was meant to be: a four-item
> bottom bar — `Home · Earn · Wallet · Profile`, active item in
> `font-semibold text-brand-600`, the rest `text-slate-400`, separated by
> `border-t border-slate-100 pt-3` at `text-[10px]`.

---

## 23. The details that make it recognisably GemOne

If a rebuild keeps only ten things, keep these. Each is verified and each is
visible in the screenshots.

1. **`bg-slate-50` page under `bg-white` cards with a `border-slate-100`
   hairline and `shadow-sm`.** This is the substrate of every screen.
2. **`rounded-2xl` cards + `rounded-full` buttons.** The 16px/pill pairing is the
   silhouette.
3. **Exactly one green, `#10b981` filled and `#059669` on hover and for links.**
4. **`brand-50` + `brand-700` as the active-navigation treatment** — a pale green
   pill behind the current page, never a bar or an underline.
5. **The stat card**: grey label, tinted circular icon opposite it, `text-3xl
   font-bold` number, `text-xs` unit, coloured `≈ $X.XX` sub-line.
6. **Pale-tint badges with `rounded-md`** carrying raw uppercase enum values, in
   the exact tone map of §13.2.
7. **Tables with no chrome** — `text-slate-400` headers, `divide-slate-50` rows,
   no borders, no striping, no hover.
8. **`+`/`−` amounts in `brand-600` / `red-500`**, points beside a smaller USD
   equivalent.
9. **The identity pill in the topbar**: emoji avatar, name, and `◈ 12,560` in
   `brand-600`.
10. **Emoji everywhere a picture would go**, usually inside a tinted
    `rounded-xl`/`rounded-2xl` square.

Runner-up details that cost nothing and carry a lot: the **7-dot daily-bonus
streak strip**, the **horizontally scrolling offer rail with hidden scrollbars**,
the **purple level card** as the only gradient in the dashboard grid, and the
**`from-brand-50/60 to-white` gradient** on auth pages.

---

## 24. Where each pattern lives in the legacy source

Path index for anything that needs re-checking **before** `legacy` is deleted.
All paths are relative to `apps/web/` on branch `legacy` (`e9215139`).

| Pattern | File |
|---|---|
| Theme tokens, brand scale, `.no-scrollbar` | `app/globals.css` |
| Font wiring, `<body>` classes | `app/layout.tsx` |
| Logo SVG + wordmark | `components/ui/Logo.tsx` |
| Badge component + tone table | `components/ui/Badge.tsx` |
| Charts (area, line, donut, sparkline) | `components/ui/charts.tsx` |
| Landing nav | `components/landing/Navbar.tsx` |
| Hero, phone mockup, floating props | `components/landing/Hero.tsx` |
| Partners/Features/HowItWorks/WaysToEarn/Testimonials/StatsBar/CtaBanner | `components/landing/sections.tsx` |
| Footer | `components/landing/Footer.tsx` |
| Auth card, field, notices | `components/auth/AuthForm.tsx` |
| App shell (sidebar + topbar + header) | `components/dashboard/PageShell.tsx` |
| User sidebar, nav item, promo card | `components/dashboard/Sidebar.tsx` |
| User topbar, identity pill | `components/dashboard/Topbar.tsx` |
| Welcome, stat cards, level card, offer rail, continue-earning | `components/dashboard/Main.tsx` |
| Offer card grid + empty state | `components/dashboard/OffersGrid.tsx` |
| Achievements teaser, recent activity | `components/dashboard/RightRail.tsx` |
| Daily bonus card + 7-dot strip | `components/dashboard/DailyBonusCard.tsx` |
| Referral rail card | `components/dashboard/ReferralCard.tsx` |
| Referral gradient hero + how-it-works | `components/dashboard/ReferralPanel.tsx` |
| Withdraw form | `components/dashboard/WithdrawForm.tsx` |
| Settings forms, shared `inputCls` | `components/dashboard/SettingsForms.tsx` |
| Admin sidebar + groups | `components/admin/Sidebar.tsx` |
| Admin topbar + search | `components/admin/Topbar.tsx` |
| Admin metric cards, platform/users/countries | `components/admin/TopSection.tsx` |
| Admin tables, fraud panel, KPI cards | `components/admin/BottomSection.tsx` |
| Admin row action buttons | `components/admin/{UserStatusButton,WithdrawalActions}.tsx` |
| Legal page frame | `components/legal/LegalPage.tsx` |
| Wallet stat cards + table | `app/wallet/page.tsx` |
| Transactions table | `app/transactions/page.tsx` |
| Withdraw two-column layout | `app/withdraw/page.tsx` |
| Offerwall cards | `app/offerwalls/page.tsx` |
| Embedded wall + setup card | `app/earn/page.tsx` |
| Achievement grid | `app/achievements/page.tsx` |
| Notification list rows | `app/notifications/page.tsx` |
| 7-day reward grid | `app/daily-bonus/page.tsx` |
| Category-filtered walls | `app/{surveys,videos,tasks}/page.tsx` |
| Admin dashboard composition | `app/admin/page.tsx` |
| Admin users/withdrawals/fraud tables | `app/admin/{users,withdrawals,fraud}/page.tsx` |
| Static landing copy + mock rows | `lib/data.ts` |
| Admin colour/tint/label maps | `lib/admin.ts` |
| Offer colour + icon contract | *(API)* `apps/api/src/providers/provider.types.ts` |

---

## 25. What could not be verified

Stated plainly so nothing here is mistaken for fact.

1. **Chart rendering.** The recharts components never painted in the headless
   captures — they are the blank panels in
   [admin/01-dashboard](design/legacy/admin/01-dashboard-desktop-1600.png). Their
   configuration (§20.4) is read from source and is exact; their *rendered*
   appearance — curve smoothing, gradient falloff, tick placement — was not seen.
2. **Hover, focus and active states.** Extracted from class strings, not
   photographed — a headless screenshot has no pointer. The landing page's
   complete state table (§18.16) is therefore source-derived, and the two gaps it
   names (no focus ring anywhere; no hover on the "Explore" buttons) are absences
   in the code, confirmed by grep rather than by eye.
3. **The `/privacy` and `/cookies` pages.** Only `/terms` was rendered
   ([auth/05](design/legacy/auth/05-legal-terms-desktop-1440.png)); all three use
   the same `LegalPage` frame, so the styling is covered, but their body content
   was not reviewed.
4. **Real offer artwork.** Every offer tile in legacy is a colour block with a
   letter. Whether a real provider's creative was ever intended to replace it is
   unknown — `provider.types.ts` comments the icon as a *"single letter / emoji
   placeholder"*, which suggests yes, but nothing implements it.
5. **The logo.** Its own source comment calls it a placeholder pending a "real
   brand asset". No such asset exists in the branch.
6. **Motion design.** `transition` is used bare, so durations are the browser/
   Tailwind default. There was no deliberate motion system to extract.
7. **Print styles, RTL, reduced-motion, and any accessibility affordance beyond
   `aria-hidden` on the logo.** None are present in legacy — this is an absence,
   not an oversight in the extraction.
8. **Loading states.** There are **no `loading.tsx` files, no skeletons, and no
   spinners** in legacy. The only loading feedback is a button's label changing
   to `"Saving…"`. Server components mean the page simply arrives complete.
9. **Error states.** There is no `error.tsx` and no `not-found.tsx`. The only
   error surface is the inline red notice (§10.3). An unhandled fetch failure
   throws (`lib/*.ts` all `throw new Error(...)`) and would hit the default
   Next.js error page.
