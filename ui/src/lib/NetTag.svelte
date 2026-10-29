<script lang="ts">
  // The networks a device was heard on, at a glance: each by its interface's mark and its name (its Wi-Fi's, else its
  // router's), the latest first; where the session told no network apart (a capture of before), its interfaces. A link
  // to the interface, with its card. In a network's view, the ones it was also heard on are said apart (`elsewhere`),
  // so a device that is here now is not mistaken for one that was only seen here once.
  import type { Device, Interface } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import EntityIcon from './EntityIcon.svelte';
  import { link } from './router.svelte.ts';

  let { device, compact = false }: { device: Device; compact?: boolean } = $props();
  const iface = (id: string) => argus.interfaces.find((i) => i.id === id) as Interface | undefined;
  const elsewhere = $derived((device.elsewhere ?? []).map((id) => argus.netList.find((n) => n.id === id)?.name ?? id));
  const nets = $derived(
    device.networks?.length
      ? device.networks.map((id) => {
          const n = argus.netList.find((x) => x.id === id);
          const at = n?.interfaces.find((i) => device.interfaces.includes(i)) ?? n?.interfaces[0] ?? device.interfaces[0] ?? '';
          return { key: id, at, iface: iface(at), name: n?.name ?? id };
        })
      : device.interfaces.map((id) => ({ key: id, at: id, iface: iface(id), name: iface(id)?.name ?? id })),
  );
</script>

<span class="nets" class:compact>
  {#each nets as n (n.key)}
    <a class="net" href={link.interface(n.at)} data-tip-entity={n.iface ? `interface:${n.at}` : undefined} title={n.iface ? undefined : n.at}>
      {#if n.iface}<EntityIcon entity={n.iface} size={compact ? 16 : 22} />{/if}<span class="nn">{n.name}</span>
    </a>
  {/each}
  {#if elsewhere.length}
    <span class="also" title="Also heard on {elsewhere.join(', ')}" aria-label="Also heard on {elsewhere.join(', ')}">+{elsewhere.length} elsewhere</span>
  {/if}
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

  .nn {
    overflow: hidden;
    text-overflow: ellipsis;
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

  .also {
    font-size: 0.74rem;
    color: var(--faint);
    white-space: nowrap;
  }
</style>
