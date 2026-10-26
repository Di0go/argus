<script lang="ts">
  // Privacy and safety, for the whole network or one device: first what went without encryption (in the colour that
  // means it, each line a link, the harmless ones and those inside the house said quietly under it), then tracking
  // and telemetry, where the data goes, and how names are looked up and which servers agreed old TLS. Facts, no score.
  // `full` lists everything (the Privacy page); otherwise the first few of each.
  import Lock from '@lucide/svelte/icons/lock';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import type { Source } from './argus.svelte.ts';
  import { argus } from './argus.svelte.ts';
  import ClearTag from './ClearTag.svelte';
  import { bytes, since, when } from './format.ts';
  import type { ClearLine, Privacy } from './privacy.ts';
  import { entityHref, link } from './router.svelte.ts';

  let {
    p,
    source,
    recent,
    full = false,
    hour = true,
    capture,
  }: { p: Privacy; source: Source; recent?: Privacy; full?: boolean; hour?: boolean; capture?: string } = $props();

  const live = $derived(source.kind === 'live');
  /** The colour is for the last hour (live) or the capture; the rest of the session is said under it. */
  const shown = $derived(recent ?? p);
  const n = $derived(full ? Infinity : 4);
  const COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)'];
  const where = $derived(p.where.slice(0, 4));
  const whereRest = $derived(p.where.slice(4).reduce((s, w) => s + w.bytes, 0));
  const pct = (x: number, of: number) => (!of || !x ? '0%' : x / of < 0.01 ? 'under 1%' : `${Math.round((100 * x) / of)}%`);
  const width = (x: number, of: number) => (of ? `${Math.max(x ? 0.6 : 0, (100 * x) / of)}%` : '0%');
  const hrefOf = (key: string) => {
    const [kind = '', ...id] = key.split(':');
    return entityHref(kind, id.join(':'), capture);
  };
  const ago = (t: number) => (live ? since(t) : when(t));
  const earlier = $derived(recent ? p.clear.filter((l) => !recent.clear.some((r) => r.c.id === l.c.id)) : []);
</script>

{#snippet line(l: ClearLine, quiet = false)}
  <li class:quiet>
    <span class="who">
      {#if l.device}<a class="dev" href={link.device(l.device.id, capture)}>{l.device.name}</a>{/if}
      <span class="arrow" aria-hidden="true">→</span>
      <a class="other" href={hrefOf(l.otherKey)}>{l.other}</a>
    </span>
    <span class="how"><ClearTag clear={l.c.clear!} />{#if full}<span class="when"> {ago(l.c.last)}</span>{/if}</span>
  </li>
{/snippet}

<div class="privacy" class:full>
  <section class="box" class:on={shown.clear.length} aria-label="Without encryption">
    <h2>
      {#if shown.clear.length}<LockOpen size={17} strokeWidth={2.4} aria-hidden="true" />{:else}<Lock size={16} aria-hidden="true" />{/if}
      Without encryption{live && hour && recent ? ' · last hour' : ''}
    </h2>
    {#if shown.clear.length}
      <ul class="lines">
        {#each shown.clear.slice(0, n) as l (l.c.id)}{@render line(l)}{/each}
      </ul>
      {#if shown.clear.length > n}<a class="more" href={link.privacy(capture)}>All {shown.clear.length}</a>{/if}
      <p class="note">
        Anyone on the way can read what these carry{shown.clear.some((l) => l.c.clear?.credentials)
          ? ', the logins too. Argus keeps only that one went by; the ring buffer of the last minutes holds the raw packets, and so does a capture saved from it'
          : ''}.
      </p>
    {:else}
      <p class="calm">Nothing went unencrypted{live && recent ? ' in the last hour' : ''}.</p>
    {/if}
    {#if earlier.length}<p class="note">Earlier in the session: {earlier.length} more, <a href={link.privacy(capture)}>listed</a>.</p>{/if}
    {#if full && p.local.length}
      <h3>Inside the house, without a login</h3>
      <ul class="lines">{#each p.local as l (l.c.id)}{@render line(l, true)}{/each}</ul>
    {/if}
    {#if p.harmless.length || p.local.length}
      {#if full && p.harmless.length}
        <h3>Harmless by design</h3>
        <ul class="lines">{#each p.harmless as l (l.c.id)}{@render line(l, true)}{/each}</ul>
      {:else if !full}
        <p class="note">
          Not counted: {[
            p.harmless.length ? `${p.harmless.length} harmless (connectivity checks, certificate lists, signed updates)` : '',
            p.local.length ? `${p.local.length} inside the house without a login` : '',
          ]
            .filter(Boolean)
            .join(' and ')}.
        </p>
      {/if}
    {/if}
  </section>

  <section aria-label="Tracking and telemetry">
    <h2>Tracking and telemetry</h2>
    {#if p.tracking.length}
      <div class="bar" aria-hidden="true"><i style:width={width(p.trackingBytes, p.bytes)} style:background="var(--fg-2)"></i></div>
      <p class="note">{pct(p.trackingBytes, p.bytes).replace(/^u/, 'U')} of the traffic ({bytes(p.trackingBytes)}) went to advertising, tracking or telemetry.</p>
      <ul class="kv">
        {#each p.tracking.slice(0, full ? 50 : 4) as t (t.company)}
          <li>
            <span>{t.company}</span>
            <span class="muted">{t.devices.length === 1 ? t.devices[0]!.name : `${t.devices.length} devices`} · {bytes(t.bytes)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="calm">None seen.</p>
    {/if}
  </section>

  <section aria-label="Where the data goes">
    <h2>Where the data goes</h2>
    {#if where.length}
      <div class="bar" aria-hidden="true">
        {#each where as w, i (w.cc)}<i style:width={width(w.bytes, p.whereBytes)} style:background={COLORS[i]}></i>{/each}
        {#if whereRest}<i style:width={width(whereRest, p.whereBytes)} style:background="var(--cat-other)"></i>{/if}
      </div>
      <ul class="legend-l">
        {#each where as w, i (w.cc)}<li><i style:background={COLORS[i]}></i>{w.country} {pct(w.bytes, p.whereBytes)}</li>{/each}
        {#if whereRest}<li><i style:background="var(--cat-other)"></i>{p.where.length - 4} others {pct(whereRest, p.whereBytes)}</li>{/if}
      </ul>
      <p class="note">The country each host's network is registered in (iptoasn.com), not where the server stands.</p>
    {:else}
      <p class="calm">
        {!argus.geo ? 'Unknown: the table of networks is not there yet (pnpm geo).' : p.bytes ? 'Not known: these hosts’ networks are not in the table.' : 'Nothing out on the internet yet.'}
      </p>
    {/if}
  </section>

  <section aria-label="Names and encryption">
    <h2>DNS and TLS</h2>
    <ul class="kv">
      {#if p.dnsHouse}<li><span>Ask the house's DNS</span><span class="muted">{p.dnsHouse === 1 ? '1 device' : `${p.dnsHouse} devices`} (plain DNS, as usual at home)</span></li>{/if}
      {#each p.dns as u (u.device.id + u.kind)}
        <li>
          <a href={link.device(u.device.id, capture)}>{u.device.name}</a>
          <span class:muted={u.kind === 'encrypted'}>{u.kind === 'encrypted' ? `encrypted DNS, ${u.names.join(', ')}` : `asks ${u.names.join(', ')} directly`}</span>
        </li>
      {/each}
      {#if !p.dnsHouse && !p.dns.length}<li><span class="muted">No name looked up yet.</span></li>{/if}
      <li>
        <span>Old TLS (1.0, 1.1)</span>
        {#if p.oldTls.length}
          <span>{#each p.oldTls.slice(0, full ? 50 : 3) as l, i (l.c.id)}{i ? ', ' : ''}<a href={hrefOf(l.otherKey)}>{l.other}</a>{/each}</span>
        {:else}<span class="muted">none</span>{/if}
      </li>
    </ul>
  </section>
</div>

<style>
  .privacy {
    display: grid;
    gap: 26px;
    align-content: start;
  }

  .privacy.full {
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 30px 44px;
  }

  .privacy.full .box {
    grid-column: 1 / -1;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 10px;
    font-size: 1.02rem;
  }

  h3 {
    margin: 14px 0 4px;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--muted);
  }

  .box {
    padding: 13px 15px;
    border-radius: 12px;
    border: 1px solid var(--rule);
  }

  .box.on {
    border-color: var(--clear-line);
    background: var(--clear-soft);
  }

  .box.on h2 {
    color: var(--clear);
  }

  .lines,
  .kv,
  .legend-l {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .lines li,
  .kv li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 0.9rem;
  }

  .box.on .lines li {
    border-color: var(--clear-line);
  }

  .who {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .dev {
    color: var(--fg);
    font-weight: 600;
  }

  .other {
    color: var(--fg);
  }

  .arrow {
    color: var(--muted);
    margin: 0 3px;
  }

  .how {
    flex: none;
    text-align: right;
  }

  .when {
    font-size: 0.8rem;
    color: var(--muted);
  }

  li.quiet .dev,
  li.quiet .other {
    font-weight: 400;
    color: var(--fg-2);
  }

  .note,
  .calm {
    margin: 8px 0 0;
    font-size: 0.82rem;
    color: var(--muted);
  }

  .calm {
    font-size: 0.9rem;
    margin: 0;
  }

  .more {
    display: inline-block;
    margin-top: 6px;
    font-size: 0.84rem;
  }

  .bar {
    display: flex;
    height: 8px;
    gap: 2px;
    margin: 4px 0 8px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--b2);
  }

  .bar i {
    display: block;
    height: 100%;
  }

  .legend-l {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 0.82rem;
    color: var(--fg-2);
  }

  .legend-l i {
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-right: 5px;
    border-radius: 2px;
  }

  .kv a {
    color: var(--fg);
  }
</style>
