<script lang="ts">
  // Bytes a second over time, as the core's line chart draws it: the last ten minutes a second at a time, or the day a
  // minute at a time. The y axis from zero, the x axis on round moments of the clock.
  import LineChart from '@organon/core/ui/charts/LineChart.svelte';
  import { timeTicks } from '@organon/core/ui/charts/scale';
  import { formatClock, formatTime } from '@organon/core/ui/format';
  import type { SeriesData } from '../../../shared/types.ts';
  import { rate, rateTick } from './format.ts';

  let {
    series,
    label,
    seconds,
    color = 'var(--series-2)',
    height = 200,
  }: { series: SeriesData; label: string; seconds?: number; color?: string; height?: number } = $props();

  const points = $derived.by(() => {
    const n = series.sent.length;
    const keep = seconds ? Math.min(n, Math.ceil(seconds / series.step)) : n;
    const out: { x: number; value: number }[] = [];
    for (let i = n - keep; i < n; i++) {
      const bucket = series.end - (n - 1 - i);
      out.push({ x: bucket * series.step * 1000, value: ((series.sent[i] ?? 0) + (series.received[i] ?? 0)) / series.step });
    }
    return out;
  });
  const from = $derived(points[0]?.x ?? Date.now() - 600_000);
  const to = $derived(points.at(-1)?.x ?? Date.now());
</script>

<LineChart
  {label}
  {from}
  {to}
  {height}
  zero
  series={[{ key: 'rate', label, color, points, area: true }]}
  format={rateTick}
  formatX={(x) => formatTime(x)}
  formatLong={(x) => `${rate(points.find((p) => p.x === x)?.value)} · ${series.step === 1 ? formatClock(x) : formatTime(x)}`}
  ticks={timeTicks(from, to, 5)}
/>
