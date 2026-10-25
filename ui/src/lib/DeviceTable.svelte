<script lang="ts">
  // The devices, a row each: what it is and its name, its address, its maker, how fast it moves now and its last two
  // minutes (live), and how much in all. The order holds still while he reads it, as a radar screen keeps its tracks:
  // the busiest first, sorted again every ten seconds or when a device turns up, not on every tick, and never under
  // the pointer. A device that just turned up is marked for a minute; one quiet for five fades.
  import type { Device } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import EntityIcon from './EntityIcon.svelte';
  import EntityLink from './EntityLink.svelte';
  import { bytes, rate, since } from './format.ts';
  import { subline } from './kinds.ts';
  import Spark from './Spark.svelte';

  let { devices, live = false, capture, limit }: { devices: Device[]; live?: boolean; capture?: string; limit?: number } = $props();

  let order = $state<string[]>([]);
  let hovering = $state(false);
  let sortedAt = 0;

  const total = (d: Device) => d.bytesSent + d.bytesReceived;
  $effect(() => {
    const ids = devices.map((d) => d.id);
    const known = new Set(order);
    const arrived = ids.some((id) => !known.has(id));
    const now = Date.now();
    if (hovering && !arrived) return;
    if (!arrived && order.length === ids.length && now - sortedAt < 10_000) return;
    sortedAt = now;
    order = [...devices].sort((a, b) => total(b) - total(a)).map((d) => d.id);
  });
  const rows = $derived.by(() => {
    const by = new Map(devices.map((d) => [d.id, d]));
    const out = order.map((id) => by.get(id)).filter((d): d is Device => Boolean(d));
    for (const d of devices) if (!order.includes(d.id)) out.push(d);
    return limit ? out.slice(0, limit) : out;
  });
  /** The busiest device's busiest second in the last two minutes: the sparks' common scale. */
  const peak = $derived(
    Math.max(
      1,
      ...rows.map((d) => {
        const s = argus.byDevice[d.id];
        if (!s) return 0;
        let m = 0;
        for (let i = Math.max(0, s.sent.length - 120); i < s.sent.length; i++) m = Math.max(m, (s.sent[i] ?? 0) + (s.received[i] ?? 0));
        return m;
      }),
    ),
  );
  const quiet = (d: Device) => live && Date.now() / 1000 - d.lastSeen > 300;
</script>

<div class="records-wrap">
  <table class="records devices" aria-label="Dispositivos" onpointerenter={() => (hovering = true)} onpointerleave={() => (hovering = false)}>
    <thead>
      <tr>
        <th>Dispositivo</th>
        <th class="hide-s">Endereço</th>
        <th class="hide-m">Fabricante</th>
        {#if live}<th class="num">Agora</th><th class="hide-s"><span class="sr">Últimos dois minutos</span></th>{/if}
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as d (d.id)}
        <tr class:quiet={quiet(d)} data-device={d.id}>
          <td>
            <span class="who">
              <EntityIcon entity={d} size={26} />
              <span class="nm">
                <EntityLink entity={d} {capture} />
                <span class="sub"
                  >{subline(d)}{#if live && argus.isNew(d)}<span class="tag solid">novo</span>{/if}{#if quiet(d)}<span class="q"
                      >{since(d.lastSeen)}</span
                    >{/if}</span
                >
              </span>
            </span>
          </td>
          <td class="mono hide-s">{d.ips[0] ?? '—'}{#if d.ips.length > 1}<span class="more"> +{d.ips.length - 1}</span>{/if}</td>
          <td class="hide-m vendor">
            {#if d.vendor}{d.vendor}{:else if d.randomMac}<span
                class="muted"
                data-tip="O dispositivo inventou esta MAC (os telemóveis e os portáteis fazem-no em cada rede), por isso não diz o fabricante."
                >MAC privada</span
              >{:else}<span class="muted">—</span>{/if}
          </td>
          {#if live}
            <td class="num rate">{rate(argus.meters[d.id])}</td>
            <td class="hide-s spark"><Spark series={argus.byDevice[d.id]} max={peak} /></td>
          {/if}
          <td class="num">{bytes(total(d))}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .devices td {
    vertical-align: middle;
  }

  .devices td.num,
  .devices th.num {
    white-space: nowrap;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .nm {
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-width: 26rem;
    line-height: 1.35;
  }

  /* A name from the network can be 100 characters: one line, cut with an ellipsis; the card and the page say it whole. */
  .nm :global(.el) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow-wrap: normal;
  }

  .sub {
    overflow: hidden;
    white-space: nowrap;
  }

  .sub {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    font-size: 0.76rem;
    color: var(--faint);
  }

  .sub .tag {
    line-height: 1.5;
  }

  .more {
    color: var(--faint);
  }

  .vendor {
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
  }

  .rate {
    min-width: 6.5em;
    color: var(--fg);
    font-weight: 500;
  }

  .spark {
    width: 104px;
  }

  tr.quiet {
    opacity: 0.55;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  @media (max-width: 1100px) {
    .hide-m {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .hide-s {
      display: none;
    }
  }
</style>
