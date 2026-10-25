// Numbers and times as he reads them.

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function when(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'medium' });
}

export function duration(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60 ? `${seconds % 60} s` : ''}`.trim();
}
