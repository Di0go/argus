// Amounts of data and speeds, as he reads them; the dates and the rest are the core's (ui/format.ts).

import { number } from '@organon/core/ui/format';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 → "1.5 KB". */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${number(v, v < 10 ? 1 : 0)} ${UNITS[i]}`;
}

/** Bytes a second → "12 KB/s"; nothing is "—". */
export function rate(n: number | undefined): string {
  if (!n) return '—';
  return `${bytes(n)}/s`;
}

/** An axis tick for a rate: short, and said as a rate ("1 MB/s"), as the figures beside the chart are. */
export function rateTick(n: number): string {
  return n ? `${bytes(n).replace(/[.,]0 /, ' ')}/s` : '0';
}

/** "5 s ago", "3 min ago", "2 h ago", from epoch seconds. */
export function since(epochSeconds: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - epochSeconds));
  if (s < 5) return 'now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** How long, from seconds: "45 s", "12 min", "3 h 05". */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
}

/** "25/10 18:25", from epoch seconds. */
export function when(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
