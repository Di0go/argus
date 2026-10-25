<script lang="ts">
  // One device: what it is and where each fact came from (its names and who said them, its addresses, its maker), how
  // much it moved and how fast it moves now, its bandwidth over the last minutes and the day, the companies and hosts
  // it talks to, the devices here it talks to, and the other devices that talk to the same companies.
  import { getJson } from '@organon/core/ui/live';
  import { keyOf } from '@organon/core/shared/entities';
  import type { Device, SeriesData } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import EntityIcon from '../lib/EntityIcon.svelte';
  import EntityLink from '../lib/EntityLink.svelte';
  import { bytes, rate, since, when } from '../lib/format.ts';
  import HostList from '../lib/HostList.svelte';
  import { KIND_WORD, deviceKind, subline } from '../lib/kinds.ts';
  import RateChart from '../lib/RateChart.svelte';
  import { link } from '../lib/router.svelte.ts';
  import Seg from '../lib/Seg.svelte';
  import SourceHead from '../lib/SourceHead.svelte';

  let { id, capture }: { id: string; capture?: string } = $props();

  const source = $derived(argus.sourceFor(capture));
  const live = $derived(source?.kind === 'live');
  const d = $derived(source?.graph.get(`device:${id}`) as Device | undefined);
  const key = $derived(`device:${id}`);
  const linked = $derived(d && source ? source.graph.linked(key) : []);
  const sites = $derived(linked.filter((n) => n.entity.kind === 'site'));
  const hosts = $derived(linked.filter((n) => n.entity.kind === 'remote'));
  const locals = $derived(linked.filter((n) => n.entity.kind === 'device'));
  const unnamed = $derived(hosts.filter((n) => !sites.some((s) => (s.entity.kind === 'site' ? s.entity.hosts.includes(n.entity.id) : false))));
  const others = $derived(d && source ? source.graph.twoSteps(key, 'uses', 'uses').filter((o) => o.entity.kind === 'device') : []);
  const ifaces = $derived(d ? d.interfaces.map((i) => source?.graph.get(`interface:${i}`) ?? null) : []);
  let period = $state<'minutes' | 'day'>('minutes');
  const PERIODS = [
    { id: 'minutes' as const, label: '10 min' },
    { id: 'day' as const, label: 'Hoje' },
  ];
  let coarse = $state<SeriesData | null>(null);

  $effect(() => {
    if (!live || period !== 'day') return;
    void getJson<{ coarse?: SeriesData }>(`/api/live/devices/${encodeURIComponent(id)}`).then((s) => (coarse = s.coarse ?? null));
  });
</script>

<div class="page">
  <header class="page-head">
    <p class="crumbs"><a href={link.devices(capture)}>Dispositivos</a><span class="sep">/</span>{d?.name ?? id}</p>
    {#if d}
      <div class="title">
        <EntityIcon entity={d} size={46} />
        <div>
          <h1 class="page-title">{d.name}</h1>
          <p class="who">
            {d.role === 'gateway' ? 'A saída para a internet' : subline(d) || KIND_WORD[deviceKind(d)]}{d.model && d.role ? `, ${d.model}` : ''}
          </p>
        </div>
      </div>
      {#if source}<SourceHead {source} />{/if}
      <dl class="props">
        <dt>MAC</dt>
        <dd class="mono">
          {d.mac ?? 'nenhuma: visto pelo endereço'}{#if d.randomMac}
            <span class="tag" data-tip="Os telemóveis e os portáteis inventam uma MAC em cada rede, para não serem seguidos de rede em rede."
              >privada</span
            >{/if}
        </dd>
        <dt>Endereços</dt>
        <dd class="mono">{d.ips.join(', ') || '—'}</dd>
        <dt>Fabricante</dt>
        <dd>{d.vendor ?? (d.randomMac ? 'Não se vê: a MAC é inventada pelo dispositivo' : 'Desconhecido')}</dd>
        <dt>Nomes</dt>
        <dd>
          {#each d.names as n, i (n.name)}{i ? ', ' : ''}{n.name} <span class="src" data-tip={SOURCES[n.source]}>{n.source}</span>{:else}<span
              class="muted">Não disse o nome</span
            >{/each}
        </dd>
        <dt>Visto em</dt>
        <dd>{#each ifaces as i, k (k)}{k ? ', ' : ''}{#if i}<EntityLink entity={i} />{/if}{/each}</dd>
        <dt>Visto</dt>
        <dd>{when(d.firstSeen)} a {when(d.lastSeen)}{live ? ` (${since(d.lastSeen)})` : ''}</dd>
      </dl>
    {:else}
      <h1 class="page-title">{source ? 'Não visto' : ''}</h1>
      {#if source}<p class="page-lede">{live ? 'A sessão ao vivo ainda não o viu (ou já o esqueceu).' : 'Esta captura não o viu.'}</p>{/if}
    {/if}
  </header>

  {#if d}
    <section class="band">
      <div class="stats">
        <div class="stat"><span class="stat-v">{bytes(d.bytesSent)}</span><span class="stat-l">enviou</span></div>
        <div class="stat"><span class="stat-v">{bytes(d.bytesReceived)}</span><span class="stat-l">recebeu</span></div>
        <div class="stat"><span class="stat-v">{d.packets.toLocaleString('pt-PT')}</span><span class="stat-l">pacotes</span></div>
        {#if live}<div class="stat"><span class="stat-v">{rate(argus.meters[d.id])}</span><span class="stat-l">agora</span></div>{/if}
      </div>
      {#if live && argus.byDevice[d.id]}
        <div class="band-h">
          <h2>Débito</h2>
<Seg bind:value={period} label="Período" options={PERIODS} />
        </div>
        {#if period === 'minutes'}
          <RateChart series={argus.byDevice[d.id]!} label="Débito de {d.name}" seconds={600} height={180} />
        {:else if coarse}
          <RateChart series={coarse} label="Débito de {d.name}, hoje" height={180} />
        {/if}
      {/if}
    </section>

    <div class="bands">
      <section class="band">
        <div class="band-h">
          <h2>Na internet, fala com</h2>
          <span class="aside">{hosts.length === 1 ? '1 anfitrião' : `${hosts.length} anfitriões`}</span>
        </div>
        {#if sites.length || unnamed.length}
          <HostList items={sites.map((n) => n.entity).filter((e) => e.kind === 'site')} {capture} {live} label="Empresas e sites" />
          {#if unnamed.length}
            <p class="sub-h">Sem nome visto</p>
            <HostList items={unnamed.map((n) => n.entity).filter((e) => e.kind === 'remote').slice(0, 12)} {capture} {live} label="Anfitriões sem nome" aside={() => ''} />
          {/if}
        {:else}
          <p class="empty">
            {d.role === 'self' || d.role === 'gateway'
              ? 'Nada ainda.'
              : 'Não se viu a falar com a internet daqui. Num PC numa rede normal, o tráfego dos outros dispositivos para fora não passa por aqui.'}
          </p>
        {/if}
      </section>
      <section class="band">
        <div class="band-h"><h2>Na rede local, fala com</h2></div>
        <ul class="recs" aria-label="Na rede local">
          {#each locals as n (keyOf(n.entity))}
            <li class="rec"><span class="rec-t"><EntityLink entity={n.entity} {capture} /></span><span class="rec-m">{bytes(n.weight)}</span></li>
          {:else}
            <li class="rec empty">Só anúncios a todos (broadcast e multicast), nada directo.</li>
          {/each}
        </ul>
        {#if others.length}
          <p class="sub-h">Usam as mesmas empresas</p>
          <ul class="recs" aria-label="Usam as mesmas empresas">
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
    DHCP: 'O nome que o próprio dispositivo deu ao pedir um endereço ao router (DHCP).',
    mDNS: 'O nome que o próprio dispositivo anuncia na rede local (mDNS, o Bonjour).',
    NetBIOS: 'O nome que um Windows anuncia na rede local (NetBIOS).',
    DNS: 'O nome que a resposta de DNS deu a este endereço.',
    TLS: 'O nome do servidor pedido ao abrir a ligação cifrada (TLS SNI).',
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
