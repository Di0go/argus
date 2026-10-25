<script lang="ts">
  // One saved capture, as it was: when and where, its devices and the companies out on the internet they talked to.
  // Every link from here stays in it (?c=<id>), so its pages show it and not the live session.
  import { argus } from '../lib/argus.svelte.ts';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import { bytes, span, when } from '../lib/format.ts';
  import HostList from '../lib/HostList.svelte';
  import { link } from '../lib/router.svelte.ts';

  let { id }: { id: string } = $props();
  const source = $derived(argus.sourceFor(id));
  const c = $derived(source?.capture ?? argus.captures.find((x) => x.id === id));
</script>

<div class="page">
  <header class="page-head">
    <p class="crumbs"><a href={link.captures()}>Captures</a><span class="sep">/</span>{c ? when(c.started) : id}</p>
    <h1 class="page-title">{c ? `Capture of ${when(c.started)}` : 'Capture'}</h1>
    {#if c}
      <p class="page-lede">
        {c.interfaces.join(', ')}, {span(c.seconds)}: {(c.packets ?? 0).toLocaleString('en-GB')} packets, {bytes(c.bytes ?? 0)}.
      </p>
    {/if}
  </header>
  {#if source}
    <div class="bands main">
      <section class="band">
        <div class="band-h"><h2>On the local network</h2><a href={link.devices(id)}>{source.devices.length} devices</a></div>
        <DeviceTable devices={source.devices} capture={id} />
      </section>
      <section class="band">
        <div class="band-h"><h2>On the internet</h2><a href={link.internet(id)}>{source.remotes.length} hosts</a></div>
        <HostList items={source.sites.slice(0, 12)} capture={id} label="Companies and sites" />
      </section>
    </div>
  {:else if argus.captureProblem[id]}
    <p class="error">{argus.captureProblem[id]}</p>
  {:else}
    <div class="sk w60"></div>
  {/if}
</div>

<style>
  .main {
    grid-template-columns: minmax(0, 1.9fr) minmax(260px, 1fr);
  }

  @media (max-width: 1100px) {
    .main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
