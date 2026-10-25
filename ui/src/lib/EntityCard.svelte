<script lang="ts">
  // An entity's card, in the hover card: what it is, its addresses, how much it moved, and its busiest links.
  import type { Device, Remote } from '../../../shared/types.ts';
  import { bytes } from './format.ts';
  import { argus } from './state.svelte.ts';

  let { key }: { key: string } = $props();
  const e = $derived(argus.graph.get(key) as Device | Remote | undefined);
  const top = $derived(e ? argus.graph.linked(key).slice(0, 3) : []);
</script>

{#if e}
  <div class="card">
    <p class="title">{e.name}</p>
    {#if e.summary}<p class="muted">{e.summary}</p>{/if}
    {#if e.kind === 'device' && e.mac}<p class="mono">{e.mac}</p>{/if}
    <p>Enviou {bytes(e.bytesSent)} · recebeu {bytes(e.bytesReceived)}</p>
    {#if top.length}
      <p class="muted">Falou mais com: {top.map((n) => n.entity.name).join(', ')}</p>
    {/if}
  </div>
{/if}

<style>
  .card p {
    margin: 0 0 4px;
  }
  .title {
    font-weight: 600;
  }
</style>
