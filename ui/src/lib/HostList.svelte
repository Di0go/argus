<script lang="ts">
  // Hosts out on the internet, or the companies behind them, a line each: the name (a link with its card), who runs
  // it, and how much; the busiest first.
  import type { Remote, Site } from '../../../shared/types.ts';
  import EntityLink from './EntityLink.svelte';
  import { bytes, since } from './format.ts';
  import { companyOf, siteOf } from '../../../shared/sites.ts';

  let {
    items,
    capture,
    live = false,
    label,
    aside = whoRuns,
  }: { items: (Remote | Site)[]; capture?: string; live?: boolean; label: string; aside?: (x: Remote | Site) => string } = $props();

  /** A company's size, or who runs a host. */
  function whoRuns(x: Remote | Site): string {
    if (x.kind === 'site') return x.hosts.length === 1 ? '1 anfitrião' : `${x.hosts.length} anfitriões`;
    const site = x.names.map((n) => siteOf(n.name)).find(Boolean);
    return site ? companyOf(site) : x.name === x.ip ? 'sem nome visto' : '';
  }
</script>

<ul class="recs" aria-label={label}>
  {#each items as x (x.kind + x.id)}
    <!-- The dot lights while it is busy (heard in the last ten seconds), as a track lit on a radar. -->
    <li class="rec" class:acc={live && Date.now() / 1000 - x.lastSeen < 10}>
      <span class="rec-t"><EntityLink entity={x} {capture} /> <span class="aside">{aside(x)}</span></span>
      <span class="rec-m" title={live ? `Visto ${since(x.lastSeen)}` : undefined}>{bytes(x.bytesSent + x.bytesReceived)}</span>
    </li>
  {:else}
    <li class="rec empty">Nenhum ainda.</li>
  {/each}
</ul>

<style>
  .rec-t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .aside {
    margin-left: 4px;
    font-size: 0.78rem;
    color: var(--faint);
  }
</style>
