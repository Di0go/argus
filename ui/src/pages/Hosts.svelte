<script lang="ts">
  // The first page: choose where to listen, capture for 30 seconds, and see who was there. The devices on the local
  // network first (named, with their maker), then the hosts out on the internet they talked to.
  import type { Interface } from '../../../shared/types.ts';
  import EntityLink from '../lib/EntityLink.svelte';
  import { bytes, duration, when } from '../lib/format.ts';
  import { argus } from '../lib/state.svelte.ts';

  let chosen = $state<string[]>([]);
  let seconds = $state(30);
  let problem = $state('');
  let starting = $state(false);

  const capturable = $derived(argus.interfaces.filter((i) => i.capturable));
  /** Docker's bridges and containers, and what is down, folded under "Mais": the Wi-Fi, cables, VPNs stay in view. */
  const minor = (i: Interface) => i.up === false || (i.type === 'docker' && i.id !== 'docker0') || i.type === 'other';
  const main = $derived(argus.interfaces.filter((i) => !minor(i) || chosen.includes(i.id)));
  const more = $derived(argus.interfaces.filter((i) => minor(i) && !chosen.includes(i.id)));
  const running = $derived(argus.captures.find((c) => c.status === 'running'));
  const finished = $derived(argus.captures.filter((c) => c.status !== 'running'));
  const view = $derived(argus.view);
  // The Wi-Fi, when it is up, is chosen until he chooses otherwise.
  $effect(() => {
    if (!chosen.length) {
      const wifi = capturable.find((i) => i.type === 'wifi' && i.up);
      if (wifi) chosen = [wifi.id];
    }
  });

  function toggle(id: string) {
    chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
  }

  async function start() {
    starting = true;
    problem = await argus.start(chosen, seconds);
    starting = false;
  }

  function pick(id: string) {
    argus.selected = id;
    location.hash = `#/?c=${encodeURIComponent(id)}`;
  }

  const elapsed = $derived(running ? Math.min(running.seconds, Math.round(Date.now() / 1000 - running.started)) : 0);
</script>

<h1>Quem está na rede</h1>
<p class="muted">Escolhe onde escutar, captura uns segundos, e o Argus diz que dispositivos apareceram.</p>

<section class="panel" aria-label="Nova captura">
  {#snippet box(i: Interface)}
    <label class:off={!i.capturable || i.up === false} title={i.summary}>
      <input type="checkbox" checked={chosen.includes(i.id)} disabled={!i.capturable} onchange={() => toggle(i.id)} />
      {i.name}
    </label>
  {/snippet}
  <div class="ifaces" role="group" aria-label="Interfaces">
    {#each main as i (i.id)}{@render box(i)}{/each}
  </div>
  {#if more.length}
    <details>
      <summary class="muted">Mais {more.length}: desligadas, pontes e contentores Docker</summary>
      <div class="ifaces">{#each more as i (i.id)}{@render box(i)}{/each}</div>
    </details>
  {/if}
  <div class="go">
    <label
      >Durante
      <select bind:value={seconds}>
        {#each [10, 30, 60, 120, 300] as s (s)}<option value={s}>{duration(s)}</option>{/each}
      </select></label
    >
    <button class="primary" disabled={!chosen.length || starting || Boolean(running) || !capturable.length} onclick={start}>
      {running ? `A capturar… ${elapsed} / ${running.seconds} s` : 'Capturar'}
    </button>
  </div>
  {#if !capturable.length}
    <p class="problem">
      Ainda não dá para capturar{argus.interfacesProblem ? `: ${argus.interfacesProblem}` : ''}. Falta correr
      <span class="mono">pkexec bash scripts/install-capture.sh</span>.
    </p>
  {/if}
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
</section>

<p class="note">
  O Argus só escuta. O que vai cifrado não se lê: vê-se quem fala com quem, quando e quanto. Num PC numa rede comutada (um router
  ou switch normal) vê-se sobretudo o tráfego deste PC e o que os outros anunciam a todos (broadcast e multicast), não o que os
  outros dispositivos dizem entre si.
</p>

{#if finished.length}
  <div class="captures">
    <span class="muted">Captura:</span>
    <select aria-label="Captura" value={view?.capture.id} onchange={(e) => pick(e.currentTarget.value)}>
      {#each finished as c (c.id)}
        <option value={c.id} disabled={c.status !== 'done'}>
          {when(c.started)} · {c.interfaces.join(', ')} · {c.status === 'done' ? `${c.packets ?? 0} pacotes` : `falhou: ${c.error}`}
        </option>
      {/each}
    </select>
  </div>
{/if}

{#if argus.problem}<p class="problem">{argus.problem}</p>{/if}

{#if view}
  <h2>Na rede local <span class="muted">({view.devices.length})</span></h2>
  <table class="list" aria-label="Dispositivos">
    <thead>
      <tr><th>Dispositivo</th><th>IP</th><th>MAC</th><th>Fabricante</th><th class="num">Enviou</th><th class="num">Recebeu</th></tr>
    </thead>
    <tbody>
      {#each view.devices as d (d.id)}
        <tr data-device={d.id}>
          <td>
            <EntityLink entity={d} />
            {#if d.role === 'gateway'}<span class="chip acc">router</span>{/if}
            {#if d.role === 'self'}<span class="chip acc">este PC</span>{/if}
            {#each d.names.slice(0, 1) as n (n.name)}<span class="chip" data-tip="O nome que o próprio dispositivo deu, por {n.source}.">{n.source}</span>{/each}
          </td>
          <td class="mono">{d.ips.join(', ') || '—'}</td>
          <td class="mono">{d.mac ?? '—'}</td>
          <td>
            {#if d.vendor}{d.vendor}{:else if d.randomMac}<span class="muted" data-tip="O dispositivo inventou esta MAC (os telemóveis e portáteis fazem-no por rede), por isso não diz o fabricante.">MAC privada</span>{:else}<span class="muted">—</span>{/if}
          </td>
          <td class="num">{bytes(d.bytesSent)}</td>
          <td class="num">{bytes(d.bytesReceived)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <h2>Na internet <span class="muted">({view.remotes.length})</span></h2>
  {#if view.remotes.length}
    <table class="list" aria-label="Na internet">
      <thead><tr><th>Anfitrião</th><th>IP</th><th class="num">Enviou</th><th class="num">Recebeu</th></tr></thead>
      <tbody>
        {#each view.remotes.slice(0, 100) as r (r.id)}
          <tr>
            <td><EntityLink entity={r} /> {#each r.names.slice(0, 1) as n (n.name)}<span class="chip">{n.source}</span>{/each}</td>
            <td class="mono">{r.ip}</td>
            <td class="num">{bytes(r.bytesSent)}</td>
            <td class="num">{bytes(r.bytesReceived)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if view.remotes.length > 100}<p class="muted">E mais {view.remotes.length - 100}.</p>{/if}
  {:else}
    <p class="muted">Nenhum nesta captura.</p>
  {/if}
{:else if !running}
  <p class="muted">Ainda não há nenhuma captura terminada.</p>
{/if}

<style>
  .ifaces {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
  }
  .ifaces label {
    white-space: nowrap;
  }
  details {
    margin-top: 8px;
  }
  summary {
    cursor: pointer;
    font-size: 0.86rem;
    margin-bottom: 6px;
  }
  .ifaces .off {
    color: var(--muted);
  }
  .go {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-top: 12px;
  }
  .captures {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 20px;
  }
</style>
