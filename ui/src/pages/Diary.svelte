<script lang="ts">
  // A day kept: by hour and by what the traffic was for, the devices that moved the most and what they did, and the
  // diary of episodes and events. Today by default; any day kept (31 by default) from the list.
  import { keyOf } from '@organon/core/shared/entities';
  import { doing } from '../../../shared/words.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import DayColumns from '../lib/DayColumns.svelte';
  import { days } from '../lib/day.svelte.ts';
  import Diary from '../lib/Diary.svelte';
  import { bytes } from '../lib/format.ts';
  import { link } from '../lib/router.svelte.ts';

  let { date }: { date?: string } = $props();

  const day = $derived(days.get(date));
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
