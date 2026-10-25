<script lang="ts">
  // A link to an entity's page that shows its card on hover (the core's HoverCard, data-tip-entity).
  import { keyOf } from '@organon/core/shared/entities';
  import type { ArgusEntity } from '../../../shared/types.ts';
  import { href } from './router.svelte.ts';
  import { argus } from './state.svelte.ts';

  let { entity }: { entity: ArgusEntity } = $props();
</script>

{#if entity.kind === 'interface'}
  <span class="chip" data-tip={entity.summary}>{entity.name}</span>
{:else}
  <a href={href(entity.kind, entity.id, argus.selected)} data-tip-entity={keyOf(entity)}>{entity.name}</a>
{/if}
