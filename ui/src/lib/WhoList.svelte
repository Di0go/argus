<script lang="ts">
  // Who is using the network now: one line per device that is doing something, its name, what it is, and what it is
  // doing in a verb ("Watching Netflix", "On a WhatsApp call") with since when, its last two minutes and how fast;
  // busiest first, a call ahead of a download. The quiet ones in one line under them. A device with traffic in the
  // clear in the last hour carries the colour that says so. The order holds still while the pointer is over it.
  import { keyOf } from '@organon/core/shared/entities';
  import type { Device } from '../../../shared/types.ts';
  import { BACKGROUND, doing } from '../../../shared/words.ts';
  import { argus } from './argus.svelte.ts';
  import ClearTag from './ClearTag.svelte';
  import EntityIcon from './EntityIcon.svelte';
  import EntityLink from './EntityLink.svelte';
  import { rate, span } from './format.ts';
  import Identity from './Identity.svelte';
  import Spark from './Spark.svelte';

  let { devices, limit = 8 }: { devices: Device[]; limit?: number } = $props();

  /** Busy: moving at least 2 KB/s, or doing something that is not the network's own chatter. */
  const clearFor = $derived.by(() => {
    const hour = Date.now() / 1000 - 3600;
    const out = new Map<string, { proto: string; credentials?: boolean }>();
    for (const c of Object.values(argus.conversations)) if (c.clear && !c.clear.harmless && c.last >= hour && !(c.b.startsWith('device:') && !c.clear.credentials)) out.set(c.a, c.clear);
    return out;
  });
  // The router carries everyone's traffic: it is the way out, not someone using the network.
  // Nor is this PC's Docker bridge: it carries the containers' traffic, which they show themselves.
  const bridge = (d: Device) => d.role === 'self' && Boolean(d.mac?.startsWith('02:42:'));
  // A device that sent something unencrypted in the last hour stays in the list, in the colour, quiet or not.
  const busy = (d: Device) => d.role !== 'gateway' && !bridge(d) && (clearFor.has(`device:${d.id}`) || ((argus.meters[d.id] ?? 0) >= 2048 || (d.doing ?? []).some((x) => !BACKGROUND.has(x.what?.category ?? ''))));
  const score = (d: Device) => (argus.meters[d.id] ?? 0) + ((d.doing ?? []).some((x) => x.what?.category === 'calls') ? 5e6 : 0);

  let hovering = $state(false);
  let order = $state<string[]>([]);
  let sortedAt = 0;
  $effect(() => {
    const ids = devices.filter(busy).map((d) => d.id);
    const same = ids.length === order.length && ids.every((id) => order.includes(id));
    if (same && (hovering || Date.now() - sortedAt < 4000)) return;
    sortedAt = Date.now();
    const byId = new Map(devices.map((d) => [d.id, d]));
    order = ids.sort((a, b) => score(byId.get(b)!) - score(byId.get(a)!));
  });
  const active = $derived(order.map((id) => devices.find((d) => d.id === id)).filter((d): d is Device => Boolean(d)));
  const quiet = $derived(devices.filter((d) => !order.includes(d.id)));
  const max = $derived(Math.max(1, ...active.map((d) => argus.meters[d.id] ?? 0)));

  /** What it is doing, headline first; the rest after a comma. */
  function said(d: Device): { now: string; since?: number } {
    const all = (d.doing ?? []).filter((x) => !BACKGROUND.has(x.what?.category ?? ''));
    const top = all[0] ?? d.doing?.[0];
    if (!top) return { now: clearFor.has(`device:${d.id}`) ? 'Quiet now; unencrypted in the last hour' : 'Moving data' };
    const rest = all.slice(1, 3).map((x) => doing(x.what).replace(/^./, (c) => c.toLowerCase()));
    return { now: [doing(top.what), ...rest].join(', '), since: top.since };
  }
</script>

{#if active.length}
  <ul class="who" aria-label="Who is using the network" onpointerenter={() => (hovering = true)} onpointerleave={() => (hovering = false)}>
    {#each active.slice(0, limit) as d (d.id)}
      {@const s = said(d)}
      {@const clear = clearFor.get(keyOf(d))}
      <li class:clear-row={clear} data-device={d.id}>
        <EntityIcon entity={d} size={32} />
        <span class="main">
          <span class="name"><EntityLink entity={d} /> <span class="id"><Identity device={d} /></span></span>
          <span class="doing"
            ><b>{s.now}</b>{#if s.since && Date.now() / 1000 - s.since > 60}<span class="for">{' for '}{span(Date.now() / 1000 - s.since)}</span>{/if}{#if clear}<ClearTag
                {clear}
                long
              />{/if}</span
          >
        </span>
        <span class="spark"><Spark series={argus.byDevice[d.id]} {max} seconds={120} width={110} height={26} /></span>
        <span class="rt">{rate(argus.meters[d.id])}</span>
      </li>
    {/each}
  </ul>
{:else}
  <p class="none">Nobody is using the network right now.</p>
{/if}
{#if quiet.length || active.length > limit}
  {@const rest = [...active.slice(limit), ...quiet]}
  <p class="quiet">
    {rest.length} quiet now:
    {#each rest.slice(0, 6) as d, i (d.id)}{i ? ', ' : ''}<EntityLink entity={d} />{/each}{rest.length > 6 ? `, and ${rest.length - 6} more` : ''}
  </p>
{/if}

<style>
  .who {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) 110px 84px;
    gap: 2px 14px;
    align-items: center;
    padding: 11px 6px 11px 0;
    border-bottom: 1px solid var(--rule);
  }

  li.clear-row {
    padding-left: 10px;
  }

  .main {
    display: grid;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .id {
    margin-left: 4px;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .doing {
    font-size: 0.98rem;
    color: var(--fg);
  }

  .doing b {
    font-weight: 600;
  }

  .doing :global(.clear-tag) {
    margin-left: 8px;
    vertical-align: 1px;
  }

  .for {
    color: var(--muted);
  }

  .rt {
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .quiet,
  .none {
    margin: 10px 0 0;
    font-size: 0.88rem;
    color: var(--muted);
  }

  .quiet :global(a) {
    color: var(--fg-2);
    font-weight: 400;
  }

  @media (max-width: 640px) {
    li {
      grid-template-columns: 28px minmax(0, 1fr) 70px;
    }

    .spark {
      display: none;
    }

    .id {
      display: block;
      margin: 0;
    }

    .name {
      white-space: normal;
    }
  }
</style>
