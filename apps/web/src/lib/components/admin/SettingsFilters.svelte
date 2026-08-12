<!--
  The two filters `AdminListConfigurationDto` accepts, and no third.

  `overriddenOnly` is the more useful of the two on a real deployment: it
  answers "what has anybody actually changed", which is the first question
  asked when behaviour surprises somebody. It is a checkbox rather than a
  select because it has two states and one of them is the default.

  A plain `<form method="GET">`, so the result is a URL and works without
  JavaScript. The checkbox submits on change; the text field does not, because
  submitting on every keystroke is a navigation per character.
-->
<script lang="ts">
  import Search from '@lucide/svelte/icons/search';

  import { Button, Input } from '$lib/components/ui';

  type Props = {
    search: string;
    overriddenOnly: boolean;
  };

  let { search, overriddenOnly }: Props = $props();
</script>

<form method="GET" class="flex flex-wrap items-end gap-4">
  <Input
    label="Search settings"
    name="search"
    value={search}
    placeholder="Any part of a key"
    hint="Matches anywhere in the key name."
    maxlength={100}
    autocomplete="off"
    class="min-w-56 flex-1"
  />

  <label class="flex items-center gap-2 pb-2 text-sm text-text">
    <!--
      `value="true"` with no hidden companion: an unchecked box sends nothing,
      and the load reads a missing parameter as false. A hidden `false` field
      would send both and rely on ordering.
    -->
    <input
      type="checkbox"
      name="overriddenOnly"
      value="true"
      checked={overriddenOnly}
      class="size-4 rounded border-border accent-brand-500"
      onchange={(event) => event.currentTarget.form?.requestSubmit()}
    />
    Changed from the default only
  </label>

  <Button type="submit" variant="secondary">
    <Search size={16} aria-hidden="true" />
    Search
  </Button>
</form>
