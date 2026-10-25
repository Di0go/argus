<script lang="ts">
  // Under a page's title when it shows a saved capture, not the live session: which one, and the way back to now.
  import type { Source } from './argus.svelte.ts';
  import { span, when } from './format.ts';
  import { link } from './router.svelte.ts';

  let { source }: { source: Source } = $props();
</script>

{#if source.kind === 'capture' && source.capture}
  <p class="source">
    Da captura de <a href={link.capture(source.capture.id)}>{when(source.capture.started)}</a>, {source.capture.interfaces.join(', ')},
    {span(source.capture.seconds)}. <a href={location.hash.split('?')[0]}>Ver agora</a>
  </p>
{/if}

<style>
  .source {
    display: inline-block;
    margin: 14px 0 0;
    padding: 4px 10px;
    border-radius: var(--radius);
    background: var(--shaky-soft);
    font-size: 0.84rem;
    color: var(--fg-2);
  }
</style>
