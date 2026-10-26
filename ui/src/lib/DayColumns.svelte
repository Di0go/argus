<script lang="ts">
  // The day, an hour a column, each stacked by what the traffic was for (five groups: categories.ts), so the shape of
  // the day reads at once: video in the evening, work in the afternoon. The core's chart, with its legend and tooltip.
  import StackedColumns from '@organon/core/ui/charts/StackedColumns.svelte';
  import { GROUPS, groupOfCategory } from './categories.ts';
  import { bytes } from './format.ts';

  let { hours, label = 'The day by hour, by what the traffic was for' }: { hours: Record<string, number>[]; label?: string } = $props();

  const rows = $derived(
    hours.map((h, i) => {
      const values: Record<string, number> = {};
      for (const [cat, b] of Object.entries(h)) {
        const g = groupOfCategory(cat).key;
        values[g] = (values[g] ?? 0) + b;
      }
      return { key: String(i), label: String(i).padStart(2, '0'), values };
    }),
  );
  // Only the groups the day had, in their fixed order (the colour follows the group).
  const series = $derived(GROUPS.filter((g) => rows.some((r) => (r.values[g.key] ?? 0) > 0)).map((g) => ({ key: g.key, label: g.label, color: g.color })));
</script>

<StackedColumns {rows} {series} {label} format={(v) => (v ? bytes(v).replace(/[.,]0 /, ' ') : '0')} />
