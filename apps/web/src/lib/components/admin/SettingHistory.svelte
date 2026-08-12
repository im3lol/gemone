<!--
  What is stored for this key, and who changed it — ARCHITECTURE.md §4.9.

  Two panels, both straight from `GET /admin/configuration/:key`.

  ## The overrides panel is where the resolution chain becomes visible

  A key can hold a global value and a value per provider at the same time, and
  the provider one wins. Listing them with their scope is what turns "the value
  is 14" into "the value is 14 unless you are asking about that provider" —
  which is the question §4.9 says an admin cannot answer by hand.

  `valid: false` is on the contract for a reason worth surfacing: a stored value
  that no longer satisfies its key's schema is **ignored on read**, and the
  chain falls through to the next level. Without saying so, the screen would
  show a live-looking override beside an effective value that came from
  somewhere else.

  ## The timeline is the only concurrency signal there is

  `PUT /admin/configuration/:key` takes no version or precondition, so two
  administrators editing the same key in the same minute both succeed and the
  second value wins silently. Nothing here can prevent that. What it can do is
  show who wrote last and when, so a change that appeared from nowhere is
  attributable on the next load. Recorded as TODO T88.
-->
<script lang="ts">
  import type { AdminConfigurationKeyDetail } from '@gemone/contracts';

  import { Badge, Card } from '$lib/components/ui';
  import { formatValue } from '$lib/admin/settings';
  import { absoluteDate, relativeTime } from '$lib/rewards/ledger';

  type Props = {
    setting: AdminConfigurationKeyDetail;
    now: string;
  };

  let { setting, now }: Props = $props();
</script>

<div class="flex flex-col gap-5">
  <Card as="section" padding="lg" aria-labelledby="overrides-title">
    <h2 id="overrides-title" class="gm-card-title">Stored values</h2>
    <p class="gm-subtitle mt-1">
      Everything explicitly set for this key. A provider value wins over the global one.
    </p>

    {#if setting.overrides.length === 0}
      <p class="gm-caption mt-4">
        Nothing is stored at any scope. The value in force is the one code declares.
      </p>
    {:else}
      <ul class="mt-4 flex flex-col gap-3">
        {#each setting.overrides as override (override.scope + override.scopeId)}
          <li class="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-mono text-sm break-all text-text">{formatValue(override.value)}</p>
                <p class="gm-caption">
                  {override.scope === 'GLOBAL' ? 'Global' : `Provider ${override.scopeId}`}
                  · set by {override.updatedBy ?? 'unknown'}
                  ·
                  <time datetime={override.updatedAt} title={absoluteDate(override.updatedAt)}>
                    {relativeTime(override.updatedAt, now)}
                  </time>
                </p>
              </div>

              {#if !override.valid}
                <!--
                  Stored, and not used. The value no longer satisfies the key's
                  schema — which happens when a key's shape changes in a release
                  while a value is stored under the old one — so the chain skips
                  it entirely.
                -->
                <Badge variant="error">Ignored — no longer valid</Badge>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <Card as="section" padding="lg" aria-labelledby="history-title">
    <h2 id="history-title" class="gm-card-title">History</h2>
    <p class="gm-subtitle mt-1">Every change to this key, newest first.</p>

    {#if setting.history.length === 0}
      <p class="gm-caption mt-4">This key has never been changed.</p>
    {:else}
      <ol class="mt-4 flex flex-col gap-3">
        {#each setting.history as entry, index (entry.createdAt + index)}
          <li class="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <p class="font-mono text-sm break-all text-text">
              <!--
                Null on either side is meaningful and is named rather than
                rendered blank: nothing stored before means the value was
                inherited or default, and nothing after means the override was
                removed.
              -->
              {entry.oldValue === null ? 'nothing stored' : formatValue(entry.oldValue)}
              <span class="text-text-muted" aria-hidden="true">→</span>
              <span class="gm-sr-only">changed to</span>
              {entry.newValue === null ? 'nothing stored' : formatValue(entry.newValue)}
            </p>

            {#if entry.reason}
              <p class="gm-caption">{entry.reason}</p>
            {/if}

            <p class="gm-caption">
              {entry.scope === 'GLOBAL' ? 'Global' : `Provider ${entry.scopeId}`}
              · {entry.actorType}{entry.actorId ? ` ${entry.actorId}` : ''}
              ·
              <time datetime={entry.createdAt} title={absoluteDate(entry.createdAt)}>
                {relativeTime(entry.createdAt, now)}
              </time>
            </p>
          </li>
        {/each}
      </ol>
    {/if}
  </Card>
</div>
