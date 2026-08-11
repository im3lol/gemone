<!--
  Account status — the minimum useful, and nothing beyond it.

  `GET /users/me` returns six fields: id, email, role, status, locale and
  createdAt. Three of them are worth a user's attention — who they are signed
  in as, whether the account is in good standing, and since when. The id is
  plumbing and the locale is not settable anywhere yet, so neither is shown.

  ## Why status is here at all

  `SUSPENDED` and `BANNED` are states in which offers still render and rewards
  do not credit. Someone in one of them needs to know it on the first screen
  they see, not by inferring it from a wall that stops paying. That is the
  whole reason this card exists on an MVP dashboard.
-->
<script lang="ts">
  import type { UserProfile, UserStatus } from '@gemone/contracts';

  import { Badge, Card } from '$lib/components/ui';
  import { absoluteDate } from '$lib/rewards/ledger';

  type Props = { profile: UserProfile };

  let { profile }: Props = $props();

  /*
   * Only `ACTIVE` is good news. The other three are all "something is wrong
   * with this account", said at different volumes — and `CLOSED` is neutral
   * rather than an error because the user is the one who asked for it.
   *
   * Keyed by literal rather than by `USER_STATUSES`, for the packaging reason
   * documented at the top of `$lib/rewards/ledger.ts`: importing a runtime
   * value from `@gemone/contracts` breaks the SSR build. `Record<UserStatus,
   * …>` keeps the map exhaustive either way.
   */
  const tones: Record<UserStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
    ACTIVE: 'success',
    SUSPENDED: 'warning',
    BANNED: 'error',
    CLOSED: 'neutral',
  };

  const words: Record<UserStatus, string> = {
    ACTIVE: 'Active',
    SUSPENDED: 'Suspended',
    BANNED: 'Banned',
    CLOSED: 'Closed',
  };

  const tone = $derived(tones[profile.status] ?? 'neutral');
  const word = $derived(words[profile.status] ?? profile.status);
</script>

<Card as="section" padding="lg" aria-labelledby="account-title">
  <h2 id="account-title" class="gm-card-title">Your account</h2>

  <dl class="mt-4 flex flex-col gap-3 text-sm">
    <div class="flex items-start justify-between gap-3">
      <dt class="shrink-0 text-text-secondary">Signed in as</dt>
      <!-- `break-all`: an address long enough to overflow a 320px rail is not
           rare, and a wrapped email is better than a scrollbar on the page. -->
      <dd class="min-w-0 text-right font-medium break-all text-text">{profile.email}</dd>
    </div>

    <div class="flex items-center justify-between gap-3">
      <dt class="shrink-0 text-text-secondary">Status</dt>
      <dd><Badge variant={tone}>{word}</Badge></dd>
    </div>

    <div class="flex items-center justify-between gap-3">
      <dt class="shrink-0 text-text-secondary">Member since</dt>
      <dd class="font-medium text-text">
        <time datetime={profile.createdAt}>{absoluteDate(profile.createdAt)}</time>
      </dd>
    </div>
  </dl>

  {#if profile.status !== 'ACTIVE'}
    <p class="gm-hint mt-4">
      Rewards are not credited while an account is {word.toLowerCase()}.
    </p>
  {/if}
</Card>
