<script lang="ts">
  // One company or site: the names its hosts went by, its hosts, and which devices here use it and how much.
  import { keyOf } from '@organon/core/shared/entities';
  import type { Remote, Site } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import EntityIcon from '../lib/EntityIcon.svelte';
  import EntityLink from '../lib/EntityLink.svelte';
  import Conversations from '../lib/Conversations.svelte';
  import { bytes, since } from '../lib/format.ts';
  import HostList from '../lib/HostList.svelte';
  import { link } from '../lib/router.svelte.ts';
  import SourceHead from '../lib/SourceHead.svelte';

  let { id, capture }: { id: string; capture?: string } = $props();
  const source = $derived(argus.sourceFor(capture));
  const live = $derived(source?.kind === 'live');
  const s = $derived(source?.graph.get(`site:${id}`) as Site | undefined);
  const hosts = $derived(s && source ? s.hosts.map((h) => source.graph.get(`remote:${h}`)).filter((r): r is Remote => Boolean(r)) : []);
  const talks = $derived(s && source ? source.conversations.filter((c) => s.hosts.includes(c.b.slice('remote:'.length)) && c.b.startsWith('remote:')) : []);
  const users = $derived(s && source ? source.graph.linked(`site:${id}`).filter((n) => n.entity.kind === 'device') : []);
</script>

<div class="page">
  <header class="page-head">
    <p class="crumbs"><a href={link.internet(capture)}>On the internet</a><span class="sep">/</span>{s?.name ?? id}</p>
    {#if s}
      <div class="title">
        <EntityIcon entity={s} size={46} />
        <div>
          <h1 class="page-title">{s.name}</h1>
          <p class="who">{s.sites.join(', ')}</p>
        </div>
      </div>
      {#if source}<SourceHead {source} />{/if}
    {:else if source}
      <h1 class="page-title">Not seen</h1>
    {/if}
  </header>
  {#if s}
    <div class="stats">
      <div class="stat"><span class="stat-v">{bytes(s.bytesReceived)}</span><span class="stat-l">received from here</span></div>
      <div class="stat"><span class="stat-v">{bytes(s.bytesSent)}</span><span class="stat-l">sent here</span></div>
      <div class="stat"><span class="stat-v">{hosts.length}</span><span class="stat-l">hosts</span></div>
      {#if live}<div class="stat"><span class="stat-v">{since(s.lastSeen)}</span><span class="stat-l">last time</span></div>{/if}
    </div>
    <div class="bands">
      <section class="band">
        <div class="band-h"><h2>Who uses it</h2></div>
        <ul class="recs" aria-label="Who uses it">
          {#each users as n (keyOf(n.entity))}
            <li class="rec acc"><span class="rec-t"><EntityLink entity={n.entity} {capture} /></span><span class="rec-m">{bytes(n.weight)}</span></li>
          {:else}
            <li class="rec empty">No device from here.</li>
          {/each}
        </ul>
      </section>
      <section class="band">
        <div class="band-h"><h2>Hosts</h2></div>
        <HostList items={hosts} {capture} {live} label="Hosts" aside={(x) => (x.kind === 'remote' ? x.ip : '')} />
      </section>
    </div>
    {#if source}
      <section class="band">
        <Conversations conversations={talks} {source} {capture} />
      </section>
    {/if}
  {/if}
</div>

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

  .stats {
    margin-bottom: 36px;
  }
</style>
