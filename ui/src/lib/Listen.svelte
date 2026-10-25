<script lang="ts">
  // Where to listen: the networks as a list, a row each, with what it is (its name, its kind and the interface's own
  // name), how it is going (listening for how long, opening, why it stopped, off), how many devices were heard on it,
  // how fast it moves now with its last two minutes, and a switch, on and off each on its own, several at once. The
  // ones that usually matter (Wi-Fi, cable, VPN, up) in view; the rest (Docker's bridges, what is down, loopback, all
  // at once) folded under the list. The name opens the network's page: its devices and its conversations.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import type { Interface } from '../../../shared/types.ts';
  import { argus } from './argus.svelte.ts';
  import EntityIcon from './EntityIcon.svelte';
  import { rate, since, span } from './format.ts';
  import { link } from './router.svelte.ts';
  import Spark from './Spark.svelte';

  let { variant = 'list' }: { variant?: 'list' | 'menu' } = $props();

  let problem = $state('');
  let busy = $state<string | null>(null);
  let more = $state(false);
  let open = $state(false);
  let root = $state<HTMLElement>();

  const stateOf = (id: string) => argus.session?.listening.find((l) => l.id === id);
  const minor = (i: Interface) => i.up === false || i.type === 'docker' || i.type === 'loopback' || i.type === 'any' || i.type === 'other';
  const main = $derived(argus.interfaces.filter((i) => !minor(i) || stateOf(i.id)?.on));
  const rest = $derived(argus.interfaces.filter((i) => minor(i) && !stateOf(i.id)?.on));
  const on = $derived(argus.interfaces.filter((i) => stateOf(i.id)?.on));
  /** The busiest network's busiest second in the last two minutes: the pulses' common scale. */
  const peak = $derived(
    Math.max(
      1,
      ...Object.values(argus.byInterface).map((s) => {
        let m = 0;
        for (let i = Math.max(0, s.sent.length - 120); i < s.sent.length; i++) m = Math.max(m, s.sent[i] ?? 0);
        return m;
      }),
    ),
  );
  const devicesOn = (id: string) => argus.liveSource.devices.filter((d) => d.interfaces.includes(id)).length;

  /** Interfaces that carry the same frames: listening on both counts them twice. */
  const overlap = $derived.by(() => {
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

  /** How it is going, in a few words, and its tone. */
  function status(i: Interface): { text: string; tone: '' | 'on' | 'warn' | 'off' } {
    const s = stateOf(i.id);
    if (!i.capturable) return { text: 'Sem permissão para escutar', tone: 'off' };
    if (!s?.on) return { text: i.up === false ? 'Desligada' : 'Sem escutar', tone: i.up === false ? 'off' : '' };
    if (s.status === 'failed') return { text: `Parou ${s.since ? since(s.since) : ''}`.trim(), tone: 'warn' };
    if (s.status === 'starting') return { text: 'A abrir…', tone: 'on' };
    return { text: s.since ? `A escutar há ${span(Date.now() / 1000 - s.since)}` : 'A escutar', tone: 'on' };
  }

  const KIND: Record<Interface['type'], string> = {
    wifi: 'Wi-Fi',
    cable: 'Cabo',
    docker: 'Docker',
    vpn: 'VPN',
    loopback: 'Este PC',
    any: 'Todas as interfaces',
    other: 'Outra',
  };

  function outside(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

{#snippet row(i: Interface)}
  {@const s = stateOf(i.id)}
  {@const st = status(i)}
  {@const n = devicesOn(i.id)}
  <li class="net" class:on={s?.on} class:failed={s?.status === 'failed'} class:unable={!i.capturable}>
    <EntityIcon entity={i} size={34} />
    <span class="what">
      <a class="name" href={link.interface(i.id)} data-tip-entity="interface:{i.id}">{i.name}</a>
      <span class="kind">{#if KIND[i.type] !== i.name}{KIND[i.type]}{/if}<span class="id">{i.id}</span></span>
    </span>
    <span class="st {st.tone}"><i aria-hidden="true"></i>{st.text}</span>
    <span class="devs">{#if s?.on && n}{n === 1 ? '1 dispositivo' : `${n} dispositivos`}{/if}</span>
    <span class="pulse">{#if s?.on}<Spark series={argus.byInterface[i.id]} max={peak} width={88} height={22} />{/if}</span>
    <span class="rate">{s?.on ? rate(s.rate) : ''}</span>
    <button
      class="toggle"
      role="switch"
      aria-checked={Boolean(s?.on)}
      aria-label="Escutar em {i.name} ({i.id})"
      disabled={!i.capturable || busy === i.id}
      onclick={() => toggle(i)}><span class="knob"></span></button
    >
  </li>
{/snippet}

{#snippet list()}
  <ul class="nets" aria-label="Onde escutar">
    {#each main as i (i.id)}{@render row(i)}{/each}
    {#if more}{#each rest as i (i.id)}{@render row(i)}{/each}{/if}
  </ul>
  {#if rest.length}
    <button class="fold" aria-expanded={more} onclick={() => (more = !more)}>
      <ChevronDown size={14} strokeWidth={2} class={more ? 'up' : ''} />
      {more ? 'Só as principais' : `Mais ${rest.length}: ${rest.map((i) => i.name).join(', ')}`}
    </button>
  {/if}
{/snippet}

{#if variant === 'menu'}
  <div class="menu-wrap" bind:this={root}>
    <button class="menu-button" aria-haspopup="true" aria-expanded={open} onclick={() => (open = !open)}>
      {#if on.length}<i class="live" aria-hidden="true"></i>{/if}
      <span class="mb-l">{on.length ? `A escutar ${on.map((i) => i.name).join(' e ')}` : 'Escolher onde escutar'}</span>
      {#if on.length}<span class="mb-r">{rate(argus.meter)}</span>{/if}
      <ChevronDown size={15} strokeWidth={2} />
    </button>
    {#if open}<div class="menu-pop">{@render list()}</div>{/if}
  </div>
{:else}
  <div class="panel listen">{@render list()}</div>
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
    padding: 6px 8px;
  }

  .nets {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .net {
    display: grid;
    grid-template-columns: 34px minmax(9em, 15em) 12em minmax(0, 1fr) 88px 6em 40px;
    align-items: center;
    gap: 14px;
    padding: 9px 10px;
    border-radius: var(--radius);
  }

  .net + .net {
    border-top: 1px solid var(--rule);
  }

  .net.unable {
    opacity: 0.6;
  }

  .net.on :global(.ei) {
    background: var(--acc-soft);
    color: var(--acc);
  }

  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.35;
  }

  .name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name:hover {
    color: var(--acc);
    text-decoration: none;
  }

  .kind {
    overflow: hidden;
    font-size: 0.78rem;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .id:not(:first-child) {
    margin-left: 8px;
  }

  .id {
    font-family: var(--mono);
    font-size: 0.74rem;
    color: var(--faint);
  }

  .st {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    font-size: 0.84rem;
    color: var(--muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .st i {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--faint);
  }

  .st.on {
    color: var(--fg);
  }

  .st.on i {
    border-color: var(--acc);
    background: var(--acc);
    animation: listening 2.4s var(--ease) infinite;
  }

  .st.warn {
    color: var(--shaky);
  }

  .st.warn i {
    border-color: var(--shaky);
    background: var(--shaky);
  }

  .st.off i {
    border-style: dashed;
  }

  @keyframes listening {
    50% {
      box-shadow: 0 0 0 4px var(--acc-soft);
    }
  }

  .devs {
    text-align: right;
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .pulse {
    display: flex;
    color: var(--acc);
  }

  .rate {
    text-align: right;
    font-size: 0.86rem;
    font-weight: 600;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* The switch: a track and a knob, the accent when on. */
  .toggle {
    position: relative;
    justify-self: end;
    width: 36px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--rule-strong);
    cursor: pointer;
    transition: background-color 0.18s var(--ease);
  }

  .toggle .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
    transition: transform 0.18s var(--ease);
  }

  .toggle[aria-checked='true'] {
    background: var(--acc);
  }

  .toggle[aria-checked='true'] .knob {
    transform: translateX(16px);
  }

  .toggle:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .toggle:focus-visible {
    outline: 2px solid var(--acc);
    outline-offset: 2px;
  }

  .fold {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 2px 10px;
    padding: 4px 0;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 0.82rem;
    cursor: pointer;
  }

  .fold:hover {
    color: var(--fg);
  }

  .fold :global(.up) {
    transform: rotate(180deg);
  }

  .why {
    margin: 10px 0 0;
    font-size: 0.84rem;
    color: var(--shaky);
  }

  /* The other way: one button that says where it listens, the same list in a menu under it. */
  .menu-wrap {
    position: relative;
    display: inline-block;
    max-width: 100%;
  }

  .menu-button {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    max-width: 100%;
    min-height: 38px;
    padding: 6px 12px 6px 14px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--b0);
    color: var(--fg);
    font-size: 0.9rem;
    font-weight: 550;
    cursor: pointer;
  }

  .menu-button:hover {
    background: var(--hover);
  }

  .mb-l {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mb-r {
    color: var(--muted);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .live {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--acc);
  }

  .menu-pop {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: 0;
    width: min(900px, calc(100vw - 32px));
    padding: 6px 8px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--b0);
    box-shadow: var(--shadow);
  }

  @media (max-width: 900px) {
    .net {
      grid-template-columns: 34px minmax(0, 1fr) auto 40px;
      grid-template-areas: 'icon what rate toggle' 'icon state state state';
      gap: 2px 12px;
    }

    .net > :global(.ei) {
      grid-area: icon;
      align-self: start;
      margin-top: 2px;
    }

    .what {
      grid-area: what;
    }

    .st {
      grid-area: state;
      font-size: 0.78rem;
    }

    .rate {
      grid-area: rate;
    }

    .toggle {
      grid-area: toggle;
    }

    .devs,
    .pulse {
      display: none;
    }
  }
</style>
