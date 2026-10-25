// What the pages share: the interfaces, the captures, and the view of the capture being looked at, as an entity graph
// (the core's) so any page can find a device, walk to who it talked to, or search them all.

import { EntityGraph } from '@organon/core/shared/entities';
import type { ArgusEntity, Capture, HostsView, Interface } from '../../../shared/types.ts';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body;
}

class State {
  interfaces = $state<Interface[]>([]);
  interfacesProblem = $state('');
  captures = $state<Capture[]>([]);
  view = $state<HostsView | null>(null);
  problem = $state('');
  /** The capture the pages show: the one asked for in the address, else the newest finished. */
  selected = $state<string | undefined>(undefined);
  graph = $derived(
    new EntityGraph<ArgusEntity>(
      [...(this.view?.devices ?? []), ...(this.view?.remotes ?? []), ...this.interfaces],
      this.view?.links ?? [],
      (e) => ('vendor' in e && e.vendor ? e.vendor : ''),
    ),
  );
  private timer: ReturnType<typeof setTimeout> | undefined;

  async loadInterfaces() {
    try {
      const r = await get<{ interfaces: Interface[]; problem?: string }>('/api/interfaces');
      this.interfaces = r.interfaces;
      this.interfacesProblem = r.problem ?? '';
    } catch (err) {
      this.interfacesProblem = (err as Error).message;
    }
  }

  async loadCaptures() {
    this.captures = await get<Capture[]>('/api/captures');
    const running = this.captures.some((c) => c.status === 'running');
    clearTimeout(this.timer);
    // While one runs, look again every second; when it ends, show what it saw.
    if (running) this.timer = setTimeout(() => void this.refresh(), 1000);
  }

  async loadView() {
    const id = this.selected ?? this.captures.find((c) => c.status === 'done')?.id;
    if (!id) {
      this.view = null;
      return;
    }
    if (this.view?.capture.id === id && this.view.devices) return;
    try {
      const v = await get<HostsView>(`/api/captures/${encodeURIComponent(id)}`);
      this.view = v.devices ? v : null;
      this.problem = '';
    } catch (err) {
      this.problem = (err as Error).message;
    }
  }

  async refresh() {
    const wasRunning = this.captures.find((c) => c.status === 'running')?.id;
    await this.loadCaptures();
    if (wasRunning && this.captures.find((c) => c.id === wasRunning)?.status === 'done') this.selected = wasRunning;
    await this.loadView();
  }

  async start(interfaces: string[], seconds: number): Promise<string> {
    const res = await fetch('/api/captures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interfaces, seconds }),
    });
    const body = (await res.json()) as { error?: string };
    await this.refresh();
    return res.ok ? '' : (body.error ?? `${res.status}`);
  }
}

export const argus = new State();
