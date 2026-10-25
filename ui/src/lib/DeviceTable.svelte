<script lang="ts">
  // The devices, a row each: what it is and its name, its address, its maker, how fast it moves now and its last two
  // minutes (live), and how much in all. The order holds still while he reads it, as a radar screen keeps its tracks:
  // the busiest first, sorted again every ten seconds or when a device turns up, not on every tick, and never under
  // the pointer. A device that just turned up is marked for a minute; one quiet for five fades. Each says its network;
  // with a network chosen (networks.svelte.ts), its devices come first and the others' after, faded, or not at all.
  import type { Device } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import EntityIcon from './EntityIcon.svelte';
  import EntityLink from './EntityLink.svelte';
  import { bytes, rate, since } from './format.ts';
  import { subline } from './kinds.ts';
  import NetTag from './NetTag.svelte';
  import { networks } from './networks.svelte.ts';
  import Spark from './Spark.svelte';

  let {
    devices,
    live = false,
    capture,
    limit,
    byNetwork = false,
  }: { devices: Device[]; live?: boolean; capture?: string; limit?: number; byNetwork?: boolean } = $props();

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
  const split = $derived(byNetwork ? networks.split(devices) : { mine: devices, others: [] as Device[], network: null });
  const rows = $derived.by(() => {
    const by = new Map(devices.map((d) => [d.id, d]));
    const sorted = order.map((id) => by.get(id)).filter((d): d is Device => Boolean(d));
    for (const d of devices) if (!order.includes(d.id)) sorted.push(d);
    const mine = new Set(split.mine.map((d) => d.id));
    const others = new Set(split.others.map((d) => d.id));
    const out = [...sorted.filter((d) => mine.has(d.id)), ...sorted.filter((d) => others.has(d.id))];
    return limit ? out.slice(0, limit) : out;
  });
  /** The first row of the other networks' devices, under which a line says so. */
  const firstOther = $derived(rows.find((d) => split.network && !d.interfaces.includes(split.network))?.id);
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
        <th class="hide-s net-h">Rede</th>
        <th class="hide-m">Fabricante</th>
        {#if live}<th class="num">Agora</th><th class="hide-s"><span class="sr">Últimos dois minutos</span></th>{/if}
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as d (d.id)}
        {#if d.id === firstOther}
          <tr class="others-h"><td colspan="8">De outras redes</td></tr>
        {/if}
        <tr class:quiet={quiet(d)} class:other={split.network && !d.interfaces.includes(split.network)} data-device={d.id}>
          <td class="name">
            <span class="who">
              <EntityIcon entity={d} size={26} />
              <span class="nm">
                <EntityLink entity={d} {capture} />
                <span class="sub"
                  ><span class="show-s"><NetTag ids={d.interfaces} compact /></span>{subline(d)}{#if live && argus.isNew(d)}<span class="tag solid">novo</span>{/if}{#if quiet(d)}<span class="q"
                      >{since(d.lastSeen)}</span
                    >{/if}</span
                >
              </span>
            </span>
          </td>
          <td class="mono hide-s">{d.ips[0] ?? '—'}{#if d.ips.length > 1}<span class="more"> +{d.ips.length - 1}</span>{/if}</td>
          <td class="hide-s net"><NetTag ids={d.interfaces} /></td>
          <td class="hide-m vendor" title={d.vendor}>
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

  /* The name and the maker give way: they shrink, cut with an ellipsis, so the figures on the right are always whole
     (a long name widened the table past its box, and Total was cut off). max-width: 0 lets a cell of an auto table go
     below its text's width; the width says how the room left is shared. */
  .devices td.name {
    width: 58%;
    max-width: 0;
  }

  .devices td.vendor {
    width: 42%;
    max-width: 0;
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
    min-width: 104px;
  }

  .devices td.mono {
    white-space: nowrap;
  }

  tr.quiet,
  tr.other {
    opacity: 0.55;
  }

  .devices td.net {
    white-space: nowrap;
  }

  .others-h td {
    padding-top: 18px;
    font-size: 0.76rem;
    font-weight: 500;
    color: var(--muted);
  }

  .show-s {
    display: none;
  }

  .show-s :global(.nets) {
    flex-wrap: nowrap;
  }

  .show-s::after {
    content: '·';
    margin-left: 6px;
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

    .show-s {
      display: inline-flex;
    }
  }
</style>
