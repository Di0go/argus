<script lang="ts">
  // Every device the live session (or a saved capture) saw, busiest first, by interface if he wants.
  import { argus } from '../lib/argus.svelte.ts';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import SourceHead from '../lib/SourceHead.svelte';

  let { capture }: { capture?: string } = $props();
  let only = $state<string | null>(null);

  const source = $derived(argus.sourceFor(capture));
  const ifaces = $derived([...new Set(source?.devices.flatMap((d) => d.interfaces) ?? [])]);
  const shown = $derived(source ? source.devices.filter((d) => !only || d.interfaces.includes(only)) : []);
  const ifaceName = (id: string) => argus.interfaces.find((i) => i.id === id)?.name ?? id;
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">Dispositivos</h1>
    <p class="page-lede">
      {#if source}{source.devices.length === 1 ? 'Um dispositivo' : `${source.devices.length} dispositivos`} na rede local, os mais ocupados
        primeiro. O nome é o que cada um disse de si (DHCP, mDNS, NetBIOS); o fabricante vem da primeira metade da MAC.{:else}<span class="sk w60"
        ></span>{/if}
    </p>
    {#if source}<SourceHead {source} />{/if}
  </header>
  {#if ifaces.length > 1}
    <div class="chips filter" role="group" aria-label="Interface">
      <button class="chip" class:on={!only} onclick={() => (only = null)}>Todas</button>
      {#each ifaces as i (i)}<button class="chip" class:on={only === i} onclick={() => (only = i)}>{ifaceName(i)}</button>{/each}
    </div>
  {/if}
  {#if source}
    {#if shown.length}
      <DeviceTable devices={shown} live={source.kind === 'live'} {capture} />
    {:else}
      <div class="empty-state">
        <h2>Nenhum dispositivo ainda</h2>
        <p>Liga uma interface em <a href="#/">Agora</a>: os dispositivos aparecem aqui assim que se ouvem.</p>
      </div>
    {/if}
  {:else if argus.captureProblem[capture ?? '']}
    <p class="error">{argus.captureProblem[capture ?? '']}</p>
  {/if}
</div>

<style>
  .filter {
    margin: -12px 0 20px;
  }
</style>
