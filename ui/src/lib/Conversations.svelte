<script lang="ts">
  // Who an entity talked to: a row per other end and service, how much each way (from this side), and when, the
  // busiest or the latest first. The other end is a link to its page; live, the rows move with the traffic, and one
  // heard in the last ten seconds is lit. `me` is the side the page is about (a device, a host); with none (an
  // interface, a company), both ends are shown, the device here first, and what it sent and received.
  import type { Conversation } from '../../../shared/types.ts';
  import type { Source } from './argus.svelte.ts';
  import EntityIcon from './EntityIcon.svelte';
  import EntityLink from './EntityLink.svelte';
  import { bytes, since, when } from './format.ts';
  import Seg from './Seg.svelte';
  import { serviceName, servicePort } from '../../../shared/services.ts';

  let {
    conversations,
    me,
    source,
    capture,
    title = 'Conversations',
    label = 'Conversations',
    limit = 12,
  }: { conversations: Conversation[]; me?: Set<string>; source: Source; capture?: string; title?: string; label?: string; limit?: number } = $props();

  const live = $derived(source.kind === 'live');
  let by = $state<'bytes' | 'recent'>('bytes');
  const ORDERS = [
    { id: 'bytes' as const, label: 'Most data' },
    { id: 'recent' as const, label: 'Latest' },
  ];
  let all = $state(false);
  let hovering = $state(false);

  // The order holds still while he reads it: sorted again every five seconds or when one turns up, never under the
  // pointer (as the devices table does).
  let order = $state<string[]>([]);
  let sortedAt = 0;
  let sortedBy = '';
  $effect(() => {
    const ids = conversations.map((c) => c.id);
    const known = new Set(order);
    const arrived = ids.some((id) => !known.has(id));
    const now = Date.now();
    if (sortedBy === by && hovering && !arrived) return;
    if (sortedBy === by && !arrived && order.length === ids.length && now - sortedAt < 5_000) return;
    sortedAt = now;
    sortedBy = by;
    const key = by === 'bytes' ? (c: Conversation) => c.sent + c.received : (c: Conversation) => c.last;
    order = [...conversations].sort((a, b) => key(b) - key(a)).map((c) => c.id);
  });
  const rows = $derived.by(() => {
    const byId = new Map(conversations.map((c) => [c.id, c]));
    const out = order.map((id) => byId.get(id)).filter((c): c is Conversation => Boolean(c));
    for (const c of conversations) if (!order.includes(c.id)) out.push(c);
    return all ? out : out.slice(0, limit);
  });

  /** The row from this side: the other end, and what this side sent and received. */
  function side(c: Conversation) {
    const mine = !me || me.has(c.a);
    return { here: mine ? c.a : c.b, there: mine ? c.b : c.a, sent: mine ? c.sent : c.received, received: mine ? c.received : c.sent };
  }
  const hot = (c: Conversation) => live && Date.now() / 1000 - c.last < 10;
</script>

<div class="band-h">
  <h2>{title}</h2>
  <span class="tools">
    <span class="aside">{conversations.length === 1 ? '1 conversation' : `${conversations.length} conversations`}</span>
    {#if conversations.length > 1}<Seg bind:value={by} label="Order" options={ORDERS} />{/if}
  </span>
</div>
{#if conversations.length}
  <div class="records-wrap">
    <table class="records conv" aria-label={label} onpointerenter={() => (hovering = true)} onpointerleave={() => (hovering = false)}>
      <thead>
        <tr>
          <th>{me ? 'With' : 'Between'}</th>
          <th class="hide-s">Service</th>
          <th class="num hide-s">Sent</th>
          <th class="num hide-s">Received</th>
          <th class="num show-s">Total</th>
          <th class="num">When</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as c (c.id)}
          {@const s = side(c)}
          {@const there = source.graph.get(s.there)}
          {@const here = source.graph.get(s.here)}
          <tr class:hot={hot(c)} data-conversation={c.id}>
            <td class="who">
              <span class="who-in">
                <i class="dot" aria-hidden="true"></i>
                {#if !me && here}<span class="end"><EntityLink entity={here} {capture} /></span><span class="arrow" aria-hidden="true">⇄</span>{/if}
                {#if there}<EntityIcon entity={there} size={22} /><span class="end"><EntityLink entity={there} {capture} /></span>{:else}<span
                    class="end mono">{s.there.replace(/^[a-z]+:/, '')}</span
                  >{/if}
              </span>
              <span class="sub show-s">{serviceName(c.service)}</span>
            </td>
            <td class="hide-s svc">{serviceName(c.service)}{#if servicePort(c.service) && serviceName(c.service) !== servicePort(c.service).toUpperCase()}<span
                  class="port mono">{servicePort(c.service)}</span
                >{/if}</td>
            <td class="num hide-s">{bytes(s.sent)}</td>
            <td class="num hide-s">{bytes(s.received)}</td>
            <td class="num show-s">{bytes(c.sent + c.received)}</td>
            <td class="num when" title="From {when(c.first)} to {when(c.last)}">{live ? since(c.last) : when(c.last)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if conversations.length > limit}
    <button class="ghost small more" onclick={() => (all = !all)}>{all ? 'Show fewer' : `Show all ${conversations.length}`}</button>
  {/if}
{:else}
  <p class="empty">No conversation seen yet.</p>
{/if}

<style>
  .band-h {
    align-items: center;
  }

  .tools {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }

  .aside {
    font-size: 0.8rem;
    color: var(--faint);
  }

  .conv td {
    vertical-align: middle;
  }

  /* The other end gives way with an ellipsis, so the figures on the right are always whole. */
  .conv td.who {
    width: 60%;
    max-width: 0;
  }

  .who-in {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .end {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .end :global(.el) {
    overflow-wrap: normal;
  }

  .arrow {
    flex: none;
    color: var(--faint);
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--rule-strong);
  }

  tr.hot .dot {
    background: var(--acc);
  }

  .svc {
    white-space: nowrap;
    color: var(--fg-2);
  }

  .port {
    margin-left: 6px;
    color: var(--faint);
  }

  .conv td.num,
  .conv th.num {
    white-space: nowrap;
  }

  .when {
    color: var(--muted);
  }

  .sub {
    margin-left: 14px;
    font-size: 0.76rem;
    color: var(--faint);
  }

  .more {
    margin-top: 10px;
  }

  .show-s {
    display: none;
  }

  @media (max-width: 640px) {
    .hide-s {
      display: none;
    }

    .show-s {
      display: table-cell;
    }

    span.show-s {
      display: block;
    }

  }
</style>
