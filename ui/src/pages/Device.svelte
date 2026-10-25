<script lang="ts">
  // One device: what it is and where each fact came from (its names and who said them, its addresses, its maker), how
  // much it moved and how fast it moves now, its bandwidth over the last minutes and the day, the companies and hosts
  // it talks to, the devices here it talks to, and the other devices that talk to the same companies.
  import { getJson } from '@organon/core/ui/live';
  import { keyOf } from '@organon/core/shared/entities';
  import type { Device, SeriesData } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import Conversations from '../lib/Conversations.svelte';
  import EntityIcon from '../lib/EntityIcon.svelte';
  import EntityLink from '../lib/EntityLink.svelte';
  import { bytes, rate, since, when } from '../lib/format.ts';
  import HostList from '../lib/HostList.svelte';
  import { KIND_WORD, deviceKind, subline } from '../lib/kinds.ts';
  import NetTag from '../lib/NetTag.svelte';
  import RateChart from '../lib/RateChart.svelte';
  import { link } from '../lib/router.svelte.ts';
  import Seg from '../lib/Seg.svelte';
  import SourceHead from '../lib/SourceHead.svelte';

  let { id, capture }: { id: string; capture?: string } = $props();

  const source = $derived(argus.sourceFor(capture));
  const live = $derived(source?.kind === 'live');
  const d = $derived(source?.graph.get(`device:${id}`) as Device | undefined);
  const key = $derived(`device:${id}`);
  const talks = $derived(source ? source.conversations.filter((c) => c.a === key || c.b === key) : []);
  const linked = $derived(d && source ? source.graph.linked(key) : []);
  const sites = $derived(linked.filter((n) => n.entity.kind === 'site'));
  const hosts = $derived(linked.filter((n) => n.entity.kind === 'remote'));
  const locals = $derived(linked.filter((n) => n.entity.kind === 'device'));
  const unnamed = $derived(hosts.filter((n) => !sites.some((s) => (s.entity.kind === 'site' ? s.entity.hosts.includes(n.entity.id) : false))));
  const others = $derived(d && source ? source.graph.twoSteps(key, 'uses', 'uses').filter((o) => o.entity.kind === 'device') : []);
  let period = $state<'minutes' | 'day'>('minutes');
  const PERIODS = [
    { id: 'minutes' as const, label: '10 min' },
    { id: 'day' as const, label: 'Today' },
  ];
  let coarse = $state<SeriesData | null>(null);

  $effect(() => {
    if (!live || period !== 'day') return;
    void getJson<{ coarse?: SeriesData }>(`/api/live/devices/${encodeURIComponent(id)}`).then((s) => (coarse = s.coarse ?? null));
  });
</script>

<div class="page">
  <header class="page-head">
    <p class="crumbs"><a href={link.devices(capture)}>Devices</a><span class="sep">/</span>{d?.name ?? id}</p>
    {#if d}
      <div class="title">
        <EntityIcon entity={d} size={46} />
        <div>
          <h1 class="page-title">{d.name}</h1>
          <p class="who">
            {d.role === 'gateway' ? 'The way out to the internet' : subline(d) || KIND_WORD[deviceKind(d)]}{d.model && d.role ? `, ${d.model}` : ''}
            {#if d.interfaces.length}<span class="on-net">on <NetTag ids={d.interfaces} /></span>{/if}
          </p>
        </div>
      </div>
      {#if source}<SourceHead {source} />{/if}
      <dl class="props">
        <dt>MAC</dt>
        <dd class="mono">
          {d.mac ?? 'none: seen by its address'}{#if d.randomMac}
            <span class="tag" data-tip="Phones and laptops make up a MAC on every network, so they are not followed from network to network."
              >private</span
            >{/if}
        </dd>
        <dt>Addresses</dt>
        <dd class="mono">{d.ips.join(', ') || '—'}</dd>
        <dt>Maker</dt>
        <dd>{d.vendor ?? (d.randomMac ? 'Cannot be seen: the device made its MAC up' : 'Unknown')}</dd>
        <dt>Names</dt>
        <dd>
          {#each d.names as n, i (n.name)}{i ? ', ' : ''}{n.name} <span class="src" data-tip={SOURCES[n.source]}>{n.source}</span>{:else}<span
              class="muted">Did not say its name</span
            >{/each}
        </dd>
        <dt>Network</dt>
        <dd><NetTag ids={d.interfaces} />{#if d.interfaces.length > 1}<span class="muted small"> (heard on {d.interfaces.length})</span>{/if}</dd>
        <dt>Seen</dt>
        <dd>{when(d.firstSeen)} to {when(d.lastSeen)}{live ? ` (${since(d.lastSeen)})` : ''}</dd>
      </dl>
    {:else}
      <h1 class="page-title">{source ? 'Not seen' : ''}</h1>
      {#if source}<p class="page-lede">{live ? 'The live session has not seen it yet (or has forgotten it).' : 'This capture did not see it.'}</p>{/if}
    {/if}
  </header>

  {#if d}
    <section class="band">
      <div class="stats">
        <div class="stat"><span class="stat-v">{bytes(d.bytesSent)}</span><span class="stat-l">sent</span></div>
        <div class="stat"><span class="stat-v">{bytes(d.bytesReceived)}</span><span class="stat-l">received</span></div>
        <div class="stat"><span class="stat-v">{d.packets.toLocaleString('en-GB')}</span><span class="stat-l">packets</span></div>
        {#if live}<div class="stat"><span class="stat-v">{rate(argus.meters[d.id])}</span><span class="stat-l">now</span></div>{/if}
      </div>
      {#if live && argus.byDevice[d.id]}
        <div class="band-h">
          <h2>Bandwidth</h2>
<Seg bind:value={period} label="Period" options={PERIODS} />
        </div>
        {#if period === 'minutes'}
          <RateChart series={argus.byDevice[d.id]!} label="Bandwidth of {d.name}" seconds={600} height={180} since={d.firstSeen} />
        {:else if coarse}
          <RateChart series={coarse} label="Bandwidth of {d.name}, today" height={180} since={d.firstSeen} />
        {/if}
      {/if}
    </section>

    {#if source}
      <section class="band">
        <Conversations conversations={talks} me={new Set([key])} {source} {capture} />
      </section>
    {/if}

    <div class="bands">
      <section class="band">
        <div class="band-h">
          <h2>On the internet, talks to</h2>
          <span class="aside">{hosts.length === 1 ? '1 host' : `${hosts.length} hosts`}</span>
        </div>
        {#if sites.length || unnamed.length}
          <HostList items={sites.map((n) => n.entity).filter((e) => e.kind === 'site')} {capture} {live} label="Companies and sites" />
          {#if unnamed.length}
            <p class="sub-h">No name seen</p>
            <HostList items={unnamed.map((n) => n.entity).filter((e) => e.kind === 'remote').slice(0, 12)} {capture} {live} label="Hosts with no name" aside={() => ''} />
          {/if}
        {:else}
          <p class="empty">
            {d.role === 'self' || d.role === 'gateway'
              ? 'Nothing yet.'
              : 'Not seen talking to the internet from here. On a PC on an ordinary network, the other devices\' traffic out does not pass through here.'}
          </p>
        {/if}
      </section>
      <section class="band">
        <div class="band-h"><h2>On the local network, talks to</h2></div>
        <ul class="recs" aria-label="On the local network">
          {#each locals as n (keyOf(n.entity))}
            <li class="rec"><span class="rec-t"><EntityLink entity={n.entity} {capture} /></span><span class="rec-m">{bytes(n.weight)}</span></li>
          {:else}
            <li class="rec empty">Only announcements to everyone (broadcast and multicast), nothing direct.</li>
          {/each}
        </ul>
        {#if others.length}
          <p class="sub-h">Use the same companies</p>
          <ul class="recs" aria-label="Use the same companies">
            {#each others.slice(0, 8) as o (keyOf(o.entity))}
              <li class="rec plain">
                <span class="rec-t"><EntityLink entity={o.entity} {capture} /></span><span class="rec-m"
                  >{o.via
                    .slice(0, 3)
                    .map((v) => v.name)
                    .join(', ')}</span
                >
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/if}
</div>

<script module lang="ts">
  /** Where each name came from, said plainly. */
  const SOURCES: Record<string, string> = {
    DHCP: 'The name the device itself gave when asking the router for an address (DHCP).',
    mDNS: 'The name the device itself announces on the local network (mDNS, Bonjour).',
    NetBIOS: 'The name a Windows PC announces on the local network (NetBIOS).',
    DNS: 'The name a DNS answer gave this address.',
    TLS: 'The server name asked for when opening the encrypted connection (TLS SNI).',
  };
</script>

<style>
  .title {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .who {
    margin: 4px 0 0;
    color: var(--muted);
  }

  .on-net {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 10px;
    padding-left: 10px;
    border-left: 1px solid var(--rule-strong);
  }

  .src {
    font-size: 0.74rem;
    color: var(--faint);
    cursor: help;
  }


  .stats {
    margin-bottom: 24px;
  }

  .sub-h {
    margin: 18px 0 4px;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--muted);
  }
</style>
