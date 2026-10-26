<script lang="ts">
  // One interface: what it is, whether Argus listens on it and how that goes, its bandwidth of the last ten minutes,
  // the networks it was on, and the devices heard on it (of every network: an interface is where, not which).
  import type { Interface } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import Conversations from '../lib/Conversations.svelte';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import EntityIcon from '../lib/EntityIcon.svelte';
  import { bytes, rate, since, span, when } from '../lib/format.ts';
  import { networks } from '../lib/networks.svelte.ts';
  import RateChart from '../lib/RateChart.svelte';
  import { link } from '../lib/router.svelte.ts';

  let { id }: { id: string } = $props();
  const i = $derived(argus.interfaces.find((x) => x.id === id) as Interface | undefined);
  const l = $derived(argus.session?.listening.find((x) => x.id === id));
  const devices = $derived(argus.allSource.devices.filter((d) => d.interfaces.includes(id)));
  const talks = $derived(argus.allSource.conversations.filter((c) => c.interfaces.includes(id)));
  const nets = $derived(argus.networks.filter((n) => n.interfaces.includes(id)));
  let problem = $state('');
</script>

<div class="page">
  <header class="page-head">
    <p class="crumbs"><a href={link.now()}>Now</a><span class="sep">/</span>{i?.name ?? id}</p>
    {#if i}
      <div class="title">
        <EntityIcon entity={i} size={46} />
        <div>
          <h1 class="page-title">{i.name}</h1>
          <p class="who mono">{i.id}</p>
        </div>
      </div>
      <dl class="props">
        <dt>State</dt>
        <dd>
          {#if l?.on}{l.status === 'failed' ? `Stopped: ${l.error}` : l.status === 'starting' ? 'Opening' : `Listening for ${span(Date.now() / 1000 - (l.since ?? Date.now() / 1000))}`}{:else}Not
            listening{/if}{i.up === false ? '; the interface is down' : ''}
        </dd>
        {#if l?.on}
          <dt>Packets</dt>
          <dd>{l.packets.toLocaleString('en-GB')}</dd>
          <dt>On disk</dt>
          <dd>
            {bytes(l.ringBytes)} of {argus.session ? `${argus.session.limits.ringFiles * argus.session.limits.ringFileMB} MB` : ''}: the ring buffer keeps the
            last minutes and deletes the oldest
          </dd>
        {/if}
      </dl>
      {#if nets.length}
        <dl class="props">
          <dt>Networks</dt>
          <dd>
            <ul class="nets" aria-label="Networks on {i.name}">
              {#each nets as n (n.id)}
                <li>
                  <button class="linkish" onclick={() => networks.choose(n.id)} title="Show this network on every page">{n.name}</button>
                  <span class="muted small">{n.nowOn?.includes(id) ? 'now' : n.pending ? 'joining' : `${when(n.first)} to ${when(n.last)}`}</span>
                </li>
              {/each}
            </ul>
          </dd>
        </dl>
      {/if}
      <div class="head-actions">
        <button
          class={l?.on ? 'ghost' : 'primary'}
          disabled={!i.capturable}
          onclick={async () => (problem = await argus.listen(id, !l?.on))}>{l?.on ? 'Stop listening' : 'Listen'}</button
        >
        {#if problem}<span class="error">{problem}</span>{/if}
      </div>
    {:else}
      <h1 class="page-title">{id}</h1>
      <p class="page-lede">This interface no longer exists on this PC.</p>
    {/if}
  </header>
  {#if l?.on && argus.byInterface[id]}
    <section class="band" aria-label="Bandwidth">
      <div class="band-h"><h2>Bandwidth</h2><span class="aside">{rate(l.rate)} now</span></div>
      <RateChart series={argus.byInterface[id]!} label="Bandwidth on {i?.name ?? id}" seconds={600} height={160} since={l.since} />
    </section>
  {/if}
  {#if devices.length}
    <section class="band">
      <div class="band-h"><h2>Heard here</h2><span class="aside">{devices.length}</span></div>
      <DeviceTable {devices} live />
    </section>
    <section class="band">
      <Conversations conversations={talks} source={argus.allSource} title="Conversations on this interface" />
    </section>
  {:else if l?.on}
    <p class="muted">Nobody yet{l.since ? ` since ${since(l.since)}` : ''}.</p>
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

  .aside {
    font-size: 0.84rem;
    color: var(--muted);
  }

  .nets {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .nets li {
    display: flex;
    flex-wrap: wrap;
    gap: 0 10px;
    align-items: baseline;
  }

  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--acc);
    font: inherit;
    cursor: pointer;
  }

  .linkish:hover {
    text-decoration: underline;
  }
</style>
