<script lang="ts">
  // Asking the network who is on it, beyond what passes through this PC: a scan of the LAN (it sends packets) and
  // reading the router (it logs in to it), each only when he presses its button, and only on the network this PC is on
  // now, since the others cannot be reached from here (server/sources.ts, server/routers.ts, docs/sources.md). He
  // chooses the network; for the one of here, the two buttons; for another, why not, and what was found there before.
  // Each time he asked is a run: when, on which network, what it found, and what Argus knew of each device before.
  import type { RunDevice, SourceRun } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import { since, when } from '../lib/format.ts';
  import { networks } from '../lib/networks.svelte.ts';
  import { link } from '../lib/router.svelte.ts';

  // Where this PC is, asked on opening, and again when a network is joined or left while the page is open (local reads
  // on the server: nothing is sent).
  // (The networks come again every second; only a change in which is on where asks again.)
  const joined = $derived(argus.networks.map((n) => `${n.id}:${n.nowOn?.join(',') ?? ''}`).join(' '));
  $effect(() => {
    void joined;
    void argus.loadHere().catch(() => (argus.here = null));
  });

  const here = $derived(argus.here);
  /** The id the network of here goes by on this page: its own, or "here" while Argus has not heard it yet. */
  const HERE = 'here';
  const hereId = $derived(here?.network ?? (here ? HERE : undefined));
  const nameOf = (id?: string) => (id === HERE || !id ? 'This network' : (argus.netList.find((n) => n.id === id)?.name ?? 'A network not heard in this session'));

  /** The networks to choose from: the one of here first, then the others Argus knows, the latest first. */
  const choices = $derived.by(() => {
    const out: { id: string; name: string; here: boolean }[] = [];
    if (hereId) out.push({ id: hereId, name: nameOf(hereId), here: true });
    for (const n of argus.netList) if (n.id !== hereId && (n.routers.length || n.id.startsWith('net:'))) out.push({ id: n.id, name: n.name, here: false });
    return out;
  });
  let picked = $state<string | undefined>(undefined);
  /** The one shown: his pick, else the bar's when it shows one network, else the one of here. */
  const chosen = $derived.by(() => {
    if (picked && choices.some((c) => c.id === picked)) return picked;
    const bar = networks.choice;
    if (bar !== 'now' && bar !== 'all' && choices.some((c) => c.id === bar)) return bar;
    return hereId ?? choices[0]?.id;
  });
  const isHere = $derived(Boolean(chosen && chosen === hereId));
  const chosenNet = $derived(argus.netList.find((n) => n.id === chosen));

  const scanState = $derived(argus.sources.find((s) => s.id === 'scan'));
  const routerState = $derived(argus.sources.find((s) => s.id === 'router'));
  const runs = $derived(argus.runs.filter((r) => (r.network ?? (r.iface === here?.iface ? hereId : undefined)) === chosen));
  const lastRouter = $derived(runs.find((r) => r.kind === 'router' && !r.error));

  let scanning = $state(false);
  let scanNote = $state('');
  let reading = $state(false);
  let routerNote = $state('');
  let asking = $state<{ hint?: string; user?: string; attemptsLeft?: number } | undefined>(undefined);
  let password = $state('');

  const network = () => (chosen === HERE ? undefined : chosen);

  async function scan() {
    scanning = true;
    scanNote = '';
    try {
      const r = await argus.scan(network());
      scanNote = r?.error ?? `${r?.found.length === 1 ? 'One device answered' : `${r?.found.length ?? 0} devices answered`}.`;
    } catch (err) {
      scanNote = (err as Error).message;
    } finally {
      scanning = false;
    }
  }

  async function read(e?: SubmitEvent) {
    e?.preventDefault();
    reading = true;
    routerNote = '';
    try {
      const r = await argus.readRouter(network(), password || undefined);
      if (r.ok) {
        asking = undefined;
        password = '';
        const n = r.run?.found.filter((d) => d.connected).length ?? 0;
        routerNote = `${r.model}: ${n === 1 ? 'one device connected' : `${n} devices connected`}.`;
      } else {
        // The field stays as typed when refused, to be corrected; a password asked for anew starts empty.
        asking = r.need ? { hint: r.hint, user: r.user, attemptsLeft: r.attemptsLeft } : undefined;
        routerNote = r.error ?? 'The router could not be read.';
      }
    } catch (err) {
      routerNote = (err as Error).message;
    } finally {
      reading = false;
    }
  }

  async function forget() {
    routerNote = '';
    try {
      await argus.forgetRouter();
      routerNote = 'Forgotten: the next reading asks for it again.';
    } catch (err) {
      routerNote = (err as Error).message;
    }
  }

  const KNOWN: Record<RunDevice['known'], string> = { heard: 'Heard', found: 'Found before', new: 'New' };
  const where = (d: RunDevice) =>
    d.link === 'cable' ? `Cable${d.port ? `, ${d.port}` : ''}` : d.link === 'wifi' ? `Wi-Fi${d.port ? ` ${d.port}` : ''}${d.ssid ? `, ${d.ssid}` : ''}` : '';
  const title = (r: SourceRun) => (r.kind === 'scan' ? 'Scan of the LAN' : `The router${r.router?.model ? `, ${r.router.model}` : ''}`);
  const summary = (r: SourceRun) => {
    if (r.error) return r.error;
    if (r.kind === 'scan') return r.found.length === 1 ? 'one device answered' : `${r.found.length} devices answered`;
    const on = r.found.filter((d) => d.connected).length;
    const off = r.found.length - on;
    return `${on === 1 ? 'one device connected' : `${on} devices connected`}${off ? `, ${off} more it remembers` : ''}`;
  };
  const fresh = (r: SourceRun) => r.found.filter((d) => d.known === 'new').length;
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">Scan</h1>
    <p class="page-lede">
      This PC hears mostly its own traffic. To see who else is on the network, Argus can ask it, in two ways. Both are
      <b>active</b>: each runs only when you press its button, only on the network this PC is on now. What they find is listed in
      <a href={link.devices()}>Devices</a>, apart from what was heard.
    </p>
  </header>

  {#if here === undefined}
    <p class="muted">Looking where this PC is…</p>
  {:else}
    {#if choices.length > 1}
      <div class="nets" role="group" aria-label="Which network">
        {#each choices as c (c.id)}
          <button class="net" class:on={c.id === chosen} aria-pressed={c.id === chosen} onclick={() => (picked = c.id)}>
            {c.name}{#if c.here}<span class="here-tag">here now</span>{/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if !here}
      <div class="empty-state">
        <h2>This PC is on no network now</h2>
        <p>There is no way out (no default route on a Wi-Fi or a cable), so there is no network to ask. What was found before is below.</p>
      </div>
    {:else if !isHere}
      <div class="elsewhere" role="note">
        <h2>Not on {nameOf(chosen)} now</h2>
        <p>
          A scan and the router can only be asked on the network this PC is on: from here, {nameOf(chosen)}{#if chosenNet}{' '}(last heard {since(chosenNet.last)}){/if} cannot be reached. This PC is on <button class="linkish" onclick={() => (picked = hereId)}>{nameOf(hereId)}</button> now.
        </p>
      </div>
    {:else}
      <div class="asks">
        <section class="ask" aria-labelledby="scan-h">
          <h2 id="scan-h">Scan the LAN <span class="active-tag">active · sends packets</span></h2>
          <p class="why">{scanState?.detail ?? ''}</p>
          {#if scanState?.on}
            <div class="row">
              <button class="primary" disabled={scanning} onclick={scan}>{scanning ? 'Scanning…' : `Scan ${here.iface} now`}</button>
              {#if scanState.last}<span class="muted">asked {since(scanState.last)}</span>{/if}
            </div>
            {#if scanNote}<p class="note" role="status">{scanNote}</p>{/if}
          {:else}
            <p class="muted">Turned off on this instance (ARGUS_SCAN=0, or the interfaces are made up).</p>
          {/if}
        </section>

        <section class="ask" aria-labelledby="router-h">
          <h2 id="router-h">Read the router <span class="active-tag">active · logs in to it</span></h2>
          <p class="why">{routerState?.detail ?? ''}</p>
          <dl class="props">
            <dt>Router</dt>
            <dd>{here.gateway}{here.router?.model ? ` · ${here.router.model}` : ''}</dd>
            <dt>Password</dt>
            <dd>
              {#if here.router?.saved}
                saved on this PC for {here.router.user ?? 'admin'} <button class="linkish" onclick={forget}>Forget it</button>
              {:else}
                none saved
              {/if}
            </dd>
          </dl>
          {#if lastRouter?.router?.factory}
            <p class="warn" role="alert">
              It let Argus in with its <b>factory password</b>, the same on every box of this model: anyone on this network can log in to it.
              Change it on the router’s own page.
            </p>
          {/if}
          {#if routerState?.on}
            {#if asking}
              <form class="pw" onsubmit={read}>
                <label for="router-pw">The router’s password{asking.user ? ` (user ${asking.user})` : ''}</label>
                <div class="row">
                  <input id="router-pw" type="password" autocomplete="off" bind:value={password} required />
                  <button class="primary" type="submit" disabled={reading || !password}>{reading ? 'Reading…' : 'Save and read'}</button>
                </div>
                {#if asking.hint}<p class="muted">{asking.hint}</p>{/if}
                <p class="muted">Kept on this PC only (~/.config/argus, readable by you alone), and only ever given to this router.</p>
              </form>
            {:else}
              <div class="row">
                <button class="primary" disabled={reading} onclick={() => read()}>{reading ? 'Reading…' : 'Read the router now'}</button>
                {#if routerState.last}<span class="muted">asked {since(routerState.last)}</span>{/if}
              </div>
            {/if}
            {#if routerNote}<p class="note" role="status">{routerNote}</p>{/if}
          {:else}
            <p class="muted">Turned off on this instance (ARGUS_ROUTER=0, or the interfaces are made up).</p>
          {/if}
        </section>
      </div>
    {/if}

    <section class="runs" aria-labelledby="runs-h">
      <h2 id="runs-h">Found on {nameOf(chosen)}</h2>
      {#if runs.length}
        {#each runs as r (r.id)}
          <article class="run" aria-label="{title(r)}, {when(r.at)}">
            <header>
              <b>{title(r)}</b>
              <span class="muted">· {when(r.at)} · {since(r.at)} · on {r.iface}</span>
              <span class:err={r.error}>{` · ${summary(r)}`}</span>{#if !r.error && fresh(r)}<span class="tag">{fresh(r)} new</span>{/if}
            </header>
            {#if r.router?.factory}<p class="warn">Read with the factory password.</p>{/if}
            {#if r.found.length}
              <div class="records-wrap">
                <table class="records" aria-label="Found by {title(r)}">
                  <thead>
                    <tr><th>Device</th><th class:hide-s={r.kind === 'router'}>Address</th><th class="hide-s">MAC</th>{#if r.kind === 'router'}<th>How</th>{/if}<th>Before</th></tr>
                  </thead>
                  <tbody>
                    {#each r.found as d (d.mac ?? d.ip)}
                      <tr data-found={d.mac ?? d.ip} class:gone={d.connected === false}>
                        <td>
                          {#if d.device}<a href={link.device(d.device)}>{d.name ?? d.hostname ?? d.ip ?? d.mac}</a>{:else}{d.hostname ?? d.ip ?? d.mac}{/if}
                          {#if d.name && d.hostname && d.name !== d.hostname}<span class="muted"> · {d.hostname}</span>{/if}
                        </td>
                        <td class="mono" class:hide-s={r.kind === 'router'}>{d.ip ?? ''}</td>
                        <td class="mono hide-s">{d.mac ?? ''}</td>
                        {#if r.kind === 'router'}<td>{where(d)}{#if d.connected === false}<span class="muted">{', not connected'}</span>{/if}</td>{/if}
                        <td><span class="known {d.known}">{KNOWN[d.known]}</span></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </article>
        {/each}
      {:else}
        <p class="muted">Nothing asked of this network since Argus started. What a scan or the router finds is kept until Argus restarts.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .nets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 18px;
  }

  .net {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 3px 12px;
    border: 1px solid var(--rule-strong);
    border-radius: 999px;
    background: var(--b0);
    color: var(--fg-2);
    font-size: 0.84rem;
    cursor: pointer;
  }

  .net.on {
    border-color: var(--acc);
    color: var(--fg);
    background: var(--acc-soft);
  }

  .here-tag {
    font-size: 0.72rem;
    color: var(--acc);
    font-weight: 600;
  }

  .asks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
    gap: 14px;
    margin-bottom: 28px;
  }

  .ask,
  .elsewhere {
    padding: 14px 16px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--b0);
  }

  .elsewhere {
    margin-bottom: 28px;
  }

  h2 {
    margin: 0 0 6px;
    font-size: 1.02rem;
    font-weight: 600;
  }

  .active-tag {
    margin-left: 4px;
    padding: 1px 7px;
    border: 1px solid var(--rule-strong);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
    vertical-align: 2px;
  }

  .why,
  .elsewhere p {
    max-width: 72ch;
    margin: 0 0 10px;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--fg-2);
  }

  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
  }

  .note {
    margin: 8px 0 0;
    font-size: 0.84rem;
  }

  .warn {
    margin: 8px 0;
    padding: 8px 10px;
    border-left: 3px solid var(--shaky);
    background: var(--shaky-soft);
    font-size: 0.84rem;
    line-height: 1.45;
  }

  .props {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 14px;
    margin: 0 0 12px;
    font-size: 0.84rem;
  }

  .props dt {
    color: var(--muted);
  }

  .props dd {
    margin: 0;
  }

  .pw label {
    display: block;
    margin-bottom: 4px;
    font-size: 0.84rem;
    font-weight: 500;
  }

  .pw input {
    flex: 1 1 180px;
    min-width: 0;
    max-width: 280px;
    min-height: 32px;
    padding: 4px 9px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--b1, var(--b0));
    color: var(--fg);
    font: inherit;
  }

  .pw .muted {
    margin: 6px 0 0;
    font-size: 0.8rem;
  }

  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--acc);
    font: inherit;
    cursor: pointer;
  }

  .runs h2 {
    margin-bottom: 10px;
  }

  .run {
    margin-bottom: 22px;
  }

  .run header {
    margin-bottom: 6px;
    font-size: 0.86rem;
  }

  .run .tag {
    margin-left: 8px;
  }

  .err {
    color: var(--shaky);
  }

  .mono {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 0.8rem;
  }

  tr.gone td {
    color: var(--muted);
  }

  .known {
    font-size: 0.8rem;
    color: var(--fg-2);
  }

  .known.new {
    color: var(--fg);
    font-weight: 600;
  }

  @media (max-width: 640px) {
    .hide-s {
      display: none;
    }
  }
</style>
