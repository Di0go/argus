<script lang="ts">
  // A device's last minutes of traffic as a small area, on the scale of the busiest device here, so a glance down the
  // column compares them. No axis, no numbers: the column beside it says the rate.
  import type { SeriesData } from '../../../shared/types.ts';

  let { series, max, seconds = 120, width = 96, height = 22 }: { series?: SeriesData; max: number; seconds?: number; width?: number; height?: number } =
    $props();

  const values = $derived.by(() => {
    if (!series?.sent.length) return [];
    const n = Math.min(seconds, series.sent.length);
    const out: number[] = [];
    for (let i = series.sent.length - n; i < series.sent.length; i++) out.push((series.sent[i] ?? 0) + (series.received[i] ?? 0));
    return out;
  });
  const d = $derived.by(() => {
    if (!values.length || max <= 0) return '';
    const step = width / Math.max(1, values.length - 1);
    // A square root, so a quiet device still shows a pulse beside a busy one.
    const y = (v: number) => height - 1 - Math.sqrt(v / max) * (height - 2);
    let p = `M0,${height}`;
    values.forEach((v, i) => (p += `L${(i * step).toFixed(1)},${y(v).toFixed(1)}`));
    return `${p}L${width},${height}Z`;
  });
</script>

<svg class="spark" {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
  <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} />
  {#if d}<path {d} />{/if}
</svg>

<style>
  .spark {
    display: block;
  }

  line {
    stroke: var(--rule);
  }

  path {
    fill: var(--acc);
    opacity: 0.55;
  }
</style>
