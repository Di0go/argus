// The day as the server keeps it (GET /api/day: server/history.ts), for the home page, the diary and a device's page:
// loaded when first asked for, and today's again every minute while a page shows it.

import { getJson } from '@organon/core/ui/live';
import type { DayView } from '../../../shared/types.ts';

class Days {
  views = $state<Record<string, DayView>>({});
  problems = $state<Record<string, string>>({});
  private loading = new Set<string>();
  private when = new Map<string, number>();

  /**
   * The day (today when not said), of every network or of those given, and of every device or one (its entity key);
   * refreshed after a minute.
   */
  get(date?: string, device?: string, networks?: Set<string> | null): DayView | undefined {
    const nets = networks ? [...networks].sort() : [];
    const key = `${date ?? ''}|${device ?? ''}|${nets.join(',')}`;
    const age = Date.now() - (this.when.get(key) ?? 0);
    if (!this.loading.has(key) && (!this.views[key] || (!date && age > 60_000))) void this.load(key, date, device, nets);
    return this.views[key];
  }

  private async load(key: string, date?: string, device?: string, networks: string[] = []) {
    this.loading.add(key);
    this.when.set(key, Date.now());
    const q = new URLSearchParams();
    if (date) q.set('date', date);
    if (device) q.set('device', device);
    for (const n of networks) q.append('network', n);
    try {
      this.views[key] = await getJson<DayView>(`/api/day${q.size ? `?${q}` : ''}`);
      delete this.problems[key];
    } catch (err) {
      this.problems[key] = (err as Error).message;
    } finally {
      this.loading.delete(key);
    }
  }
}

export const days = new Days();
