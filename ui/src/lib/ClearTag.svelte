<script lang="ts">
  // "Without encryption", said with the one colour that means it and an open padlock (never the colour alone); a
  // harmless one (a connectivity check, a certificate list) said quietly, without the colour.
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import { CLEAR_WHY } from '../../../shared/security.ts';

  let { clear, long = false }: { clear: { proto: string; credentials?: boolean; harmless?: boolean }; long?: boolean } = $props();

  const words = $derived(
    clear.credentials ? `${clear.proto}, a login in the clear` : clear.harmless ? `${clear.proto}, harmless` : long ? `${clear.proto}, unencrypted` : clear.proto,
  );
  const tip = $derived(
    clear.harmless
      ? `${clear.proto} in the clear, by design: a connectivity check, a certificate list or a software update: public and signed.`
      : `${clear.proto} without encryption: ${CLEAR_WHY[clear.proto] ?? 'what it carries can be read on the way'}.${clear.credentials ? ' A login went by in it: Argus’s pages, history and agent keep only that it did; the ring buffer of the last minutes (and a capture saved from it) holds the packets as they were.' : ''}`,
  );
</script>

<span class="clear-tag" class:quiet={clear.harmless} data-tip={tip}><LockOpen size={12} strokeWidth={2.4} aria-hidden="true" />{words}</span>
