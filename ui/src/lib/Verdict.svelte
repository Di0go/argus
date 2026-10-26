<script lang="ts">
  // The first thing on the page: is everything normal? One sentence in words (how many devices are using the network
  // and what the busiest are doing), and beside it whether anything went unencrypted in the last hour: the one colour
  // the page uses for that, a link to the details; or, said plainly, that nothing did.
  import Lock from '@lucide/svelte/icons/lock';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import type { Device } from '../../../shared/types.ts';
  import { BACKGROUND, doing } from '../../../shared/words.ts';
  import { argus } from './argus.svelte.ts';
  import { house } from './house.ts';
  import type { Privacy } from './privacy.ts';
  import { link } from './router.svelte.ts';

  let { devices, recent }: { devices: Device[]; recent: Privacy } = $props();

  const users = $derived(house(devices, argus.interfaces));
  const busy = $derived(
    users
      .filter((d) => (argus.meters[d.id] ?? 0) >= 2048 || (d.doing ?? []).some((x) => !BACKGROUND.has(x.what?.category ?? '')))
      .sort((a, b) => (argus.meters[b.id] ?? 0) - (argus.meters[a.id] ?? 0)),
  );
  const what = $derived(
    busy
      .map((d) => {
        const top = (d.doing ?? []).find((x) => !BACKGROUND.has(x.what?.category ?? ''));
        return top ? `${d.name} is ${doing(top.what).replace(/^./, (c) => c.toLowerCase())}` : '';
      })
      .filter(Boolean)
      .slice(0, 2),
  );
  const head = $derived(!busy.length ? 'Quiet.' : busy.length >= 3 || argus.meter > 1_000_000 ? 'Busy.' : 'In use.');
  const sentence = $derived(
    !busy.length
      ? `${users.length} ${users.length === 1 ? 'device' : 'devices'} on the network, none using it right now.`
      : `${busy.length} of ${users.length} devices are using the network${what.length ? `: ${what.join(', ')}` : ''}.`,
  );
  const clear = $derived(recent.clear.length);
  const logins = $derived(recent.clear.filter((l) => l.c.clear?.credentials).length);
</script>

<div class="verdict" role="status">
  <span class="dot" aria-hidden="true"></span>
  <p><b>{head}</b> {sentence}</p>
  {#if clear}
    <a class="pill" href={link.privacy()}
      ><LockOpen size={15} strokeWidth={2.4} aria-hidden="true" />{clear} unencrypted in the last hour{logins ? `, ${logins} with a login` : ''}</a
    >
  {:else}
    <a class="ok" href={link.privacy()}><Lock size={14} aria-hidden="true" />Nothing unencrypted in the last hour</a>
  {/if}
</div>

<style>
  .verdict {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 14px;
    padding: 14px 18px;
    border-radius: var(--radius-lg, 12px);
    background: var(--b1);
  }

  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--data);
  }

  p {
    flex: 1 1 320px;
    margin: 0;
    font-size: 1.02rem;
    line-height: 1.45;
  }

  b {
    font-weight: 650;
  }

  .pill,
  .ok {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    font-size: 0.9rem;
  }

  .pill {
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--clear-soft);
    color: var(--clear);
    font-weight: 600;
  }

  .ok {
    color: var(--muted);
  }

  @media (max-width: 640px) {
    .pill,
    .ok {
      white-space: normal;
    }
  }
</style>
