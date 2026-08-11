<!--
  UI kit showcase — docs/UI_KIT.md. Development only; see `+page.server.ts`.

  Every component, every variant, every state, on one page. Read it as the
  visual contract for phase 1: if something here looks wrong at 390px, 768px,
  1024px or 1440px, the foundation is wrong, not the page that uses it.
-->
<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Clock from '@lucide/svelte/icons/clock';
  import DollarSign from '@lucide/svelte/icons/dollar-sign';
  import Inbox from '@lucide/svelte/icons/inbox';
  import Search from '@lucide/svelte/icons/search';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import TrendingUp from '@lucide/svelte/icons/trending-up';

  import {
    Alert,
    Badge,
    Button,
    Card,
    Container,
    EmptyState,
    ErrorState,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Spinner,
    StatCard,
  } from '$lib/components/ui';

  let text = $state('');
  let amount = $state<number | null>(250);
  let method = $state('paypal');
  let confirmOpen = $state(false);
  let busy = $state(false);

  const methods = [
    { value: 'paypal', label: 'PayPal' },
    { value: 'bank', label: 'Bank transfer' },
    { value: 'crypto', label: 'Crypto (unavailable)', disabled: true },
  ];

  const buttonVariants = ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const;
  const badgeVariants = [
    'neutral',
    'brand',
    'success',
    'warning',
    'error',
    'info',
    'purple',
    'indigo',
    'pink',
  ] as const;

  const tokens = [
    { name: '--color-brand-500', value: '#10b981', swatch: 'bg-brand-500' },
    { name: '--color-brand-600', value: '#059669', swatch: 'bg-brand-600' },
    { name: '--color-brand-50', value: '#ecfdf5', swatch: 'bg-brand-50' },
    { name: '--color-background', value: '#f8fafc', swatch: 'bg-background' },
    { name: '--color-border', value: '#f1f5f9', swatch: 'bg-border' },
    { name: '--color-border-strong', value: '#e2e8f0', swatch: 'bg-border-strong' },
    { name: '--color-text', value: '#0f172b', swatch: 'bg-text' },
    { name: '--color-text-secondary', value: '#62748e', swatch: 'bg-text-secondary' },
    { name: '--color-text-muted', value: '#90a1b9', swatch: 'bg-text-muted' },
    { name: '--color-success', value: '#10b981', swatch: 'bg-success' },
    { name: '--color-warning', value: '#f99c00', swatch: 'bg-warning' },
    { name: '--color-danger', value: '#fb2c36', swatch: 'bg-danger' },
    { name: '--color-info', value: '#3080ff', swatch: 'bg-info' },
  ];

  function fakeSubmit(): void {
    busy = true;
    setTimeout(() => (busy = false), 1400);
  }
</script>

<svelte:head><title>UI kit</title></svelte:head>

<!--
  The showcase carries its own container: it sits outside every group, so no
  layout supplies one.
-->
<Container as="main" class="flex flex-col gap-10 py-8">
  <PageHeader
    title="UI kit"
    description="Design foundation and shared components. Development only — this route 404s in a production build."
  >
    {#snippet actions()}
      <Button variant="secondary" size="sm">Secondary</Button>
      <Button size="sm">Primary<ArrowRight size={16} aria-hidden="true" /></Button>
    {/snippet}
  </PageHeader>

  <!-- ------------------------------------------------------------- tokens -->
  <section class="flex flex-col gap-4">
    <h2>Tokens</h2>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each tokens as token (token.name)}
        <Card padding="sm" class="flex items-center gap-3">
          <span class="size-9 shrink-0 rounded-block border border-border {token.swatch}"></span>
          <span class="min-w-0">
            <code class="block truncate text-xs text-text">{token.name}</code>
            <span class="gm-caption">{token.value}</span>
          </span>
        </Card>
      {/each}
    </div>
  </section>

  <!-- --------------------------------------------------------- typography -->
  <section class="flex flex-col gap-4">
    <h2>Typography</h2>
    <Card class="flex flex-col gap-3">
      <p class="gm-display">Display</p>
      <h1>Page title</h1>
      <h2>Section title</h2>
      <h3>Card title</h3>
      <p class="gm-body">Body — the default reading size, 14px on a 24px line.</p>
      <p class="gm-subtitle">Subtitle — labels, descriptions and secondary lines.</p>
      <p class="gm-caption">Caption — units, timestamps and table headers.</p>
    </Card>
  </section>

  <!-- ------------------------------------------------------------ buttons -->
  <section class="flex flex-col gap-4">
    <h2>Buttons</h2>

    <Card class="flex flex-col gap-5">
      {#each buttonVariants as variant (variant)}
        <div class="flex flex-col gap-2">
          <p class="gm-caption">{variant}</p>
          <div class="flex flex-wrap items-center gap-2">
            <Button {variant} size="sm">Small</Button>
            <Button {variant}>Default</Button>
            <Button {variant} size="lg">Large</Button>
            <Button {variant} disabled>Disabled</Button>
            <Button {variant} loading>Loading</Button>
            <Button {variant} iconOnly aria-label="Delete"><Trash2 size={18} aria-hidden="true" /></Button>
          </div>
        </div>
      {/each}

      <div class="flex flex-col gap-2">
        <p class="gm-caption">link · block · icon + label</p>
        <div class="flex flex-wrap items-center gap-2">
          <Button href="/dev/ui" variant="secondary">As a link</Button>
          <Button href="/dev/ui" variant="secondary" disabled>Disabled link</Button>
          <Button onclick={fakeSubmit} loading={busy}>
            <CircleCheck size={16} aria-hidden="true" />
            {busy ? 'Saving' : 'Save changes'}
          </Button>
        </div>
        <Button block>Full-width submit</Button>
      </div>
    </Card>
  </section>

  <!-- -------------------------------------------------------------- forms -->
  <section class="flex flex-col gap-4">
    <h2>Form controls</h2>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card class="flex flex-col gap-4">
        <Input label="Email" type="email" bind:value={text} placeholder="you@example.com" required />
        <Input label="Password" type="password" hint="At least 12 characters." />
        <Input label="Points to withdraw" type="number" bind:value={amount} hint="Available: 4,120" />
        <Input label="Search offers" type="search" labelHidden placeholder="Search offers" />
      </Card>

      <Card class="flex flex-col gap-4">
        <Input label="Invalid field" value="not-an-email" error="Enter a valid email address." />
        <Input label="Disabled field" value="Locked" disabled />
        <Select label="Payout method" options={methods} bind:value={method} />
        <Select label="Status" options={methods} placeholder="Any status" value="" />
      </Card>
    </div>
  </section>

  <!-- ------------------------------------------------------------- alerts -->
  <section class="flex flex-col gap-4">
    <h2>Alerts</h2>
    <div class="flex flex-col gap-3">
      <Alert variant="success" live={false}>Your payout request was received.</Alert>
      <Alert variant="info" live={false}>Points mature 14 days after a conversion is confirmed.</Alert>
      <Alert variant="warning" live={false} title="Provider not configured">
        AdGem has no credentials yet, so its offers are hidden from the wall.
      </Alert>
      <Alert variant="error" live={false} title="That link is invalid or has expired">
        Request a new verification email and try again.
      </Alert>
    </div>
  </section>

  <!-- ------------------------------------------------------------- badges -->
  <section class="flex flex-col gap-4">
    <h2>Badges</h2>
    <Card class="flex flex-wrap gap-2">
      {#each badgeVariants as variant (variant)}
        <Badge {variant}>{variant.toUpperCase()}</Badge>
      {/each}
    </Card>
  </section>

  <!-- --------------------------------------------------------- stat cards -->
  <section class="flex flex-col gap-4">
    <h2>Stat cards</h2>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Current balance"
        value="4,120"
        unit="points"
        icon={DollarSign}
        trend={{ label: '+320 this week', direction: 'up', sentiment: 'positive' }}
      />
      <StatCard
        label="Today's earnings"
        value="180"
        unit="points"
        tone="blue"
        icon={TrendingUp}
        trend={{ label: 'Down from 240', direction: 'down', sentiment: 'negative' }}
      />
      <StatCard label="Pending rewards" value="640" unit="points" tone="amber" icon={Clock} />
      <StatCard label="Completed offers" value="27" tone="purple" filled />
    </div>
  </section>

  <!-- ---------------------------------------------------------- the table -->
  <section class="flex flex-col gap-4">
    <h2>Table</h2>
    <Card>
      <div class="gm-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Offer</th>
              <th>Status</th>
              <th>Date</th>
              <th class="gm-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><Badge variant="success">EARN</Badge></td>
              <td class="font-medium text-text">Quick Survey</td>
              <td><Badge variant="success">PAID</Badge></td>
              <td class="whitespace-nowrap text-text-muted">2026-08-04</td>
              <td class="gm-num font-semibold text-brand-600">+250</td>
            </tr>
            <tr>
              <td><Badge variant="info">WITHDRAWAL</Badge></td>
              <td class="font-medium text-text">PayPal</td>
              <td><Badge variant="warning">PENDING</Badge></td>
              <td class="whitespace-nowrap text-text-muted">2026-08-02</td>
              <td class="gm-num font-semibold text-text">-2,000</td>
            </tr>
            <tr>
              <td><Badge variant="error">REVERSAL</Badge></td>
              <td class="font-medium text-text">MONOPOLY GO!</td>
              <td><Badge variant="error">FAILED</Badge></td>
              <td class="whitespace-nowrap text-text-muted">2026-07-29</td>
              <td class="gm-num font-semibold text-danger-text">-500</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </section>

  <!-- ------------------------------------------------------------- states -->
  <section class="flex flex-col gap-4">
    <h2>Empty, loading and error states</h2>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <EmptyState
        icon={Inbox}
        title="No offers yet"
        description="Nothing matches these filters. Try clearing the category."
      >
        {#snippet action()}
          <Button variant="secondary" size="sm">Clear filters</Button>
        {/snippet}
      </EmptyState>

      <Card aria-busy="true" class="flex flex-col gap-3">
        <Skeleton width="40%" height="0.75rem" />
        <Skeleton height="2rem" width="55%" />
        <Skeleton lines={3} />
        <span class="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner size="sm" />
          Loading your earnings
        </span>
      </Card>

      <ErrorState detail="request 7f3a91c2">
        {#snippet action()}
          <Button variant="secondary" size="sm">Try again</Button>
        {/snippet}
      </ErrorState>
    </div>
  </section>

  <!-- -------------------------------------------------------------- modal -->
  <section class="flex flex-col gap-4">
    <h2>Modal</h2>
    <Card class="flex flex-wrap items-center gap-3">
      <Button variant="danger" onclick={() => (confirmOpen = true)}>Reject payout…</Button>
      <p class="gm-subtitle">Escape closes it, focus is trapped, the page behind is inert.</p>
    </Card>

    <Modal
      bind:open={confirmOpen}
      title="Reject this payout?"
      description="The user is not notified automatically. Their points return to the available balance."
    >
      <Input label="Reason" placeholder="Shown to the reviewer, not the user" />
      {#snippet footer()}
        <Button variant="secondary" onclick={() => (confirmOpen = false)}>Cancel</Button>
        <Button variant="danger" onclick={() => (confirmOpen = false)}>Reject payout</Button>
      {/snippet}
    </Modal>
  </section>

  <!-- -------------------------------------------------------------- icons -->
  <section class="flex flex-col gap-4">
    <h2>Icons</h2>
    <Card class="flex flex-wrap items-end gap-6">
      {#each [14, 16, 18, 20, 24] as size (size)}
        <span class="flex flex-col items-center gap-2">
          <Search {size} aria-hidden="true" class="text-text-muted" />
          <span class="gm-caption">{size}px</span>
        </span>
      {/each}
    </Card>
  </section>
</Container>
