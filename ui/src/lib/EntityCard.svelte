<script lang="ts">
  // An entity's card, in the hover card: what it is at a glance, its addresses, how much it moved (and how fast now,
  // live), and who it talked to most. The source is the page's: the live session or the capture it shows.
  import type { ArgusEntity } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import EntityIcon from './EntityIcon.svelte';
  import { bytes, rate, since } from './format.ts';
  import { KIND_WORD, deviceKind } from '../../../shared/kinds.ts';
  import { router } from './router.svelte.ts';

  let { key }: { key: string } = $props();
  const source = $derived(argus.sourceFor(router.route.capture));
  const e = $derived(source?.graph.get(key) as ArgusEntity | undefined);
  /** A device's busiest hosts and devices; a host's or a company's busiest devices. */
  const top = $derived(
    e && source
      ? source.graph
          .linked(key)
          .filter((n) => n.entity.kind === 'device' || (e.kind === 'device' && n.entity.kind === 'remote'))
          .slice(0, 3)
      : [],
  );
  const live = $derived(source?.kind === 'live');
  const what = $derived.by(() => {
    if (!e) return '';
    if (e.kind === 'device') return KIND_WORD[deviceKind(e)] + (e.vendor ? `, ${e.vendor}` : '');
    if (e.kind === 'remote') return 'On the internet';
    if (e.kind === 'site') return e.sites.join(', ');
    return `${e.label}: ${e.id}`;
  });
</script>

{#if e}
  <div class="ec">
    <div class="head">
      <EntityIcon entity={e} size={30} />
      <div class="who">
        <p class="name">{e.name}</p>
        <p class="what">{what}</p>
      </div>
    </div>
    {#if e.kind === 'device'}
      <p class="addr mono">{[...e.ips.slice(0, 2), e.mac].filter(Boolean).join('  ')}</p>
    {:else if e.kind === 'remote' && e.name !== e.ip}
      <p class="addr mono">{e.ip}</p>
    {/if}
    {#if e.kind !== 'interface'}
      <dl class="figs">
        <div>
          <dt>Sent</dt>
          <dd>{bytes(e.bytesSent)}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd>{bytes(e.bytesReceived)}</dd>
        </div>
        {#if live && e.kind === 'device'}
          <div>
            <dt>Now</dt>
            <dd>{rate(argus.meters[e.id])}</dd>
          </div>
        {:else}
          <div>
            <dt>Seen</dt>
            <dd>{since(e.lastSeen)}</dd>
          </div>
        {/if}
      </dl>
    {:else}
      <p class="what">{argus.session?.listening.find((l) => l.id === e.id)?.on ? 'Listening' : 'Not listening'}</p>
    {/if}
    {#if top.length}
      <p class="top">Talked most with {top.map((n) => n.entity.name).join(', ')}</p>
    {/if}
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .who {
    min-width: 0;
  }

  .name {
    margin: 0;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--fg);
    overflow-wrap: anywhere;
  }

  .what {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .addr {
    margin: 10px 0 0;
    font-size: 0.76rem;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .figs {
    display: flex;
    gap: 18px;
    margin: 12px 0 0;
  }

  .figs dt {
    font-size: 0.72rem;
    color: var(--faint);
  }

  .figs dd {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }

  .top {
    margin: 12px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--rule);
    font-size: 0.8rem;
    color: var(--fg-2);
  }
</style>
