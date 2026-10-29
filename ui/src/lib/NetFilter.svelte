<script lang="ts">
  // Which network the pages show, as a menu in the bar on every page: the one Argus is on now (the default), each
  // network the session was on and those remembered from before it (its Wi-Fi's name, else its router's; when it was
  // heard last), or all of them together. It is not where Argus listens (the pills beside it): one network may be heard
  // on two interfaces, and an interface may have been on many networks. The choice is the same on every page, and kept.
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Layers from '@lucide/svelte/icons/layers';
  import Radio from '@lucide/svelte/icons/radio';
  import type { Network } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import EntityIcon from './EntityIcon.svelte';
  import { since } from './format.ts';
  import { networks } from './networks.svelte.ts';

  let open = $state(false);
  let root = $state<HTMLElement>();
  const list = $derived(argus.netList);
  const nowNets = $derived(argus.networks.filter((n) => n.now));
  const nowLabel = $derived(nowNets.map((n) => n.name).join(' and ') || (argus.networks[0] ? argus.networks[0].name : ''));
  const chosen = $derived(list.find((n) => n.id === networks.choice));
  const label = $derived(
    networks.choice === 'all' ? 'All networks' : networks.choice === 'now' ? nowLabel || 'No network yet' : (chosen?.name ?? 'A network not seen since'),
  );
  /** How many devices of the session each network has. */
  const count = (id: string) => argus.devices.filter((d) => d.networks?.includes(id)).length;
  const ifaceOf = (n: Network) => argus.interfaces.find((i) => i.id === n.interfaces[0]);
  const where = (n: Network) => n.interfaces.map((id) => argus.interfaces.find((i) => i.id === id)?.label ?? id).join(' and ');

  function outside(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }

  function key(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      open = false;
      root?.querySelector<HTMLButtonElement>('.nf-button')?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(root?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    e.preventDefault();
  }

  function pick(c: string) {
    networks.choose(c);
    open = false;
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<div class="nf" bind:this={root}>
  <button class="nf-button" class:set={networks.choice !== 'now'} aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)} title="Which network the pages show: the one of now, one heard before, or all together">
    <span class="sr">Showing: </span>{#if networks.choice === 'now' && nowNets.length}<i class="live" aria-hidden="true"></i>{/if}<span class="lb">{label}</span>
    <ChevronDown size={14} strokeWidth={2} />
  </button>
  {#if open}
    <div class="nf-menu" role="menu" aria-label="Which network the pages show">
      <p class="menu-head">Which network the pages show</p>
      <button role="menuitemradio" aria-checked={networks.choice === 'now'} onclick={() => pick('now')}>
        <span class="ic"><Radio size={15} strokeWidth={1.7} /></span>
        <span class="nm">Follow the network of now<span class="hint">{nowNets.length ? nowLabel : 'not listening: the latest one'}</span></span>
        <span class="n"></span>
        <span class="tick">{#if networks.choice === 'now'}<Check size={14} strokeWidth={2.2} />{/if}</span>
      </button>
      <div class="sep" role="separator"></div>
      <p class="menu-head">One network</p>
      {#each list as n (n.id)}
        {@const iface = ifaceOf(n)}
        <button role="menuitemradio" aria-checked={networks.choice === n.id} onclick={() => pick(n.id)}>
          <span class="ic">{#if iface}<EntityIcon entity={iface} size={20} />{/if}</span>
          <span class="nm"
            >{n.name}<span class="hint">{where(n)}{n.now ? ', now' : n.pending ? ', joining' : `, last ${since(n.last)}`}{argus.networks.some((x) => x.id === n.id) ? '' : ' (before this session)'}</span></span
          >
          <span class="n">{argus.networks.some((x) => x.id === n.id) ? count(n.id) : ''}</span>
          <span class="tick">{#if networks.choice === n.id}<Check size={14} strokeWidth={2.2} />{/if}</span>
        </button>
      {/each}
      <div class="sep" role="separator"></div>
      <button role="menuitemradio" aria-checked={networks.choice === 'all'} onclick={() => pick('all')}>
        <span class="ic"><Layers size={15} strokeWidth={1.7} /></span><span class="nm">All networks<span class="hint">together, each device with its networks</span></span
        ><span class="n">{argus.devices.length}</span>
        <span class="tick">{#if networks.choice === 'all'}<Check size={14} strokeWidth={2.2} />{/if}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .nf {
    position: relative;
    display: inline-block;
    min-width: 0;
  }

  .nf-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: min(320px, 40vw);
    min-height: 30px;
    padding: 3px 9px 3px 11px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--b0);
    color: var(--fg);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
  }

  .lb {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nf-button:hover {
    background: var(--hover);
  }

  .nf-button.set {
    border-color: var(--acc-line);
  }

  .live {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--acc);
  }

  .nf-menu {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    right: 0;
    min-width: 300px;
    max-width: min(360px, calc(100vw - 32px));
    max-height: 70vh;
    overflow-y: auto;
    padding: 5px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--b0);
    box-shadow: var(--shadow);
  }

  .nf-menu button {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto 16px;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--fg);
    font-size: 0.86rem;
    text-align: left;
    cursor: pointer;
  }

  .nf-menu button:hover,
  .nf-menu button:focus-visible {
    background: var(--hover);
    outline: none;
  }

  .ic {
    display: inline-grid;
    place-items: center;
    color: var(--muted);
  }

  .nm {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .hint {
    font-size: 0.74rem;
    font-weight: 400;
    color: var(--faint);
  }

  .n {
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .tick {
    display: inline-grid;
    place-items: center;
    color: var(--acc);
  }

  .sep {
    height: 1px;
    margin: 5px 4px;
    background: var(--rule);
  }

  .menu-head {
    margin: 5px 8px 3px;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--faint);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
