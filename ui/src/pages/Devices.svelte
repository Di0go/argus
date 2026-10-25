<script lang="ts">
  // Every device the live session (or a saved capture) saw, busiest first, each with its network; one network first,
  // or alone, if he chooses (NetFilter).
  import { argus } from '../lib/argus.svelte.ts';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import NetFilter from '../lib/NetFilter.svelte';
  import SourceHead from '../lib/SourceHead.svelte';

  let { capture }: { capture?: string } = $props();

  const source = $derived(argus.sourceFor(capture));
  const shown = $derived(source?.devices ?? []);
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
      <div class="filter"><NetFilter devices={shown} /></div>
      <DeviceTable devices={shown} live={source.kind === 'live'} {capture} byNetwork />
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

<style>
  .filter {
    display: flex;
    justify-content: flex-end;
    margin: -12px 0 8px;
  }
</style>
