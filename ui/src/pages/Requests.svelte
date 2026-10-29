<script lang="ts">
  // The HTTP requests that go by, newest first, as they happen (server/requests.ts): who asked, what (method and the
  // whole address), the answer, how big, how long. Plain HTTP from any device heard; HTTPS only where the keys were
  // there, the programs on this PC that write them to the key log file; everyone else's HTTPS stays encrypted, and the
  // page says how much of it there was. By device, by domain and by method, on the networks shown. A line opens to the
  // headers kept. For the live session, or a capture.
  import Lock from '@lucide/svelte/icons/lock';
  import { getJson } from '@organon/core/ui/live';
  import { matches } from '../../../shared/requests.ts';
  import type { Device, HttpRequest, RequestsView } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import ClearTag from '../lib/ClearTag.svelte';
  import { bytes, since, when } from '../lib/format.ts';
  import { link } from '../lib/router.svelte.ts';
  import SourceHead from '../lib/SourceHead.svelte';

  let { capture, device, host, method }: { capture?: string; device?: string; host?: string; method?: string } = $props();

  const source = $derived(argus.sourceFor(capture, true));
  const live = $derived(!capture);

  // The filter, from the address at first (a device's page links here with its own), then his.
  let who = $state('');
  let domain = $state('');
  let verb = $state('');
  $effect.pre(() => {
    who = device ?? '';
    domain = host ?? '';
    verb = method?.toUpperCase() ?? '';
  });
  // The address follows the filter, without a step in the history for each letter typed.
  $effect(() => {
    const want = link.requests({ device: who || undefined, host: domain.trim() || undefined, method: verb || undefined }, capture);
    if (location.hash !== want) history.replaceState(history.state, '', want);
  });

  // A capture's requests are asked for once; the live session's are the page store's, kept current from the stream.
  let saved = $state<RequestsView | null>(null);
  let problem = $state('');
  $effect(() => {
    if (capture) {
      getJson<RequestsView>(`/api/requests?capture=${encodeURIComponent(capture)}&limit=2000`)
        .then((v) => (saved = v))
        .catch((e: Error) => (problem = e.message));
      return;
    }
    if (!argus.requestsLoaded) argus.loadRequests().catch((e: Error) => (problem = e.message));
    // What the keys and the encrypted conversations say changes as it goes: asked again every ten seconds.
    const again = setInterval(() => void argus.loadRequests().catch(() => {}), 10_000);
    return () => clearInterval(again);
  });

  const info = $derived(capture ? saved : argus.requestsInfo);
  const all = $derived.by((): HttpRequest[] => {
    const list = capture ? (saved?.requests ?? []) : Object.values(argus.requests);
    return [...list].sort((a, b) => b.time - a.time);
  });
  const networks = $derived(live && argus.shown ? argus.shown : undefined);
  const here = $derived(all.filter((r) => matches(r, { networks })));
  const rows = $derived(here.filter((r) => matches(r, { device: who || undefined, host: domain.trim() || undefined, method: verb || undefined })));

  /** The devices and methods there are to choose from, the busiest first. */
  const devices = $derived.by(() => {
    const n = new Map<string, number>();
    for (const r of here) if (r.device) n.set(r.device, (n.get(r.device) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count, name: nameOf(id) }));
  });
  const methods = $derived.by(() => {
    const n = new Map<string, number>();
    for (const r of here) n.set(r.method, (n.get(r.method) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  });
  const hosts = $derived([...new Set(here.map((r) => r.host).filter(Boolean))].sort().slice(0, 300));

  const nameOf = (id?: string) => (id ? (argus.sourceFor(capture)?.graph.get(`device:${id}`)?.name ?? id) : '');
  const unread = $derived((info?.unread ?? []).filter((u) => !who || u.device === who));
  const unreadMine = $derived(unread.filter((u) => (argus.sourceFor(capture)?.graph.get(`device:${u.device}`) as Device | undefined)?.role === 'self'));
  const unreadOthers = $derived(unread.filter((u) => !unreadMine.includes(u)));
  const count = (list: { conversations: number }[]) => list.reduce((n, u) => n + u.conversations, 0);

  let shown = $state(200);
  let open = $state<string | null>(null);
  const fresh = (r: HttpRequest) => live && Date.now() / 1000 - r.time < 4;
  const clock = (t: number) => new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const took = (r: HttpRequest) => (r.response ? `${Math.max(0, Math.round((r.response.time - r.time) * 1000))} ms` : '');
  /** The address without its scheme and host: what was asked of the host. */
  function pathOf(r: HttpRequest): string {
    const m = /^[a-z]+:\/\/[^/]*(.*)$/i.exec(r.url);
    return m?.[1] || '/';
  }
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">Requests</h1>
    <p class="page-lede">
      The web requests that go by, as they happen: who asked, the whole address, the answer and its size. Plain HTTP is read from any
      device heard; HTTPS only from the programs on this PC that write their keys. Never a body, and of cookies and logins only that they
      went.
    </p>
    {#if source}<SourceHead {source} />{/if}
  </header>

  {#if problem}
    <p class="note">The requests could not be loaded: {problem}</p>
  {/if}

  <section class="band keys" aria-label="What can be read">
    {#if capture}
      <p>
        <Lock size={14} strokeWidth={2} aria-hidden="true" />
        HTTPS in a capture is read with the keys the key log file holds now: a session whose keys are gone stays encrypted.
      </p>
    {:else if info && !info.keys.file}
      <p>
        <Lock size={14} strokeWidth={2} aria-hidden="true" />
        <strong>HTTPS is not read:</strong> no key log file is set, so only plain HTTP shows here. To read this PC's own HTTPS, the browsers
        must write their keys (SSLKEYLOGFILE): <code>scripts/tls-keys.sh on</code> says how, and what it means.
      </p>
    {:else if info && !info.keys.exists}
      <p>
        <Lock size={14} strokeWidth={2} aria-hidden="true" />
        <strong>No keys yet:</strong> the key log file is set (<code>{info.keys.file}</code>) but nothing has written to it. A browser writes
        there once it was started in a session that has SSLKEYLOGFILE.
      </p>
    {:else if info}
      <p>
        <Lock size={14} strokeWidth={2} aria-hidden="true" />
        <strong>Reading this PC's HTTPS</strong> with the keys in <code>{info.keys.file}</code> ({bytes(info.keys.bytes ?? 0)}, written
        {since(info.keys.modified ?? 0)}). Whoever has this file and a capture can read everything the browser did in it.
      </p>
    {/if}
    {#if count(unread)}
      <p class="unread">
        Encrypted and not read:
        {#if count(unreadMine)}{count(unreadMine)} conversations of this PC without keys{#if count(unreadOthers)};{/if}{/if}
        {#if count(unreadOthers)}
          {count(unreadOthers)} of other devices ({unreadOthers
            .slice(0, 3)
            .map((u) => nameOf(u.device))
            .join(', ')}{unreadOthers.length > 3 ? '…' : ''}): their keys are on them, never here
        {/if}.
      </p>
    {/if}
  </section>

  <section class="band">
    <div class="band-h filters">
      <h2>{rows.length === here.length ? `${here.length} requests` : `${rows.length} of ${here.length}`}</h2>
      <span class="tools">
        <select class="input" aria-label="Device" bind:value={who}>
          <option value="">Every device</option>
          {#each devices as d (d.id)}<option value={d.id}>{d.name} ({d.count})</option>{/each}
          {#if who && !devices.some((d) => d.id === who)}<option value={who}>{nameOf(who)}</option>{/if}
        </select>
        <input class="input" type="search" list="request-hosts" placeholder="Domain" aria-label="Domain" bind:value={domain} />
        <datalist id="request-hosts">{#each hosts as h (h)}<option value={h}></option>{/each}</datalist>
        <select class="input" aria-label="Method" bind:value={verb}>
          <option value="">Every method</option>
          {#each methods as m (m)}<option value={m}>{m}</option>{/each}
          {#if verb && !methods.includes(verb)}<option value={verb}>{verb}</option>{/if}
        </select>
      </span>
    </div>

    <div class="records-wrap">
      <table class="records reqs" aria-label="Requests">
        <thead>
          <tr>
            <th class="t">When</th>
            <th>Request</th>
            <th class="hide-s dev">Device</th>
            <th class="num">Answer</th>
            <th class="num hide-s">Size</th>
            <th class="num hide-s">Took</th>
          </tr>
        </thead>
        <tbody>
          {#each rows.slice(0, shown) as r (r.id)}
            <tr class="req" class:fresh={fresh(r)} class:open={open === r.id} data-request={r.id}>
              <td class="t mono" title={when(r.time)}>{clock(r.time)}</td>
              <td class="what">
                <button class="line" aria-expanded={open === r.id} onclick={() => (open = open === r.id ? null : r.id)}>
                  <span class="m mono">{r.method}</span>
                  <span class="u"><span class="h">{r.host}</span><span class="p">{pathOf(r)}</span></span>
                </button>
                {#if r.tls}<span class="read" title="HTTPS, read with the session's keys from the key log file" role="img" aria-label="HTTPS read with its keys"
                    ><Lock size={12} strokeWidth={2} aria-hidden="true" /></span
                  >{:else}<ClearTag clear={{ proto: 'HTTP', ...(r.authorization ? { credentials: true } : {}) }} />{/if}
                <span class="sub show-s">{nameOf(r.device)}{#if r.response?.size !== undefined}{` · ${bytes(r.response.size)}`}{/if}</span>
              </td>
              <td class="hide-s dev">{nameOf(r.device)}</td>
              <td class="num st">{r.response?.status ?? '—'}</td>
              <td class="num hide-s">{r.response?.size !== undefined ? bytes(r.response.size) : ''}</td>
              <td class="num hide-s muted">{took(r)}</td>
            </tr>
            {#if open === r.id}
              <tr class="detail">
                <td colspan="6">
                  <p class="full mono">{r.url}</p>
                  <dl>
                    <dt>Asked by</dt>
                    <dd>{nameOf(r.device) || '—'}, {r.version}{r.ip ? ` to ${r.ip}${r.port ? `:${r.port}` : ''}` : ''}, {when(r.time)}</dd>
                    {#each Object.entries(r.headers) as [k, v] (k)}<dt class="mono">{k}</dt><dd class="mono">{v}</dd>{/each}
                    {#if r.cookie}<dt class="mono">cookie</dt><dd class="muted">sent; its value is not kept</dd>{/if}
                    {#if r.authorization}<dt class="mono">authorization</dt><dd class="muted">sent; its value is not kept</dd>{/if}
                    {#if r.response}
                      <dt>Answer</dt>
                      <dd>{r.response.status}{r.response.phrase ? ` ${r.response.phrase}` : ''}, after {took(r)}{r.response.size !== undefined ? `, ${bytes(r.response.size)}` : ''}</dd>
                      {#each Object.entries(r.response.headers) as [k, v] (k)}<dt class="mono">{k}</dt><dd class="mono">{v}</dd>{/each}
                      {#if r.response.setCookie}<dt class="mono">set-cookie</dt><dd class="muted">sent; its value is not kept</dd>{/if}
                    {:else}
                      <dt>Answer</dt>
                      <dd class="muted">Not seen (yet).</dd>
                    {/if}
                  </dl>
                  <p class="muted small">
                    Headers it carried: {r.names.join(', ') || 'none'}{r.response?.names.length ? `; the answer's: ${r.response.names.join(', ')}` : ''}. Only those
                    above are kept with their values. {r.tls
                      ? 'Read inside its TLS with the keys from the key log file.'
                      : 'It went in the clear: anyone on the way could read it, and the ring buffer holds it as it was.'}
                  </p>
                </td>
              </tr>
            {/if}
          {:else}
            <tr>
              <td colspan="6" class="muted">
                {#if here.length}None of these with this filter.{:else if live && !argus.session?.listening.some((l) => l.on)}Not listening: turn an
                  interface on to see the requests as they go.{:else}No request read yet.{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if rows.length > shown}
      <button class="link more" onclick={() => (shown += 300)}>{rows.length - shown} more</button>
    {/if}
    {#if info}
      <p class="muted small kept">
        {live ? `The newest ${info.max} are kept, in memory and with the session in data/live;` : ''} the addresses are whole, query and
        all: a token in one is kept with it.
      </p>
    {/if}
  </section>
</div>

<style>
  .keys {
    font-size: 0.9rem;
    color: var(--fg-2);
  }

  .keys p {
    margin: 0 0 6px;
    max-width: 72ch;
  }

  .keys :global(svg) {
    vertical-align: -2px;
    margin-right: 4px;
  }

  .keys code {
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }

  .unread {
    color: var(--muted);
  }

  .filters .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filters .input {
    width: auto;
    max-width: 220px;
    padding: 4px 10px;
    font-size: 0.86rem;
  }

  .filters input.input {
    width: 180px;
  }

  .reqs {
    width: 100%;
    table-layout: fixed;
  }

  .t {
    width: 6.5em;
    white-space: nowrap;
    color: var(--muted);
  }

  .dev {
    width: 14%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  th.num,
  td.num {
    width: 5.5em;
    white-space: nowrap;
  }

  .what {
    overflow: hidden;
    white-space: nowrap;
  }

  .line {
    display: inline-flex;
    max-width: calc(100% - 24px);
    align-items: baseline;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .m {
    flex: none;
    min-width: 3.4em;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--fg-2);
  }

  .u {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .h {
    font-weight: 500;
    color: var(--fg);
  }

  .p {
    color: var(--muted);
  }

  .read {
    display: inline-block;
    margin-left: 6px;
    color: var(--faint);
    vertical-align: -1px;
  }

  .what :global(.clear-tag) {
    margin-left: 6px;
  }

  .st {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  tr.fresh td {
    animation: arrive 4s var(--ease);
  }

  @keyframes arrive {
    from {
      background: var(--b2);
    }
  }

  .detail td {
    padding: 10px 12px 14px;
    background: var(--b1);
    white-space: normal;
  }

  .full {
    margin: 0 0 10px;
    font-size: 0.84rem;
    overflow-wrap: anywhere;
  }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 16px;
    margin: 0 0 10px;
    font-size: 0.84rem;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .more {
    margin-top: 8px;
    font-size: 0.86rem;
  }

  .kept {
    margin-top: 10px;
  }

  .sub {
    display: none;
  }

  @media (max-width: 640px) {
    .hide-s {
      display: none;
    }

    /* A fixed table keeps the hidden columns' widths: here the request takes all that is left (max-width: 0 lets the
       cell of an auto table go below its text's width, the text cut with an ellipsis). */
    .reqs {
      table-layout: auto;
    }

    .what {
      width: 100%;
      max-width: 0;
    }

    .t {
      width: 5.2em;
      font-size: 0.8rem;
    }

    .sub.show-s {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      font-size: 0.78rem;
      color: var(--muted);
      text-overflow: ellipsis;
    }

    .line {
      max-width: calc(100% - 22px);
    }

    .filters .input,
    .filters input.input {
      flex: 1 1 140px;
      max-width: none;
    }

    dl {
      grid-template-columns: 1fr;
    }

    dt {
      margin-top: 4px;
    }
  }
</style>
