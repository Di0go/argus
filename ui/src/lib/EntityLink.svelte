<script lang="ts">
  // A link to an entity's page that shows its card on hover (the core's HoverCard, data-tip-entity) and its menu on
  // a right-click (the core's ContextMenu, App.svelte's actions).
  import { keyOf } from '@organon/core/shared/entities';
  import type { ArgusEntity } from '../../../shared/types.ts';
  import { entityHref } from './router.svelte.ts';

  let { entity, capture, class: cls = '' }: { entity: ArgusEntity; capture?: string; class?: string } = $props();
</script>

<a class="el {cls}" href={entityHref(entity.kind, entity.id, capture)} data-tip-entity={keyOf(entity)} data-capture={capture}>{entity.name}</a>

<style>
  .el {
    color: var(--fg);
    font-weight: 500;
  }

  .el:hover {
    color: var(--acc);
    text-decoration: none;
  }
</style>
