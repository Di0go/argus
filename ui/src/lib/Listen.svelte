<script lang="ts">
  // Where to listen: a switch per interface, on and off each on its own, several at once. The ones that usually
  // matter (Wi-Fi, cable, VPN, up) in view; the rest (Docker's bridges, what is down, loopback, all at once) under
  // "Mais". Each says how it is going: listening for how long, starting, or why it stopped.
  import type { Interface } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import { since, span } from './format.ts';

  let problem = $state('');
  let busy = $state<string | null>(null);
  let more = $state(false);

  const stateOf = (id: string) => argus.session?.listening.find((l) => l.id === id);
  const minor = (i: Interface) => i.up === false || i.type === 'docker' || i.type === 'loopback' || i.type === 'any' || i.type === 'other';
  const main = $derived(argus.interfaces.filter((i) => !minor(i) || stateOf(i.id)?.on));
  const rest = $derived(argus.interfaces.filter((i) => minor(i) && !stateOf(i.id)?.on));

  /** Interfaces that carry the same frames: listening on both counts them twice. */
  const overlap = $derived.by(() => {
    const on = argus.interfaces.filter((i) => stateOf(i.id)?.on);
    if (on.some((i) => i.type === 'any') && on.length > 1) return '«Todas» já inclui as outras: o que passa nelas conta duas vezes.';
    if (on.some((i) => i.id.startsWith('veth')) && on.some((i) => i.type === 'docker' && !i.id.startsWith('veth')))
      return 'Uma ponte do Docker e os contentores dela levam os mesmos pacotes: contam duas vezes.';
    return '';
  });

  async function toggle(i: Interface) {
    busy = i.id;
    problem = await argus.listen(i.id, !stateOf(i.id)?.on);
    busy = null;
  }

  function word(i: Interface): string {
    const s = stateOf(i.id);
    if (!i.capturable) return 'sem permissão';
    if (!s?.on) return i.up === false ? 'desligada' : i.id;
    if (s.status === 'failed') return 'parou';
    if (s.status === 'starting') return 'a abrir…';
    return s.since ? `há ${span(Date.now() / 1000 - s.since)}` : 'a escutar';
  }
</script>

{#snippet sw(i: Interface)}
  {@const s = stateOf(i.id)}
  <button
    class="sw"
    class:on={s?.on}
    class:failed={s?.status === 'failed'}
    role="switch"
    aria-checked={Boolean(s?.on)}
    disabled={!i.capturable || busy === i.id}
    onclick={() => toggle(i)}
    data-tip-entity="interface:{i.id}"
  >
    <i aria-hidden="true"></i>
    <span class="n">{i.name}</span>
    <span class="w">{word(i)}</span>
  </button>
{/snippet}

<div class="listen" role="group" aria-label="Onde escutar">
  {#each main as i (i.id)}{@render sw(i)}{/each}
  {#if rest.length}
    <button class="more" aria-expanded={more} onclick={() => (more = !more)}>{more ? 'Menos' : `Mais ${rest.length}`}</button>
  {/if}
</div>
{#if more}
  <div class="listen rest" role="group" aria-label="Outras interfaces">
    {#each rest as i (i.id)}{@render sw(i)}{/each}
  </div>
{/if}
{#each argus.session?.listening.filter((l) => l.on && l.status === 'failed') ?? [] as l (l.id)}
  <p class="why" role="status">{l.id} parou {l.since ? since(l.since) : ''}: {l.error}. Volta a tentar sozinho.</p>
{/each}
{#if argus.interfacesProblem && !argus.interfaces.some((i) => i.capturable)}
  <p class="why">
    Ainda não dá para escutar: {argus.interfacesProblem}. Falta correr, uma vez, <code>pkexec bash scripts/install-capture.sh</code>.
  </p>
{/if}
{#if overlap}<p class="why">{overlap}</p>{/if}
{#if problem}<p class="why" role="alert">{problem}</p>{/if}

<style>
  .listen {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .listen.rest {
    margin-top: 8px;
  }

  .sw {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 4px 12px 4px 10px;
    border: 1px solid var(--rule-strong);
    border-radius: 999px;
    background: var(--b0);
    color: var(--fg-2);
    font-size: 0.86rem;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }

  .sw:hover:not(:disabled) {
    background: var(--hover);
  }

  .sw:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .sw i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--faint);
  }

  .sw.on {
    border-color: var(--acc-line);
    background: var(--acc-soft);
    color: var(--fg);
  }

  .sw.on i {
    border-color: var(--acc);
    background: var(--acc);
    animation: listening 2.4s var(--ease) infinite;
  }

  .sw.failed i {
    border-color: var(--shaky);
    background: var(--shaky);
    animation: none;
  }

  @keyframes listening {
    50% {
      box-shadow: 0 0 0 4px var(--acc-soft);
    }
  }

  .n {
    font-weight: 550;
  }

  .w {
    font-size: 0.78rem;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }

  .sw.on .w {
    color: var(--muted);
  }

  .more {
    padding: 4px 10px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 0.84rem;
    cursor: pointer;
  }

  .more:hover {
    color: var(--fg);
  }

  .why {
    margin: 10px 0 0;
    font-size: 0.84rem;
    color: var(--shaky);
  }
</style>
