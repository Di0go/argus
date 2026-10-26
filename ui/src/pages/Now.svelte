<script lang="ts">
  // Now, the home page, read in the order a person asks (docs/apresentacao.md): is everything normal (one sentence,
  // and whether anything went unencrypted in the last hour); who is using the network and for what; what each device
  // is (under its name); is anything unsafe (privacy and safety, beside); what happened while nobody was looking (the
  // day by hour, and the diary). How Argus listens (the interfaces, the bandwidth chart, saving) is at the bottom, and
  // a line at the top says where it listens.
  import { argus } from '../lib/argus.svelte.ts';
  import DayColumns from '../lib/DayColumns.svelte';
  import { days } from '../lib/day.svelte.ts';
  import Diary from '../lib/Diary.svelte';
  import { bytes, rate, span } from '../lib/format.ts';
  import Limits from '../lib/Limits.svelte';
  import Listen from '../lib/Listen.svelte';
  import { privacy } from '../lib/privacy.ts';
  import PrivacyPanel from '../lib/PrivacyPanel.svelte';
  import RateChart from '../lib/RateChart.svelte';
  import { link } from '../lib/router.svelte.ts';
  import Seg from '../lib/Seg.svelte';
  import Verdict from '../lib/Verdict.svelte';
  import WhoList from '../lib/WhoList.svelte';
  import { networks } from '../lib/networks.svelte.ts';

  let period = $state<'minutes' | 'day'>('minutes');
  const PERIODS = [
    { id: 'minutes' as const, label: '10 min' },
    { id: 'day' as const, label: 'Today' },
  ];
  let saving = $state(false);
  let saved = $state('');
  let alertText = $state('');
  let listenOpen = $state(false);

  const s = $derived(argus.session);
  const src = $derived(argus.liveSource);
  const on = $derived(s?.listening.filter((l) => l.on) ?? []);
  const names = $derived(on.map((l) => argus.interfaces.find((i) => i.id === l.id)?.name ?? l.id));
  const seen = $derived(Boolean(s?.packets));
  const today = $derived(days.get());
  // The network chosen on Devices, when the others are hidden there, is the one shown here too.
  const mine = $derived(networks.hideOthers && networks.selected ? networks.split(src.devices).mine : src.devices);
  // The colour is for the last hour; the panel's other facts are the session's.
  const whole = $derived(privacy(src));
  const recent = $derived(privacy(src, { since: Date.now() / 1000 - 3600 }));
  const stamp = $derived(new Date().toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }));

  function list(xs: string[]): string {
    return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
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
</script>

<div class="page now">
  <header class="page-head head">
    <div>
      <h1 class="page-title">Now</h1>
      <p class="page-lede">{stamp}</p>
    </div>
    {#if s && (on.length || seen)}
      <p class="where">
        {#if on.length}<i class="on" aria-hidden="true"></i>Listening on {list(names)} for {span(Date.now() / 1000 - Math.min(...on.map((l) => l.since ?? Date.now() / 1000)))} · {rate(
            argus.meter,
          )}{:else}<i aria-hidden="true"></i>Not listening now{/if}
        <button class="ghost small" aria-expanded={listenOpen} onclick={() => (listenOpen = !listenOpen)}>{listenOpen ? 'Done' : 'Change'}</button>
      </p>
    {/if}
  </header>

  {#if !argus.live.loaded}
    <section class="band" aria-hidden="true">
      <div class="sk tall w30"></div>
      <div class="sk-chart"></div>
    </section>
  {:else if !seen}
    <section class="band listen-band" aria-label="Where to listen">
      <Listen />
    </section>
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
    {#if listenOpen}
      <section class="band listen-band" aria-label="Where to listen">
        <Listen />
      </section>
    {/if}

    <Verdict devices={src.devices} {recent} />

    <div class="grid">
      <div class="col">
        <section class="band o-who" aria-labelledby="who-h">
          <div class="band-h">
            <h2 id="who-h">Who is using the network</h2>
            <a href={link.devices()}>All the devices</a>
          </div>
          <WhoList devices={mine} />
        </section>

        <section class="band o-today" aria-labelledby="today-h">
          <div class="band-h">
            <h2 id="today-h">Today</h2>
            {#if today}<span class="aside">{bytes(today.bytes)}</span>{/if}
          </div>
          {#if today?.bytes}
            <DayColumns hours={today.hours} />
          {:else}
            <p class="empty">The day fills in as it goes: a minute at a time, kept across reloads and restarts.</p>
          {/if}
        </section>

        <section class="band o-diary" aria-labelledby="diary-h">
          <div class="band-h">
            <h2 id="diary-h">What happened</h2>
            <a href={link.diary()}>The whole day</a>
          </div>
          <Diary episodes={today?.diary ?? []} events={today?.events ?? []} limit={9} />
        </section>
      </div>

      <aside class="col side" aria-label="Privacy and safety">
        <PrivacyPanel p={whole} {recent} source={src} />
      </aside>
    </div>

    <section class="band pulse" aria-label="Bandwidth">
      <div class="band-h">
        <h2>Bandwidth</h2>
        <Seg bind:value={period} label="Period" options={PERIODS} />
      </div>
      <p class="what">{rate(argus.meter)} now, the whole network as seen from here; {bytes(s?.bytes ?? 0)} since the session began.</p>
      {#if period === 'minutes'}
        <RateChart series={argus.fine} label="Bandwidth, whole network" seconds={600} height={160} since={s?.started} />
      {:else}
        <RateChart series={argus.coarse} label="Bandwidth, whole network, today" height={160} since={s?.started} />
      {/if}
    </section>

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
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 24px;
  }

  .where {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin: 0 0 6px;
    font-size: 0.88rem;
    color: var(--muted);
  }

  .where i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--faint);
  }

  .where i.on {
    background: var(--solid);
  }

  .listen-band {
    margin-bottom: 28px;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.75fr) minmax(300px, 1fr);
    gap: 8px 48px;
    margin-top: 28px;
  }

  .col {
    min-width: 0;
  }

  .side {
    padding-top: 4px;
  }

  .band-h a {
    font-size: 0.84rem;
    color: var(--acc);
  }

  .aside {
    font-size: 0.84rem;
    color: var(--muted);
  }

  .what {
    margin: -4px 0 10px;
    font-size: 0.84rem;
    color: var(--muted);
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
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }

    /* On a narrow screen, safety comes right after who is using the network. */
    .grid > .col:first-child {
      display: contents;
    }

    .o-who {
      order: 1;
    }

    .side {
      order: 2;
      margin-bottom: 36px;
    }

    .o-today {
      order: 3;
    }

    .o-diary {
      order: 4;
    }
  }
</style>
