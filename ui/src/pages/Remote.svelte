<script lang="ts">
  // One host out on the internet: its address, the names it went by and who said them, who runs it, how much went
  // each way, and which devices here talked to it.
  import type { Remote } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import EntityIcon from '../lib/EntityIcon.svelte';
  import EntityLink from '../lib/EntityLink.svelte';
  import Conversations from '../lib/Conversations.svelte';
  import { bytes, since, when } from '../lib/format.ts';
  import { link } from '../lib/router.svelte.ts';
  import SourceHead from '../lib/SourceHead.svelte';

  let { id, capture }: { id: string; capture?: string } = $props();
  const source = $derived(argus.sourceFor(capture));
  const live = $derived(source?.kind === 'live');
  const r = $derived(source?.graph.get(`remote:${id}`) as Remote | undefined);
  const linked = $derived(r && source ? source.graph.linked(`remote:${id}`) : []);
  const site = $derived(linked.find((n) => n.entity.kind === 'site')?.entity);
  const key = $derived(`remote:${id}`);
  const talks = $derived(source ? source.conversations.filter((c) => c.b === key || c.a === key) : []);
  const WHO = { DNS: 'by the DNS answer', TLS: 'by the start of the encrypted connection (SNI)' } as Record<string, string>;
</script>

<div class="page">
  <header class="page-head">
    <p class="crumbs">
      <a href={link.internet(capture)}>On the internet</a><span class="sep">/</span>{#if site}<a href={link.site(site.id, capture)}>{site.name}</a
        ><span class="sep">/</span>{/if}{r?.name ?? id}
    </p>
    {#if r}
      <div class="title">
        <EntityIcon entity={r} size={46} />
        <div>
          <h1 class="page-title">{r.name}</h1>
          <p class="who mono">{r.ip}</p>
        </div>
      </div>
      {#if source}<SourceHead {source} />{/if}
      <dl class="props">
        <dt>Names</dt>
        <dd>
          {#each r.names as n (n.name)}<span class="nm">{n.name} <span class="src">{WHO[n.source] ?? n.source}</span></span>{:else}<span class="muted"
              >None seen: the DNS question and the start of the connection did not pass through here</span
            >{/each}
        </dd>
        <dt>Whose</dt>
        <dd>{#if site}<EntityLink entity={site} {capture} />{:else}<span class="muted">Not known</span>{/if}</dd>
        <dt>Seen</dt>
        <dd>{when(r.firstSeen)} to {when(r.lastSeen)}{live ? ` (${since(r.lastSeen)})` : ''}</dd>
      </dl>
    {:else if source}
      <h1 class="page-title">Not seen</h1>
    {/if}
  </header>
  {#if r}
    <div class="stats">
      <div class="stat"><span class="stat-v">{bytes(r.bytesSent)}</span><span class="stat-l">sent here</span></div>
      <div class="stat"><span class="stat-v">{bytes(r.bytesReceived)}</span><span class="stat-l">received from here</span></div>
      <div class="stat"><span class="stat-v">{r.packets.toLocaleString('en-GB')}</span><span class="stat-l">packets</span></div>
    </div>
    {#if source}
      <section class="band">
        <Conversations conversations={talks} me={new Set([key])} {source} {capture} title="Who talked to it" label="Who talked to it" />
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

  .nm {
    display: block;
  }

  .src {
    font-size: 0.76rem;
    color: var(--faint);
  }

  .stats {
    margin-bottom: 36px;
  }
</style>
