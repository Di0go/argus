<script lang="ts">
  // The hosts out on the internet the devices here talk to, by who runs them (Google, Meta, a site by its name), the
  // busiest first; then every host, findable by name or address. A host is named by the DNS answers this network got
  // for it or by the server name its encrypted connection asked for; one with neither shows only its address.
  import { fold } from '@organon/core/shared/entities';
  import { argus } from '../lib/argus.svelte.ts';
  import EntityLink from '../lib/EntityLink.svelte';
  import { bytes, since } from '../lib/format.ts';
  import HostList from '../lib/HostList.svelte';
  import SourceHead from '../lib/SourceHead.svelte';

  let { capture }: { capture?: string } = $props();
  let q = $state('');
  let all = $state(false);

  const source = $derived(argus.sourceFor(capture));
  const live = $derived(source?.kind === 'live');
  const hosts = $derived.by(() => {
    if (!source) return [];
    const words = fold(q).split(/\s+/).filter(Boolean);
    const company = new Map(source.sites.flatMap((s) => s.hosts.map((h) => [h, s.name] as const)));
    return source.remotes
      .filter((r) => {
        const text = fold([r.name, r.ip, ...r.names.map((n) => n.name), company.get(r.id) ?? ''].join(' '));
        return words.every((w) => text.includes(w));
      })
      .map((r) => ({ r, company: company.get(r.id) }));
  });
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">Na internet</h1>
    <p class="page-lede">
      {#if source}{source.remotes.length} anfitriões, de {source.sites.length} empresas e sites. O que vai cifrado não se lê: vê-se a quem
        cada dispositivo fala, quando e quanto.{:else}<span class="sk w60"></span>{/if}
    </p>
    {#if source}<SourceHead {source} />{/if}
  </header>
  {#if source}
    <section class="band">
        <div class="band-h"><h2>Por empresa</h2></div>
        <div class="cols"><HostList items={all ? source.sites : source.sites.slice(0, 16)} {capture} {live} label="Empresas e sites" /></div>
        {#if source.sites.length > 16}
          <button class="link more" onclick={() => (all = !all)}>{all ? 'Menos' : `Todas as ${source.sites.length}`}</button>
        {/if}
    </section>
    <section class="band">
        <div class="band-h">
          <h2>Todos os anfitriões</h2>
          <input class="input" type="search" placeholder="Nome ou endereço" aria-label="Filtrar anfitriões" bind:value={q} />
        </div>
        <div class="records-wrap">
          <table class="records" aria-label="Anfitriões">
            <thead><tr><th>Anfitrião</th><th class="hide-s">Endereço</th><th class="num">Total</th>{#if live}<th class="num hide-s">Visto</th>{/if}</tr></thead>
            <tbody>
              {#each hosts.slice(0, 200) as { r, company } (r.id)}
                <tr>
                  <td class="host" title={r.name}><EntityLink entity={r} {capture} />{#if company}<span class="co">{company}</span>{/if}</td>
                  <td class="mono hide-s">{r.ip}</td>
                  <td class="num">{bytes(r.bytesSent + r.bytesReceived)}</td>
                  {#if live}<td class="num hide-s muted">{since(r.lastSeen)}</td>{/if}
                </tr>
              {:else}
                <tr><td colspan="4" class="muted">{q ? `Nenhum com «${q}».` : 'Nenhum ainda.'}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if hosts.length > 200}<p class="muted small">E mais {hosts.length - 200}: escreve para filtrar.</p>{/if}
    </section>
  {/if}
</div>

<style>
  .band-h .input {
    width: min(220px, 100%);
    padding: 4px 10px;
    font-size: 0.86rem;
  }

  .cols :global(.recs) {
    columns: 2 22rem;
    column-gap: 40px;
  }

  .cols :global(.rec) {
    break-inside: avoid;
  }

  /* The host's name gives way (cut with an ellipsis), so the figures on the right are always whole: max-width: 0 lets a
     cell of an auto table go below its text's width. */
  .host {
    width: 100%;
    max-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .host :global(.el) {
    overflow-wrap: normal;
  }

  td.num,
  td.mono {
    white-space: nowrap;
  }

  .co {
    margin-left: 8px;
    font-size: 0.76rem;
    color: var(--faint);
  }

  .more {
    margin-top: 8px;
    font-size: 0.86rem;
  }

  @media (max-width: 640px) {
    .hide-s {
      display: none;
    }
  }
</style>
