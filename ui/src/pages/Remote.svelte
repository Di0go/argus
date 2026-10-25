<script lang="ts">
  // One host out on the internet: its address, the names it went by and who said them, who runs it, how much went
  // each way, and which devices here talked to it.
  import { keyOf } from '@organon/core/shared/entities';
  import type { Remote } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import EntityIcon from '../lib/EntityIcon.svelte';
  import EntityLink from '../lib/EntityLink.svelte';
  import { bytes, since, when } from '../lib/format.ts';
  import { link } from '../lib/router.svelte.ts';
  import SourceHead from '../lib/SourceHead.svelte';

  let { id, capture }: { id: string; capture?: string } = $props();
  const source = $derived(argus.sourceFor(capture));
  const live = $derived(source?.kind === 'live');
  const r = $derived(source?.graph.get(`remote:${id}`) as Remote | undefined);
  const linked = $derived(r && source ? source.graph.linked(`remote:${id}`) : []);
  const site = $derived(linked.find((n) => n.entity.kind === 'site')?.entity);
  const devices = $derived(linked.filter((n) => n.entity.kind === 'device'));
  const WHO = { DNS: 'pela resposta de DNS', TLS: 'pelo início da ligação cifrada (SNI)' } as Record<string, string>;
</script>

<div class="page">
  <header class="page-head">
    <p class="crumbs">
      <a href={link.internet(capture)}>Na internet</a><span class="sep">/</span>{#if site}<a href={link.site(site.id, capture)}>{site.name}</a
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
        <dt>Nomes</dt>
        <dd>
          {#each r.names as n (n.name)}<span class="nm">{n.name} <span class="src">{WHO[n.source] ?? n.source}</span></span>{:else}<span class="muted"
              >Nenhum visto: o pedido de DNS e o início da ligação não passaram por aqui</span
            >{/each}
        </dd>
        <dt>De quem</dt>
        <dd>{#if site}<EntityLink entity={site} {capture} />{:else}<span class="muted">Não se sabe</span>{/if}</dd>
        <dt>Visto</dt>
        <dd>{when(r.firstSeen)} a {when(r.lastSeen)}{live ? ` (${since(r.lastSeen)})` : ''}</dd>
      </dl>
    {:else if source}
      <h1 class="page-title">Não visto</h1>
    {/if}
  </header>
  {#if r}
    <div class="stats">
      <div class="stat"><span class="stat-v">{bytes(r.bytesSent)}</span><span class="stat-l">mandou para cá</span></div>
      <div class="stat"><span class="stat-v">{bytes(r.bytesReceived)}</span><span class="stat-l">recebeu daqui</span></div>
      <div class="stat"><span class="stat-v">{r.packets.toLocaleString('pt-PT')}</span><span class="stat-l">pacotes</span></div>
    </div>
    <section class="band">
      <div class="band-h"><h2>Quem lhe falou</h2></div>
      <ul class="recs" aria-label="Quem lhe falou">
        {#each devices as n (keyOf(n.entity))}
          <li class="rec acc"><span class="rec-t"><EntityLink entity={n.entity} {capture} /></span><span class="rec-m">{bytes(n.weight)}</span></li>
        {:else}
          <li class="rec empty">Nenhum dispositivo daqui em particular.</li>
        {/each}
      </ul>
    </section>
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
