<script lang="ts">
  // What happened, as a diary: each episode (a device doing one thing from when it began to when it stopped, and how
  // much) and each event (a device seen for the first time, traffic in the clear, old TLS), newest first, under the
  // part of the day. In the clear is said in the colour that means it; the rest in plain ink.
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import type { DayEvent, Episode } from '../../../shared/types.ts';
  import { doing } from '../../../shared/words.ts';
  import { bytes, span } from './format.ts';
  import { link } from './router.svelte.ts';

  let {
    episodes,
    events = [],
    limit,
    device = true,
  }: { episodes: Episode[]; events?: DayEvent[]; limit?: number; device?: boolean } = $props();

  type Entry = { t: number; ep?: Episode; ev?: DayEvent };
  const entries = $derived.by(() => {
    const all: Entry[] = [...episodes.map((ep) => ({ t: ep.start, ep })), ...events.map((ev) => ({ t: ev.t, ev }))].sort((a, b) => b.t - a.t);
    return limit ? all.slice(0, limit) : all;
  });

  const PARTS: [number, string][] = [
    [18, 'Evening'],
    [12, 'Afternoon'],
    [6, 'Morning'],
    [0, 'Night'],
  ];
  const part = (t: number) => {
    const h = new Date(t * 1000).getHours();
    return PARTS.find(([from]) => h >= from)![1];
  };
  const clock = (t: number) => new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const deviceId = (key: string) => key.replace(/^device:/, '');
</script>

{#if entries.length}
  <ol class="diary" aria-label="What happened">
    {#each entries as e, i (`${e.t}-${i}`)}
      {#if !i || part(entries[i - 1]!.t) !== part(e.t)}<li class="part" aria-hidden="true">{part(e.t)}</li>{/if}
      {#if e.ep}
        {@const ep = e.ep}
        <li>
          <time>{clock(ep.start)}</time>
          <span class="what"
            >{#if device}<a class="who" href={link.device(deviceId(ep.device))}>{ep.deviceName}</a>{' '}{/if}{ep.ongoing ? (device ? `is ${doing(ep.what).replace(/^./, (c) => c.toLowerCase())}` : doing(ep.what)) : doing(ep.what, 'past')}{#if ep.also?.length}<span class="also"
                >, {ep.also
                  .slice(0, 3)
                  .map((w) => (ep.ongoing ? doing(w).replace(/^./, (c) => c.toLowerCase()) : doing(w, 'past')))
                  .join(', ')}{ep.also.length > 3 ? ` and ${ep.also.length - 3} more` : ''}</span
              >{/if}{#if ep.ongoing}<span class="now">{' · still going'}</span>{/if}</span
          >
          <span class="amt">{bytes(ep.bytes)} · {span(ep.end - ep.start)}</span>
        </li>
      {:else if e.ev}
        {@const ev = e.ev}
        <li>
          <time>{clock(ev.t)}</time>
          <span class="what">
            {#if ev.type === 'clear'}<LockOpen size={13} strokeWidth={2} aria-label="Unencrypted" />{/if}
            {#if device}<a class="who" href={link.device(deviceId(ev.device))}>{ev.deviceName}</a>{' '}{/if}
            {#if ev.type === 'new'}joined the network for the first time
            {:else if ev.type === 'clear'}talked {ev.proto} without encryption to {ev.withName ?? ev.with}{ev.credentials ? ', with a login' : ''}{ev.local ? ' (inside the house)' : ''}
            {:else}agreed {ev.proto}, an old encryption, with {ev.withName ?? ev.with}{/if}
          </span>
          <span class="amt"></span>
        </li>
      {/if}
    {/each}
  </ol>
{:else}
  <p class="empty">Nothing worth a line yet: an episode is someone doing one thing for a few minutes, or a lot of it.</p>
{/if}

<style>
  .diary {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: 50px minmax(0, 1fr) auto;
    gap: 12px;
    padding: 7px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 0.92rem;
  }

  li.part {
    display: block;
    padding: 14px 0 3px;
    font-size: 0.74rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--faint);
  }

  time,
  .amt {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .who {
    color: var(--fg);
    font-weight: 600;
  }

  .now,
  .also {
    color: var(--muted);
  }


  .what :global(svg) {
    vertical-align: -1px;
    margin-right: 2px;
  }

  @media (max-width: 640px) {
    li {
      grid-template-columns: 44px minmax(0, 1fr);
    }

    .amt {
      grid-column: 2;
    }
  }
</style>
