<script lang="ts">
  // What a device is, and how sure: "iPhone, iOS · sure". The clues behind it, with where each came from, on hover;
  // the device's page lists them.
  import type { Device } from '../../../shared/types.ts';

  let { device }: { device: Device } = $props();

  const id = $derived(device.identity);
  const tip = $derived(id ? id.clues.map((c) => `${c.says}: ${c.from}`).join('\n') : '');
</script>

{#if id && device.role !== 'gateway'}<span class="identity" data-tip={tip}
    >{id.label}<span class="sure-word">{' · '}{id.confidence}</span></span
  >{/if}

<style>
  .identity {
    cursor: help;
  }
</style>
