<script lang="ts">
  // The frame: a bar with Argus's name, search across every entity of the capture being looked at, and the look; the
  // page the address names under it; one hover card for every entity link (the core's HoverCard).
  import HoverCard from '@organon/core/ui/HoverCard.svelte';
  import LookPicker from '@organon/core/ui/LookPicker.svelte';
  import { keyOf } from '@organon/core/shared/entities';
  import EntityCard from './lib/EntityCard.svelte';
  import { href, router } from './lib/router.svelte.ts';
  import { argus } from './lib/state.svelte.ts';
  import Device from './pages/Device.svelte';
  import Hosts from './pages/Hosts.svelte';
  import { theme } from './theme.svelte.ts';

  let q = $state('');
  let lookOpen = $state(false);
  const hits = $derived(q.trim() ? argus.graph.search(q, 12).filter((h) => h.entity.kind !== 'interface') : []);

  $effect(() => {
    const c = router.current.capture;
    if (c !== argus.selected) {
      argus.selected = c;
      void argus.loadView();
    }
  });

  void argus.loadInterfaces();
  void argus.refresh();
</script>

<header class="bar">
  <a class="brand" href="#/">Argus</a>
  <div class="search">
    <input type="search" placeholder="Procurar dispositivo, IP, MAC, fabricante…" aria-label="Procurar" bind:value={q} />
    {#if hits.length}
      <ul class="hits" role="listbox">
        {#each hits as h (keyOf(h.entity))}
          <li>
            <a href={href(h.entity.kind, h.entity.id, argus.selected)} onclick={() => (q = '')} data-tip-entity={keyOf(h.entity)}>
              {h.entity.name}
              <span class="muted">{h.entity.kind === 'device' ? 'rede local' : 'internet'} · {h.snippet}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  <button class="lookbtn" aria-expanded={lookOpen} onclick={() => (lookOpen = !lookOpen)}>Aspecto</button>
  {#if lookOpen}<div class="look panel"><LookPicker look={theme} /></div>{/if}
</header>

<main class="page">
  {#if router.current.route.page === 'device' || router.current.route.page === 'remote'}
    <Device id={router.current.route.id} kind={router.current.route.page} />
  {:else}
    <Hosts />
  {/if}
</main>

<HoverCard>
  {#snippet entity(key)}<EntityCard {key} />{/snippet}
</HoverCard>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 10px clamp(16px, 4vw, 48px);
    border-bottom: 1px solid var(--rule);
    background: var(--b1);
    position: relative;
  }
  .brand {
    font-weight: 700;
    color: var(--fg);
    font-size: 1.1rem;
  }
  .search {
    position: relative;
    flex: 1;
    max-width: 520px;
  }
  .search input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 10px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--b0);
    color: var(--fg);
    font: inherit;
  }
  .hits {
    position: absolute;
    z-index: 40;
    left: 0;
    right: 0;
    margin: 4px 0 0;
    padding: 4px 0;
    list-style: none;
    background: var(--b0);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .hits a {
    display: block;
    padding: 6px 12px;
    color: var(--fg);
  }
  .hits a:hover {
    background: var(--hover);
    text-decoration: none;
  }
  .hits .muted {
    font-size: 0.8rem;
  }
  .lookbtn {
    margin-left: auto;
    background: none;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    padding: 5px 10px;
    color: var(--fg-2);
  }
  .look {
    position: absolute;
    right: clamp(16px, 4vw, 48px);
    top: 100%;
    z-index: 50;
  }
</style>
