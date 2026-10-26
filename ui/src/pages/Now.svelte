<script lang="ts">
  // Now, the home page, as a system monitor reads: who is using the network now and for what, a line each (the
  // device, what it is doing in words, how fast now), busiest first; then whom they are talking to
  // now. Both move every second. Where Argus listens is the bar above every page (NetBar); the day, the diary, privacy
  // and the internet are a click away in the ribbon (docs/apresentacao.md).
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import { saying, score, split, talkers } from '../lib/active.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import EntityIcon from '../lib/EntityIcon.svelte';
  import { rate } from '../lib/format.ts';
  import Limits from '../lib/Limits.svelte';
  import { networks } from '../lib/networks.svelte.ts';
  import { Ranked } from '../lib/ranked.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { talks } from '../lib/talks.ts';
  import TalkTable from '../lib/TalkTable.svelte';
  import type { Conversation, Device } from '../../../shared/types.ts';
  import ClearTag from '../lib/ClearTag.svelte';

  const s = $derived(argus.session);
  const on = $derived(s?.listening.filter((l) => l.on) ?? []);
  const seen = $derived(Boolean(s?.packets));
  // The network chosen on Devices, when the others are hidden there, is the one shown here too.
  const devices = $derived(networks.hideOthers && networks.selected ? networks.split(argus.liveSource.devices).mine : argus.liveSource.devices);
  const groups = $derived(split(devices, argus.interfaces, argus.meters, talkers(argus.liveSource.conversations)));
  // By the number shown, re-sorted every three seconds: what a glance reads is what the order says.
  const rank = new Ranked(3000);
  $effect(() => rank.update(groups.active.map((d) => d.id), (id) => score(devices.find((d) => d.id === id)!, argus.meters[id] ?? 0)));
  const active = $derived(rank.order.map((id) => devices.find((d) => d.id === id)).filter((d): d is Device => Boolean(d)));
  const max = $derived(Math.max(1, ...active.map((d) => argus.meters[d.id] ?? 0)));
  // Whom the devices shown are talking to (the router carries everyone's: its own lines are not the house's).
  const keys = $derived(new Set(devices.map((d) => `device:${d.id}`)));
  // A device that sent something without encryption in the last hour (a login in the clear even inside the house): its
  // small padlock by its name, the detail in its tip.
  const clearFor = $derived.by(() => {
    const hour = Date.now() / 1000 - 3600;
    const out = new Map<string, NonNullable<Conversation['clear']>>();
    for (const c of argus.liveSource.conversations)
      if (c.clear && !c.clear.harmless && c.last >= hour && (c.b.startsWith('remote:') || c.clear.credentials) && !out.get(c.a)?.credentials) out.set(c.a, c.clear);
    return out;
  });
  const now = $derived(talks(argus.liveSource).filter((t) => t.device && keys.has(`device:${t.device.id}`) && t.device.role !== 'gateway'));
</script>

<div class="page now">
  <header class="head">
    <h1 class="page-title">Who is using the network</h1>
    {#if on.length && seen}<p class="live" title="The rates and the lists follow the network each second, without reloading"><i aria-hidden="true"></i>Live, every second</p>{/if}
  </header>

  {#if !argus.live.loaded}
    <div class="sk tall w30" aria-hidden="true"></div>
  {:else if !seen}
    <div class="empty-state">
      <h2>{on.length ? 'Listening' : 'Not listening yet'}</h2>
      <p>
        {on.length
          ? 'The first packets show here as soon as they arrive. On a quiet network they may take a few seconds.'
          : 'Choose a network in the bar above: the Wi-Fi, the cable or the VPN, one or several. It stays on until you turn it off, even if you close this page.'}
      </p>
    </div>
    <Limits />
  {:else}
    {#if active.length}
      <ul class="rows" aria-label="Who is using the network" onpointerenter={() => (rank.hold = true)} onpointerleave={() => (rank.hold = false)}>
        {#each active as d (d.id)}
          <li data-device={d.id} animate:flip={{ duration: 400 }} in:fade={{ duration: 300 }}>
            <a class="row" href={link.device(d.id)}>
              <EntityIcon entity={d} size={30} />
              <span class="name"><b>{d.name}</b>{#if clearFor.get(`device:${d.id}`)}<ClearTag clear={clearFor.get(`device:${d.id}`)!} inLink />{/if}</span>
              <span class="doing">{saying(d).now}</span>
              <span class="now-rt"><span class="bar" style:width="{Math.max(2, 60 * Math.sqrt((argus.meters[d.id] ?? 0) / max))}px"></span><span class="rt"
                  >{rate(argus.meters[d.id])}</span
                ></span>
            </a>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none">Nobody is using the network right now.</p>
    {/if}
    {#if groups.quiet.length}
      <p class="quiet"><a href={link.devices()}>{groups.quiet.length} more {groups.quiet.length === 1 ? 'device' : 'devices'}, quiet now</a></p>
    {/if}

    <section class="talking" aria-labelledby="talk-h">
      <h2 id="talk-h">Talking to now</h2>
      <TalkTable talks={now} limit={4} from={new Set(now.slice(0, 4).map((t) => t.device?.id)).size > 1} />
    </section>
  {/if}
</div>

<style>
  .now {
    padding-top: 32px;
  }

  .head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin-bottom: 20px;
  }

  .head .page-title {
    margin: 0;
    font-size: 1.7rem;
  }

  .live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: 0.84rem;
    color: var(--muted);
  }

  .live i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--solid);
    animation: beat 2s var(--ease) infinite;
  }

  @keyframes beat {
    50% {
      opacity: 0.35;
    }
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--rule);
  }

  .row {
    display: grid;
    grid-template-columns: 30px minmax(10em, 14em) minmax(0, 1fr) 11em;
    align-items: center;
    gap: 14px;
    padding: 10px 8px;
    border-bottom: 1px solid var(--rule);
    color: var(--fg);
  }

  .row:hover {
    background: var(--hover);
    text-decoration: none;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name b {
    font-weight: 600;
  }

  .name :global(.clear-tag) {
    margin-left: 7px;
  }

  .doing {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .now-rt {
    text-align: right;
    white-space: nowrap;
  }

  .bar {
    display: inline-block;
    height: 6px;
    margin-right: 10px;
    border-radius: 3px;
    background: var(--data);
    opacity: 0.55;
    vertical-align: middle;
    transition: width 0.6s var(--ease);
  }

  .rt {
    display: inline-block;
    min-width: 5.5em;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .quiet,
  .none {
    margin: 10px 0 0;
    font-size: 0.86rem;
    color: var(--muted);
  }

  .quiet a {
    color: var(--muted);
  }

  .talking {
    margin-top: 36px;
  }

  .talking h2 {
    margin: 0 0 8px;
    font-size: 1.02rem;
    font-weight: 600;
  }

  .empty-state {
    padding: 8px 0 16px;
  }

  @media (max-width: 760px) {
    .row {
      grid-template-columns: 28px minmax(0, 1fr) 5.5em;
      grid-template-areas: 'icon name rt' 'icon doing doing';
      gap: 2px 12px;
    }

    .row > :global(.ei) {
      grid-area: icon;
    }

    .name {
      grid-area: name;
    }

    .doing {
      grid-area: doing;
      font-size: 0.86rem;
      color: var(--fg-2);
    }

    .now-rt {
      grid-area: rt;
    }

    .bar {
      display: none;
    }
  }
</style>
