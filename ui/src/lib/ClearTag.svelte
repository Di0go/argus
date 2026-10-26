<script lang="ts">
  // "Without encryption", said by a small open padlock in the ink of the text around it: no colour, no badge. What it
  // was (the protocol, whether a login went by, why that matters) is in its tip, on hover, on a click or a tab to it. `words` adds the protocol beside it,
  // quietly, where a list is about exactly this (the Privacy page).
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import { CLEAR_WHY } from '../../../shared/security.ts';

  // Inside a link (a line that opens the device) it cannot be a button of its own: there it is a mark with its tip on
  // hover, and the device's page has the rest.
  let {
    clear,
    words = false,
    inLink = false,
  }: { clear: { proto: string; credentials?: boolean; harmless?: boolean }; words?: boolean; inLink?: boolean } = $props();

  const said = $derived(clear.credentials ? `${clear.proto}, a login in the clear` : clear.harmless ? `${clear.proto}, harmless` : clear.proto);
  const tip = $derived(
    clear.harmless
      ? `${clear.proto} in the clear, by design: a connectivity check, a certificate list or a software update: public and signed.`
      : `${clear.proto} without encryption: ${CLEAR_WHY[clear.proto] ?? 'what it carries can be read on the way'}.${clear.credentials ? ' A login went by in it: Argus’s pages, history and agent keep only that it did; the ring buffer of the last minutes (and a capture saved from it) holds the packets as they were.' : ''}`,
  );
</script>

{#if inLink}<span class="clear-tag" class:quiet={clear.harmless} data-tip={tip} role="img" aria-label="Unencrypted: {said}"
    ><LockOpen size={13} strokeWidth={2} aria-hidden="true" /></span
  >{:else}<button type="button" class="clear-tag" class:quiet={clear.harmless} data-tip={tip} aria-label="Unencrypted: {said}"
  ><LockOpen size={13} strokeWidth={2} aria-hidden="true" />{#if words}<span class="cw">{said}</span>{/if}</button
  >{/if}
