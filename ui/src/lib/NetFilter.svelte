<script lang="ts">
  // Which network the list shows, as a menu: every network, or one (with how many devices each), and whether the
  // other networks' devices then stay out of the list altogether. The choice is the same on every page, and kept.
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Layers from '@lucide/svelte/icons/layers';
  import type { Device } from '../../../shared/types.ts';
  import EntityIcon from './EntityIcon.svelte';
  import { networks, networksOf } from './networks.svelte.ts';

  let { devices }: { devices: Device[] } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();
  const nets = $derived(networksOf(devices));
  const current = $derived(networks.current(devices));
  const label = $derived(current ? (nets.find((n) => n.id === current)?.name ?? current) : 'Todas as redes');

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

  function pick(id: string | null) {
    networks.select(id);
    open = false;
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<div class="nf" bind:this={root}>
  <button class="nf-button" class:set={current} aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="sr">Rede: </span>{label}{#if current && networks.hideOthers}<span class="only">só esta</span>{/if}
    <ChevronDown size={14} strokeWidth={2} />
  </button>
  {#if open}
    <div class="nf-menu" role="menu" aria-label="Rede">
      <button role="menuitemradio" aria-checked={!current} onclick={() => pick(null)}>
        <span class="ic"><Layers size={15} strokeWidth={1.7} /></span><span class="nm">Todas as redes</span><span class="n">{devices.length}</span>
        <span class="tick">{#if !current}<Check size={14} strokeWidth={2.2} />{/if}</span>
      </button>
      {#each nets as n (n.id)}
        <button role="menuitemradio" aria-checked={current === n.id} onclick={() => pick(n.id)}>
          <span class="ic">{#if n.iface}<EntityIcon entity={n.iface} size={20} />{/if}</span>
          <span class="nm">{n.name}{#if n.iface && n.iface.name !== n.id}<span class="id">{n.id}</span>{/if}</span>
          <span class="n">{n.count}</span>
          <span class="tick">{#if current === n.id}<Check size={14} strokeWidth={2.2} />{/if}</span>
        </button>
      {/each}
      <div class="sep" role="separator"></div>
      <button
        role="menuitemcheckbox"
        class="hide"
        aria-checked={networks.hideOthers}
        onclick={() => networks.setHideOthers(!networks.hideOthers)}
      >
        <span class="box" class:on={networks.hideOthers} aria-hidden="true">{#if networks.hideOthers}<Check size={12} strokeWidth={3} />{/if}</span>
        <span class="nm">Esconder os das outras redes<span class="hint">com uma rede escolhida, os outros nem aparecem</span></span>
      </button>
    </div>
  {/if}
</div>

<style>
  .nf {
    position: relative;
    display: inline-block;
  }

  .nf-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 3px 9px 3px 11px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--b0);
    color: var(--fg-2);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
  }

  .nf-button:hover {
    background: var(--hover);
  }

  .nf-button.set {
    border-color: var(--acc-line);
    color: var(--fg);
  }

  .only {
    font-size: 0.74rem;
    font-weight: 500;
    color: var(--acc);
  }

  .nf-menu {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    right: 0;
    min-width: 290px;
    max-width: min(340px, calc(100vw - 32px));
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
  }

  .id,
  .hint {
    font-family: var(--mono);
    font-size: 0.72rem;
    font-weight: 400;
    color: var(--faint);
  }

  .hint {
    font-family: var(--sans);
    font-size: 0.74rem;
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

  .nf-menu button.hide {
    grid-template-columns: 22px minmax(0, 1fr);
  }

  .box {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-left: 3px;
    border: 1.5px solid var(--rule-strong);
    border-radius: 4px;
    color: var(--on-acc);
  }

  .box.on {
    border-color: var(--acc);
    background: var(--acc);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
