<script lang="ts">
  // Where Argus listens, on every page, under the tabs: one pill per network that usually matters (Wi-Fi, cable, VPN,
  // up), each a switch, with how fast it moves now when on; the rest (Docker's bridges, what is down, loopback, all at
  // once) behind "More". At the end, saving the last minutes. Why a network cannot be listened on, or stopped, is said
  // in a line under it.
  import type { Interface } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import { rate, since, span } from './format.ts';
  import { link } from './router.svelte.ts';

  let problem = $state('');
  let busy = $state<string | null>(null);
  let more = $state(false);
  let saving = $state(false);
  let saved = $state('');
  let root = $state<HTMLElement>();

  const stateOf = (id: string) => argus.session?.listening.find((l) => l.id === id);
  const minor = (i: Interface) => i.up === false || i.type === 'docker' || i.type === 'loopback' || i.type === 'any' || i.type === 'other';
  const main = $derived(argus.interfaces.filter((i) => !minor(i) || stateOf(i.id)?.on));
  const rest = $derived(argus.interfaces.filter((i) => minor(i) && !stateOf(i.id)?.on));
  const on = $derived(argus.interfaces.filter((i) => stateOf(i.id)?.on));
  const failed = $derived(argus.session?.listening.filter((l) => l.on && l.status === 'failed') ?? []);

  /** Interfaces that carry the same frames: listening on both counts them twice. */
  const overlap = $derived.by(() => {
    if (on.some((i) => i.type === 'any') && on.length > 1) return '«All» already includes the others: what passes through them counts twice.';
    if (on.some((i) => i.id.startsWith('veth')) && on.some((i) => i.type === 'docker' && !i.id.startsWith('veth')))
      return 'A Docker bridge and its containers carry the same packets: they count twice.';
    return '';
  });

  async function toggle(i: Interface) {
    busy = i.id;
    problem = await argus.listen(i.id, !stateOf(i.id)?.on);
    busy = null;
  }

  async function save() {
    saving = true;
    problem = '';
    try {
      saved = (await argus.save()).id;
    } catch (err) {
      saved = '';
      problem = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  /** What the pill says when hovered: how it is going. */
  function tip(i: Interface): string {
    const s = stateOf(i.id);
    if (!i.capturable) return `${i.id}: this user may not listen here`;
    if (!s?.on) return `${i.id}: ${i.up === false ? 'down' : 'not listening'}. Click to listen.`;
    if (s.status === 'failed') return `${i.id}: stopped ${s.since ? since(s.since) : ''}: ${s.error ?? ''}`;
    if (s.status === 'starting') return `${i.id}: opening…`;
    return `${i.id}: listening for ${span(Date.now() / 1000 - (s.since ?? Date.now() / 1000))}. Click to stop.`;
  }

  function outside(e: PointerEvent) {
    if (more && root && !root.contains(e.target as Node)) more = false;
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(e) => e.key === 'Escape' && (more = false)} />

{#snippet pill(i: Interface)}
  {@const s = stateOf(i.id)}
  <button
    class="pill"
    class:on={s?.on}
    class:failed={s?.status === 'failed'}
    role="switch"
    aria-checked={Boolean(s?.on)}
    aria-label="Listen on {i.name} ({i.id})"
    title={tip(i)}
    disabled={!i.capturable || busy === i.id}
    onclick={() => toggle(i)}
  >
    <i class="dot" aria-hidden="true"></i>
    <span class="nm">{i.name}</span>
    {#if s?.on && s.status !== 'failed'}<span class="rt">{rate(argus.ifaceMeters[i.id])}</span>{/if}
  </button>
{/snippet}

<div class="netbar" bind:this={root} aria-label="Where Argus listens: a network each, click to listen or stop" role="group">
  <div class="pills">
    {#each main as i (i.id)}{@render pill(i)}{/each}
    {#if rest.length}
      <span class="more-wrap">
        <button class="pill more" aria-expanded={more} onclick={() => (more = !more)}>{rest.length} more</button>
        {#if more}
          <div class="pop" role="group" aria-label="More networks">
            {#each rest as i (i.id)}{@render pill(i)}{/each}
          </div>
        {/if}
      </span>
    {/if}
  </div>
  <span class="end">
    {#if saved}<a href={link.capture(saved)}>Saved: open it</a>{/if}
    <button class="ghost small save" disabled={saving || !on.length} onclick={save} title="Keep what the ring buffer holds (the last minutes, as packets) as a capture"
      >{saving ? 'Saving…' : 'Save last minutes'}</button
    >
  </span>
</div>
{#if failed.length || problem || overlap || (argus.interfacesProblem && !argus.interfaces.some((i) => i.capturable))}
  <div class="why" role="status">
    {#each failed as l (l.id)}<span>{l.id} stopped {l.since ? since(l.since) : ''}: {l.error}. It tries again by itself.</span>{/each}
    {#if argus.interfacesProblem && !argus.interfaces.some((i) => i.capturable)}
      <span>Cannot listen yet: {argus.interfacesProblem}. Run this once: <code>pkexec bash scripts/install-capture.sh</code>.</span>
    {/if}
    {#if overlap}<span>{overlap}</span>{/if}
    {#if problem}<span role="alert">{problem}</span>{/if}
  </div>
{/if}

<style>
  .netbar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 7px clamp(16px, 3vw, 40px);
    border-bottom: 1px solid var(--rule);
    background: var(--b0);
  }


  .pills {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 12px 0 10px;
    border: 1px solid var(--rule-strong);
    border-radius: 999px;
    background: var(--b0);
    color: var(--fg-2);
    font-size: 0.84rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 0.15s var(--ease),
      border-color 0.15s var(--ease);
  }

  .pill:hover:not(:disabled) {
    background: var(--hover);
  }

  .pill:focus-visible {
    outline: 2px solid var(--acc);
    outline-offset: 2px;
  }

  .pill:disabled {
    cursor: default;
    opacity: 0.55;
  }


  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid var(--faint);
  }

  .pill.on {
    border-color: var(--acc-line);
    background: var(--acc-soft);
    color: var(--fg);
  }

  .pill.on .dot {
    border-color: var(--acc);
    background: var(--acc);
    animation: listening 2.4s var(--ease) infinite;
  }

  .pill.failed .dot {
    border-color: var(--shaky);
    background: var(--shaky);
    animation: none;
  }

  @keyframes listening {
    50% {
      box-shadow: 0 0 0 3px var(--acc-soft);
    }
  }

  .rt {
    min-width: 4.6em;
    text-align: right;
    font-size: 0.8rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--fg);
  }

  .more {
    gap: 4px;
    color: var(--muted);
  }

  .more-wrap {
    position: relative;
  }

  .pop {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 8px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--b0);
    box-shadow: var(--shadow);
  }

  .end {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
    font-size: 0.82rem;
    white-space: nowrap;
  }


  .why {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding: 6px clamp(16px, 3vw, 40px);
    border-bottom: 1px solid var(--rule);
    background: var(--b0);
    font-size: 0.82rem;
    color: var(--shaky);
  }

  @media (max-width: 760px) {
    .save {
      display: none;
    }

    .pill .rt {
      min-width: 0;
    }
  }
</style>
