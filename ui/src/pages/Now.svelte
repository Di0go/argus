<script lang="ts">
  // Agora: the live session. Where it listens (a switch per interface), how fast the whole network moves now and over
  // the last ten minutes (or the day), the devices busiest first with their own pulse, and the companies out on the
  // internet they talk to. Everything moves as it comes in; nothing needs a reload.
  import { argus } from '../lib/argus.svelte.ts';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import { bytes, rate, span } from '../lib/format.ts';
  import HostList from '../lib/HostList.svelte';
  import Limits from '../lib/Limits.svelte';
  import NetFilter from '../lib/NetFilter.svelte';
  import Listen from '../lib/Listen.svelte';
  import RateChart from '../lib/RateChart.svelte';
  import { link } from '../lib/router.svelte.ts';
  import Seg from '../lib/Seg.svelte';

  let period = $state<'minutes' | 'day'>('minutes');
  const PERIODS = [
    { id: 'minutes' as const, label: '10 min' },
    { id: 'day' as const, label: 'Today' },
  ];
  let saving = $state(false);
  let saved = $state('');

  const s = $derived(argus.session);
  const src = $derived(argus.liveSource);
  const on = $derived(s?.listening.filter((l) => l.on) ?? []);
  const names = $derived(on.map((l) => argus.interfaces.find((i) => i.id === l.id)?.name ?? l.id));
  const seen = $derived(Boolean(s?.packets));

  const lede = $derived.by(() => {
    if (!s) return '';
    if (!on.length && !seen) return 'Turn an interface on and Argus shows who is on the network, second by second.';
    const where = names.length ? `Listening on ${list(names)}` : 'Not listening now';
    const since = Math.min(...on.map((l) => l.since ?? Date.now() / 1000));
    const how = on.length ? ` for ${span(Date.now() / 1000 - since)}` : '';
    const what = seen ? `: ${plural(src.devices.length, 'device', 'devices')} on the network, ${plural(src.remotes.length, 'host', 'hosts')} on the internet.` : '.';
    return `${where}${names.length ? how : ''}${what}`;
  });

  function list(xs: string[]): string {
    return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
  }

  function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  async function save() {
    saving = true;
    try {
      const c = await argus.save();
      saved = c.id;
    } catch (err) {
      saved = '';
      alertText = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  let alertText = $state('');
</script>

<div class="page now">
  <header class="page-head">
    <h1 class="page-title">Now</h1>
    {#if s}<p class="page-lede">{lede}</p>{:else}<p class="page-lede"><span class="sk w45"></span></p>{/if}
  </header>

  <section class="band listen-band" aria-label="Onde escutar">
    <Listen />
  </section>

  {#if !argus.live.loaded}
    <section class="band" aria-hidden="true">
      <div class="sk tall w30"></div>
      <div class="sk-chart"></div>
    </section>
  {:else if !seen}
    <section class="band first">
      <div class="empty-state">
        <h2>{on.length ? 'Listening' : 'Not listening yet'}</h2>
        <p>
          {on.length
            ? 'The first packets show here as soon as they arrive. On a quiet network they may take a few seconds.'
            : 'Choose above where to listen: the Wi-Fi, the cable or the VPN, one or several. It stays on until you turn it off, even if you close this page.'}
        </p>
      </div>
      <Limits />
    </section>
  {:else}
    <section class="band pulse" aria-label="Bandwidth">
      <div class="figure">
        <p class="big" aria-live="off"><span class="v">{rate(argus.meter)}</span></p>
        <p class="what">
          the whole network as seen from here, now; {bytes(s?.bytes ?? 0)} since the start
        </p>
      </div>
<Seg bind:value={period} label="Period" options={PERIODS} />
      <div class="chart-wrap">
        {#if period === 'minutes'}
          <RateChart series={argus.fine} label="Bandwidth, whole network" seconds={600} height={210} since={s?.started} />
        {:else}
          <RateChart series={argus.coarse} label="Bandwidth, whole network, today" height={210} since={s?.started} />
        {/if}
      </div>
    </section>

    <div class="bands main">
      <section class="band">
        <div class="band-h">
          <h2>On the local network</h2>
          <span class="band-tools">
            <NetFilter devices={src.devices} />
            <a href={link.devices()}>{src.devices.length > 8 ? `All ${src.devices.length}` : 'Devices'}</a>
          </span>
        </div>
        <DeviceTable devices={src.devices} live limit={8} byNetwork />
      </section>
      <section class="band side">
        <div class="band-h">
          <h2>On the internet</h2>
          <a href={link.internet()}>{src.remotes.length} hosts</a>
        </div>
        <HostList items={src.sites.slice(0, 8)} live label="Companies and sites" />
        {#if src.remotes.some((r) => !r.names.length)}
          <p class="note">
            {src.remotes.filter((r) => !r.names.length).length} with no name seen: the name is only known when the DNS question or the start of
            the encrypted connection passes through here.
          </p>
        {/if}
      </section>
    </div>

    <section class="band foot">
      <div class="keep">
        <button class="ghost small" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save the last minutes'}</button>
        <span class="muted"
          >What the ring buffer holds on disk, up to {s ? `${s.limits.ringFiles * s.limits.ringFileMB} MB` : ''} per interface, is kept
          as a capture.</span
        >
        {#if saved}<a href={link.capture(saved)}>Open the saved capture</a>{/if}
        {#if alertText}<span class="error" role="alert">{alertText}</span>{/if}
      </div>
      <Limits />
    </section>
  {/if}
</div>

<style>
  .listen-band {
    margin-bottom: 36px;
  }

  .pulse {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 4px 24px;
  }

  .figure {
    min-width: 0;
  }

  .big {
    margin: 0;
    font-size: clamp(2.2rem, 1.6rem + 2vw, 3.1rem);
    font-weight: 650;
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .what {
    margin: 6px 0 0;
    font-size: 0.86rem;
    color: var(--muted);
  }

  .chart-wrap {
    grid-column: 1 / -1;
    margin-top: 14px;
  }


  .main {
    --cols: 1;
    grid-template-columns: minmax(0, 1.9fr) minmax(280px, 1fr);
    gap: 16px 40px;
  }

  .band-tools {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    font-size: 0.86rem;
  }

  .band-tools > a {
    font-size: 0.84rem;
    color: var(--acc);
  }

  .note {
    margin: 12px 0 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--faint);
  }

  .foot {
    display: grid;
    gap: 22px;
    padding-top: 22px;
    border-top: 1px solid var(--rule);
  }

  .keep {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    font-size: 0.84rem;
  }

  .first {
    display: grid;
    gap: 12px;
  }

  .first .empty-state {
    padding: 8px 0 0;
  }

  .sk-chart {
    height: 210px;
    margin-top: 18px;
    border-radius: var(--radius-lg);
    background: var(--b1);
  }

  @media (max-width: 1100px) {
    .main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
