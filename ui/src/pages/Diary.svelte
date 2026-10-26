<script lang="ts">
  // A day kept: by hour and by what the traffic was for, the devices that moved the most and what they did, and the
  // diary of episodes and events. Today by default; any day kept (31 by default) from the list. Of the network shown
  // (the bar's: the one of now, unless he chose another), with the day's other networks a click away; what was kept
  // before Argus told networks apart is said, and left in all networks, never split after the fact.
  import { keyOf } from '@organon/core/shared/entities';
  import { doing } from '../../../shared/words.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import DayColumns from '../lib/DayColumns.svelte';
  import { days } from '../lib/day.svelte.ts';
  import Diary from '../lib/Diary.svelte';
  import { bytes } from '../lib/format.ts';
  import { networks } from '../lib/networks.svelte.ts';
  import { link } from '../lib/router.svelte.ts';

  let { date }: { date?: string } = $props();

  const shown = $derived(argus.shown);
  const day = $derived(days.get(date, undefined, shown));
  const time = (t: number) => new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  /** The day's networks that are not the ones shown. */
  const others = $derived(day && shown ? day.networks.filter((n) => !shown.has(n.id)) : []);
  const names = $derived(shown ? [...shown].map((id) => argus.netList.find((n) => n.id === id)?.name ?? day?.networks.find((n) => n.id === id)?.name ?? id).join(' and ') : '');
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const live = $derived(new Set(argus.devices.map((d) => keyOf(d))));
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">Diary</h1>
    <p class="page-lede">
      {day ? `${label(day.date)}: ${bytes(day.bytes)}` : ''}{day?.first ? `, heard from ${new Date(day.first * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} to ${new Date((day.last ?? day.first) * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}.
      Kept as totals a minute at a time, never packets.
    </p>
    {#if day && shown}
      <p class="nets" role="note">
        {#if day.bytes}Only {names}.{:else}Nothing on {names} this day.{/if}
        {#if others.length}
          Also on
          {#each others as n, k (n.id)}<button class="linkish" onclick={() => networks.choose(n.id)}>{n.name}</button> ({bytes(n.bytes)}){k < others.length - 1 ? ', ' : ''}{/each};
        {/if}
        <button class="linkish" onclick={() => networks.choose('all')}>all networks</button>.
        {#if day.untold}Until {time(day.untold.until)} the day was kept without telling networks apart ({bytes(day.untold.bytes)}): it is in all networks, not here.{/if}
      </p>
    {:else if day?.untold}
      <p class="nets" role="note">Until {time(day.untold.until)} the day was kept without telling networks apart: those {bytes(day.untold.bytes)} are here, in no network of their own.</p>
    {/if}
    {#if day && day.days.length > 1}
      <nav class="days" aria-label="Days kept">
        {#each day.days.slice(0, 14) as d (d)}<a href={link.diary(d)} aria-current={d === day.date ? 'page' : undefined}>{label(d)}</a>{/each}
      </nav>
    {/if}
  </header>

  {#if day}
    <section class="band">
      <div class="band-h"><h2>By hour</h2></div>
      {#if day.bytes}<DayColumns hours={day.hours} />{:else}<p class="empty">Nothing kept for this day.</p>{/if}
    </section>
    <div class="bands">
      <section class="band">
        <div class="band-h"><h2>What happened</h2></div>
        <Diary episodes={day.diary} events={day.events} />
      </section>
      <section class="band">
        <div class="band-h"><h2>By device</h2></div>
        <ul class="recs" aria-label="By device">
          {#each day.devices.slice(0, 20) as d (d.id)}
            <li class="rec plain">
              <span class="rec-t">
                {#if live.has(d.id)}<a href={link.device(d.id.replace(/^device:/, ''))}>{d.name}</a>{:else}{d.name}{/if}
                <span class="sub">{d.top.slice(0, 2).map((t) => doing(t.what, 'past')).join(', ')}</span>
              </span>
              <span class="rec-m">{bytes(d.bytes)}</span>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {:else}
    <p class="page-lede"><span class="sk w45"></span></p>
  {/if}
</div>

<style>
  .nets {
    margin: 6px 0 0;
    font-size: 0.86rem;
    color: var(--fg-2);
  }

  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--acc);
    font: inherit;
    cursor: pointer;
  }

  .linkish:hover {
    text-decoration: underline;
  }

  .days {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 0.84rem;
  }

  .days a[aria-current] {
    color: var(--fg);
    font-weight: 600;
  }

  .sub {
    display: block;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .rec-t a {
    color: var(--fg);
    font-weight: 500;
  }
</style>
