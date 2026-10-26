<script lang="ts">
  // Whom they are talking to now (talks.ts), a line each: the other end, what for (and from which device, when there
  // are several), a bar on the scale of the busiest and how fast. Busiest first, re-sorted every few seconds and never
  // under the pointer; a conversation that has just begun lights up for a moment.
  import { flip } from 'svelte/animate';
  import ClearTag from './ClearTag.svelte';
  import { rate } from './format.ts';
  import { Ranked } from './ranked.svelte.ts';
  import { link } from './router.svelte.ts';
  import type { Talk } from './talks.ts';

  let {
    talks,
    limit = 5,
    from = false,
    label = 'Talking to now',
    none = 'No conversation in the last seconds.',
  }: { talks: Talk[]; limit?: number; from?: boolean; label?: string; none?: string } = $props();

  const rank = new Ranked(2000);
  // Ranked among a few more than are shown, so one slipping to sixth for a second does not swap a line out.
  $effect(() => rank.update(talks.slice(0, limit + 5).map((t) => t.key), (k) => talks.find((t) => t.key === k)?.rate ?? 0));
  const shown = $derived(
    rank.order
      .slice(0, limit)
      .map((k) => talks.find((t) => t.key === k))
      .filter((t) => t !== undefined),
  );
  const max = $derived(Math.max(1, ...shown.map((t) => t.rate)));
  const fresh = (since: number) => Date.now() / 1000 - since < 15;
</script>

{#if shown.length}
  <table class="talks" aria-label={label}>
    <tbody onpointerenter={() => (rank.hold = true)} onpointerleave={() => (rank.hold = false)}>
      {#each shown as t (t.key)}
        <tr animate:flip={{ duration: 400 }} class:fresh={fresh(t.since)}>
          <td class="with"><a href={t.href}>{t.name}</a>{#if t.clear}<ClearTag clear={t.clear} />{/if}</td>
          <td class="what">{t.what}{#if from && t.device}<span class="from">{' · '}<a href={link.device(t.device.id)}>{t.device.name}</a></span>{/if}</td>
          <td class="now"><span class="bar" style:width="{Math.max(2, 60 * Math.sqrt(t.rate / max))}px"></span><span class="rt">{rate(t.rate)}</span></td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else}
  <p class="none">{none}</p>
{/if}

<style>
  .talks {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    border-top: 1px solid var(--rule);
    font-size: 0.9rem;
  }

  td {
    overflow: hidden;
    padding: 8px;
    border-bottom: 1px solid var(--rule);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .with {
    width: 32%;
  }

  .with a {
    color: var(--fg);
    font-weight: 500;
  }

  .with :global(.clear-tag) {
    margin-left: 6px;
  }

  .what {
    color: var(--muted);
  }

  .from,
  .from a {
    color: var(--muted);
  }

  .now {
    width: 13em;
    text-overflow: clip;
    text-align: right;
  }

  .bar {
    display: inline-block;
    height: 6px;
    margin-right: 10px;
    border-radius: 3px;
    background: var(--data);
    opacity: 0.55;
    vertical-align: middle;
    transition: width 0.6s var(--ease);
  }

  .rt {
    display: inline-block;
    min-width: 5.5em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  tr.fresh td {
    animation: arrive 4s var(--ease);
  }

  @keyframes arrive {
    from {
      background: var(--b2);
    }
  }

  @media (max-width: 640px) {
    .with {
      width: 45%;
    }

    .now {
      width: 6em;
    }

    .bar {
      display: none;
    }
  }

  .none {
    margin: 8px 0 0;
    font-size: 0.86rem;
    color: var(--muted);
  }
</style>
