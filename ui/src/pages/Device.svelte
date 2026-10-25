<script lang="ts">
  // One device's page: what it is and where its name came from, who it talked to, and the other devices that talked
  // to the same hosts (two steps out on the entity graph).
  import { keyOf } from '@organon/core/shared/entities';
  import type { Device, Remote } from '../../../shared/types.ts';
  import EntityLink from '../lib/EntityLink.svelte';
  import { bytes, when } from '../lib/format.ts';
  import { argus } from '../lib/state.svelte.ts';

  let { id, kind }: { id: string; kind: 'device' | 'remote' } = $props();
  const e = $derived(argus.graph.get(`${kind}:${id}`) as Device | Remote | undefined);
  const links = $derived(e ? argus.graph.linked(keyOf(e)) : []);
  const others = $derived(e ? argus.graph.twoSteps(keyOf(e)).filter((o) => o.entity.kind === e.kind) : []);
  const ifaces = $derived(e?.kind === 'device' ? e.interfaces.map((i) => argus.graph.find(i, 'interface') ?? null) : []);
</script>

<p><a href={argus.selected ? `#/?c=${encodeURIComponent(argus.selected)}` : '#/'}>← Quem está na rede</a></p>
{#if !e}
  <p class="muted">{argus.view ? 'Esta captura não o viu.' : 'A carregar…'}</p>
{:else}
  <h1>{e.name}</h1>
  {#if e.summary}<p class="muted">{e.summary}</p>{/if}

  <section class="panel facts">
    {#if e.kind === 'device'}
      <dl>
        <dt>MAC</dt>
        <dd class="mono">{e.mac ?? '—'}{#if e.randomMac} <span class="chip">privada</span>{/if}</dd>
        <dt>IP</dt>
        <dd class="mono">{e.ips.join(', ') || '—'}</dd>
        <dt>Fabricante</dt>
        <dd>{e.vendor ?? (e.randomMac ? 'Não se vê: a MAC é inventada pelo dispositivo' : 'Desconhecido')}</dd>
        <dt>Nomes</dt>
        <dd>{#each e.names as n (n.name)}<span class="chip">{n.name} · {n.source}</span>{:else}<span class="muted">Não disse o nome</span>{/each}</dd>
        {#if ifaces.length}
          <dt>Visto em</dt>
          <dd>{#each ifaces as i, k (k)}{#if i}<EntityLink entity={i} />{/if}{/each}</dd>
        {/if}
      </dl>
    {:else}
      <dl>
        <dt>IP</dt>
        <dd class="mono">{e.ip}</dd>
        <dt>Nomes</dt>
        <dd>{#each e.names as n (n.name)}<span class="chip">{n.name} · {n.source}</span>{:else}<span class="muted">Nenhum nome visto</span>{/each}</dd>
      </dl>
    {/if}
    <dl>
      <dt>Enviou</dt>
      <dd>{bytes(e.bytesSent)}</dd>
      <dt>Recebeu</dt>
      <dd>{bytes(e.bytesReceived)}</dd>
      <dt>Visto</dt>
      <dd>{when(e.firstSeen)} a {when(e.lastSeen)}</dd>
    </dl>
  </section>

  <h2>Falou com</h2>
  {#if links.length}
    <table class="list" aria-label="Falou com">
      <tbody>
        {#each links as n (keyOf(n.entity))}
          <tr><td><EntityLink entity={n.entity} /></td><td class="muted">{n.entity.kind === 'device' ? 'na rede local' : 'na internet'}</td><td class="num">{bytes(n.weight)}</td></tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">Não se viu a falar com ninguém em particular (só anúncios a todos).</p>
  {/if}

  {#if others.length}
    <h2>{e.kind === 'device' ? 'Outros dispositivos que falaram com os mesmos' : 'Outros anfitriões dos mesmos dispositivos'}</h2>
    <ul>
      {#each others as o (keyOf(o.entity))}
        <li><EntityLink entity={o.entity} /> <span class="muted">por {o.via.map((v) => v.name).join(', ')}</span></li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 48px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
</style>
