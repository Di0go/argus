<script lang="ts">
  // The network a device is on, at a glance: the interface's mark and its name (Wi-Fi, Docker, VPN), one per network
  // it was heard on. A link to the interface, with its card.
  import type { Interface } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import EntityIcon from './EntityIcon.svelte';
  import { link } from './router.svelte.ts';

  let { ids, compact = false }: { ids: string[]; compact?: boolean } = $props();
  const nets = $derived(ids.map((id) => ({ id, iface: argus.interfaces.find((i) => i.id === id) as Interface | undefined })));
</script>

<span class="nets" class:compact>
  {#each nets as n (n.id)}
    <a class="net" href={link.interface(n.id)} data-tip-entity={n.iface ? `interface:${n.id}` : undefined} title={n.iface ? undefined : n.id}>
      {#if n.iface}<EntityIcon entity={n.iface} size={compact ? 16 : 22} />{/if}<span class="nn">{n.iface?.name ?? n.id}</span>
    </a>
  {/each}
</span>

<style>
  .nets {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    min-width: 0;
  }

  .net {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--fg-2);
    font-size: 0.84rem;
    white-space: nowrap;
  }

  .net:hover {
    color: var(--acc);
    text-decoration: none;
  }

  .net :global(.ei) {
    border-radius: 4px;
    background: none;
    color: inherit;
  }

  .compact .net {
    gap: 3px;
    font-size: inherit;
    color: inherit;
  }
</style>
