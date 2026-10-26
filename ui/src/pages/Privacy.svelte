<script lang="ts">
  // Privacy and safety, whole: every conversation that went without encryption (those that matter in colour, those
  // inside the house and those harmless by design quietly), the trackers and telemetry by company with the devices
  // that talk to them, where the data goes, how each device looks up names, and which servers agreed old TLS. For
  // the live session (the colour for the last hour), or a capture.
  import { argus } from '../lib/argus.svelte.ts';
  import { privacy } from '../lib/privacy.ts';
  import PrivacyPanel from '../lib/PrivacyPanel.svelte';
  import SourceHead from '../lib/SourceHead.svelte';

  let { capture }: { capture?: string } = $props();

  const source = $derived(argus.sourceFor(capture, true));
  const p = $derived(source ? privacy(source) : undefined);
  const recent = $derived(source?.kind === 'live' ? privacy(source, { since: Date.now() / 1000 - 3600 }) : undefined);
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">Privacy</h1>
    <p class="page-lede">
      What went without encryption, what talks to trackers, where the data goes, and how names are looked up. What is encrypted is not
      read: only that it was, with whom, and how much.
    </p>
    {#if source}<SourceHead {source} />{/if}
  </header>
  {#if source && p}
    <PrivacyPanel {p} {source} {recent} {capture} full />
  {/if}
</div>
