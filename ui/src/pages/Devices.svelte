<script lang="ts">
  // The devices of the network shown (the one of now, unless he chose another in the bar: NetFilter), or of a saved
  // capture, busiest first, each with its networks.
  import { argus } from '../lib/argus.svelte.ts';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import { since } from '../lib/format.ts';
  import { networks } from '../lib/networks.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import SourceHead from '../lib/SourceHead.svelte';

  let { capture }: { capture?: string } = $props();

  const source = $derived(argus.sourceFor(capture, true));
  const shown = $derived(source?.devices ?? []);
  /** A network chosen that this session never was on (one remembered from before it). */
  const before = $derived(!capture && !['now', 'all'].includes(networks.choice) && !argus.networks.some((n) => n.id === networks.choice) ? argus.netList.find((n) => n.id === networks.choice) : undefined);
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">Devices</h1>
    <p class="page-lede">
      {#if source}{source.devices.length === 1 ? 'One device' : `${source.devices.length} devices`} on the local network, the busiest
        first. The name is what each one said of itself (DHCP, mDNS, NetBIOS); the maker comes from the first half of the MAC.{:else}<span class="sk w60"
        ></span>{/if}
    </p>
    {#if source}<SourceHead {source} />{/if}
  </header>
  {#if source}
    {#if shown.length}
      <DeviceTable devices={shown} live={source.kind === 'live'} {capture} />
    {:else if before}
      <div class="empty-state">
        <h2>Not on {before.name} in this session</h2>
        <p>It was last heard {since(before.last)}. What it did is in the <a href={link.diary()}>Diary</a>, a day at a time; this session began after.</p>
      </div>
    {:else}
      <div class="empty-state">
        <h2>No devices yet</h2>
        <p>Turn an interface on in <a href="#/">Now</a>: devices show here as soon as they are heard.</p>
      </div>
    {/if}
  {:else if argus.captureProblem[capture ?? '']}
    <p class="error">{argus.captureProblem[capture ?? '']}</p>
  {/if}
</div>
