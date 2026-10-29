<script lang="ts">
  // The devices of the network shown (the one of now, unless he chose another in the bar: NetFilter), or of a saved
  // capture, busiest first, each with its networks. Two lists, said apart: what this PC heard (the sensor), and, under
  // it, what another source found without a frame passing here (this PC's neighbour table, a lease file, a scan of the
  // LAN: server/sources.ts). "Now" keeps the first list to what was heard in the last minutes.
  import type { Device, SourceState } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import { since } from '../lib/format.ts';
  import { networks } from '../lib/networks.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import Seg from '../lib/Seg.svelte';
  import SourceHead from '../lib/SourceHead.svelte';

  let { capture }: { capture?: string } = $props();

  const source = $derived(argus.sourceFor(capture, true));
  const shown = $derived(source?.devices ?? []);
  const heard = $derived(shown.filter((d) => !d.foundOnly));
  const found = $derived(shown.filter((d) => d.foundOnly));
  /** A network chosen that this session never was on (one remembered from before it). */
  const before = $derived(!capture && !['now', 'all'].includes(networks.choice) && !argus.networks.some((n) => n.id === networks.choice) ? argus.netList.find((n) => n.id === networks.choice) : undefined);
  /** The networks shown, by name: said in the lede, so a list is never read as another network's. */
  const scope = $derived.by(() => {
    const ids = argus.shown;
    if (!ids) return 'all networks';
    return argus.netList
      .filter((n) => ids.has(n.id))
      .map((n) => n.name)
      .join(' and ');
  });

  /** Heard in the last five minutes, or at any time this session. */
  const PRESENT = 300;
  let presence = $state<'now' | 'session'>('session');
  const recent = (d: Device) => Date.now() / 1000 - d.lastSeen < PRESENT;
  const heardShown = $derived(presence === 'now' ? heard.filter(recent) : heard);

  /**
   * The interface a scan asks on: a Wi-Fi or a cable listened on now, of a network shown (else what it finds would have
   * no network to be placed on). Docker's bridges and VPNs are not a LAN to scan.
   */
  const scanIface = $derived(
    argus.networks
      .filter((n) => n.now && (!argus.shown || argus.shown.has(n.id)))
      .flatMap((n) => n.nowOn ?? [])
      .find((id) => ['wifi', 'cable'].includes(argus.interfaces.find((i) => i.id === id)?.type ?? '')),
  );
  const scan = $derived(argus.sources.find((s) => s.id === 'scan'));
  const passive = $derived(argus.sources.filter((s) => s.id !== 'scan'));
  let scanning = $state(false);
  let scanNote = $state('');

  async function find() {
    scanning = true;
    scanNote = '';
    try {
      const s = (await argus.scanSources(scanIface)).find((x) => x.id === 'scan');
      scanNote = s?.error ?? `Scanned ${scanIface}: ${s?.found === 1 ? 'one device answered' : `${s?.found ?? 0} devices answered`}.`;
    } catch (err) {
      scanNote = (err as Error).message;
    } finally {
      scanning = false;
    }
  }
  const count = (s: SourceState) => (s.on ? `${s.found} found` : 'off');
</script>

<div class="page wide">
  <header class="page-head">
    <h1 class="page-title">Devices</h1>
    <p class="page-lede">
      {#if source}
        {#if capture}
          {shown.length === 1 ? 'One device' : `${shown.length} devices`} in this capture, the busiest first.
        {:else}
          {heard.length === 1 ? 'One device' : `${heard.length} devices`} heard on {scope}, the busiest first{#if found.length}; {found.length} more found
            without being heard, below{/if}.
        {/if}
        The name is what each one said of itself (DHCP, mDNS, NetBIOS); the maker comes from the first half of the MAC.
      {:else}<span class="sk w60"></span>{/if}
    </p>
    {#if source}<SourceHead {source} />{/if}
  </header>

  {#if source}
    {#if !capture && heard.length}
      <div class="controls">
        <Seg bind:value={presence} label="Which devices" options={[
          { id: 'session', label: 'This session' },
          { id: 'now', label: 'Heard now' },
        ]} />
        <span class="hint">{presence === 'now' ? 'heard in the last five minutes' : 'everything heard since the session began'}</span>
      </div>
    {/if}

    {#if heardShown.length}
      <DeviceTable devices={heardShown} live={source.kind === 'live'} {capture} />
    {:else if before}
      <div class="empty-state">
        <h2>Not on {before.name} in this session</h2>
        <p>It was last heard {since(before.last)}. What it did is in the <a href={link.diary()}>Diary</a>, a day at a time; this session began after.</p>
      </div>
    {:else if heard.length}
      <div class="empty-state">
        <h2>Nothing heard in the last five minutes</h2>
        <p>The {heard.length === 1 ? 'one device' : `${heard.length} devices`} of this session are quiet: <button class="linkish" onclick={() => (presence = 'session')}>show them</button>.</p>
      </div>
    {:else}
      <div class="empty-state">
        <h2>No devices yet</h2>
        <p>Turn an interface on in <a href="#/">Now</a>: devices show here as soon as they are heard.</p>
      </div>
    {/if}

    {#if !capture}
      <section class="found-band" aria-labelledby="found-h">
        <div class="found-head">
          <h2 id="found-h">Found on the network, not heard</h2>
          <span class="aside">{found.length === 1 ? 'one device' : `${found.length} devices`}</span>
        </div>
        <p class="note">
          On a switched network this PC hears mostly its own traffic. These were found another way, and no frame of theirs passed here, so
          what they do is not visible.
        </p>
        <ul class="sources">
          {#each passive as s (s.id)}
            <li><b>{s.name}</b> <span class="muted">· passive, {count(s)}</span><span class="why">{s.error ?? s.detail}</span></li>
          {/each}
          {#if scan?.on}
            <li class="active">
              <b>Scan of the LAN</b> <span class="active-tag">active</span>{#if scan.last}<span class="muted"> · scanned {since(scan.last)}, {scan.found} answered</span>{/if}
              <span class="why">{scan.detail}</span>
              <span class="scan-row">
                <button class="scan-btn" disabled={scanning || !scanIface} onclick={find}>{scanning ? 'Scanning…' : scanIface ? `Scan ${scanIface} now` : 'Scan the LAN'}</button>
                {#if !scanIface}<span class="muted">Listen on the Wi-Fi or the cable of the network shown first: what a scan finds is placed on the network being heard.</span>{/if}
                {#if scanNote}<span role="status">{scanNote}</span>{:else if scan.error}<span class="err">{scan.error}</span>{/if}
              </span>
            </li>
          {/if}
        </ul>
        {#if found.length}
          <DeviceTable devices={found} live={source.kind === 'live'} {capture} />
        {/if}
      </section>
    {/if}
  {:else if argus.captureProblem[capture ?? '']}
    <p class="error">{argus.captureProblem[capture ?? '']}</p>
  {/if}
</div>

<style>
  /* The table of devices takes the screen there is (the core stops pages at --page-w, 1600px): on a wide one the
     names and makers show whole. The notes under it keep their measure. */
  .page.wide {
    max-width: 2400px;
  }

  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin: 4px 0 14px;
  }

  .hint,
  .muted {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--acc);
    font: inherit;
    cursor: pointer;
  }

  .found-band {
    margin-top: 34px;
    padding-top: 18px;
    border-top: 1px solid var(--rule);
  }

  .found-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .found-head h2 {
    margin: 0;
    font-size: 1.02rem;
    font-weight: 600;
  }

  .found-head .aside {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .note {
    max-width: 72ch;
    margin: 8px 0 14px;
    font-size: 0.82rem;
    line-height: 1.6;
    color: var(--fg-2);
  }

  .sources {
    max-width: 72ch;
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
    font-size: 0.82rem;
  }

  .sources li {
    padding: 10px 0;
    border-top: 1px solid var(--rule);
  }

  .why {
    display: block;
    color: var(--fg-2);
    line-height: 1.55;
  }

  .active-tag {
    margin-left: 4px;
    padding: 0 6px;
    border: 1px solid var(--rule-strong);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
  }

  .scan-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin-top: 6px;
  }

  .scan-btn {
    min-height: 30px;
    padding: 3px 11px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--b0);
    color: var(--fg);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
  }

  .scan-btn:hover:not(:disabled) {
    background: var(--hover);
  }

  .scan-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .err {
    color: var(--shaky);
  }
</style>
