// What the pages share: the live session, kept current over the core's live stream (loaded whole on every connect,
// then each second's changes laid over it), the captures saved, the interfaces, and a view of either as an entity
// graph (the core's) so any page can find a device, walk to whom it talked, or search them all.
//
// The page never sees a packet: only what the server added up (server/live.ts).

import { EntityGraph, keyOf, type Link } from '@organon/core/shared/entities';
import { getJson, LiveStream, sendJson } from '@organon/core/ui/live';
import { companyOf, siteOf } from '../../../shared/sites.ts';
import type {
  ArgusEntity,
  ArgusEvent,
  Capture,
  Device,
  HostsView,
  Interface,
  LiveView,
  Remote,
  SeriesData,
  Session,
  Site,
} from '../../../shared/types.ts';

/** What a page shows: the live session or a saved capture, as entities and the graph over them. */
export interface Source {
  kind: 'live' | 'capture';
  capture?: Capture;
  devices: Device[];
  remotes: Remote[];
  sites: Site[];
  links: Link[];
  graph: EntityGraph<ArgusEntity>;
}

const EMPTY_SERIES: SeriesData = { step: 1, end: 0, sent: [], received: [] };

class Argus {
  session = $state<Session | null>(null);
  devices = $state<Device[]>([]);
  remotes = $state<Record<string, Remote>>({});
  links = $state<Record<string, Link>>({});
  fine = $state<SeriesData>(EMPTY_SERIES);
  coarse = $state<SeriesData>(EMPTY_SERIES);
  byDevice = $state<Record<string, SeriesData>>({});
  captures = $state<Capture[]>([]);
  interfaces = $state<Interface[]>([]);
  /** Why capturing can't be done yet (dumpcap missing or not allowed). */
  interfacesProblem = $state('');
  warnings = $state<string[]>([]);
  /** Each device's rate as the meters show it: quick to rise, slow to fall (a level meter's ballistics). */
  meters = $state<Record<string, number>>({});
  /** The whole network's, the same way. */
  meter = $state(0);
  /** When each device was first seen by this page, to mark newcomers for a while. */
  private firstHere = new Map<string, number>();
  /** Saved captures' views, loaded when first looked at. */
  private views = $state<Record<string, HostsView>>({});
  private asked = new Set<string>();

  readonly live = new LiveStream<ArgusEvent>({
    reload: async () => {
      const [state, view, ifaces] = await Promise.all([
        getJson<{ captures: Capture[]; warnings: string[]; build?: string }>('/api/state'),
        getJson<LiveView>('/api/live'),
        getJson<{ interfaces: Interface[]; problem?: string }>('/api/interfaces').catch((e: Error) => ({ interfaces: [], problem: e.message })),
      ]);
      this.captures = state.captures;
      this.warnings = state.warnings;
      this.interfaces = ifaces.interfaces;
      this.interfacesProblem = ifaces.problem ?? '';
      this.session = view.session;
      this.devices = view.devices;
      this.remotes = Object.fromEntries(view.remotes.map((r) => [r.id, r]));
      this.links = Object.fromEntries(view.links.map((l) => [`${l.from}>${l.to}`, l]));
      this.fine = view.total.fine;
      this.coarse = view.total.coarse;
      this.byDevice = view.byDevice;
      this.measure(true);
      return state.build;
    },
    apply: (e) => this.apply(e),
  });

  /** The live session as entities. */
  liveSource = $derived.by((): Source => this.source('live', this.devices, Object.values(this.remotes), Object.values(this.links)));

  start() {
    this.live.start();
  }

  /** The source a page shows: a capture when the address names one, else the live session. */
  sourceFor(capture?: string): Source | undefined {
    if (!capture) return this.liveSource;
    const v = this.views[capture];
    if (!v) {
      void this.loadCapture(capture);
      return undefined;
    }
    return this.source('capture', v.devices, v.remotes, v.links, v.capture);
  }

  /** Why a capture can't be shown, once its loading failed. */
  captureProblem = $state<Record<string, string>>({});

  async loadCapture(id: string) {
    if (this.asked.has(id)) return;
    this.asked.add(id);
    try {
      this.views[id] = await getJson<HostsView>(`/api/captures/${encodeURIComponent(id)}`);
    } catch (err) {
      this.captureProblem[id] = (err as Error).message;
      this.asked.delete(id);
    }
  }

  async listen(id: string, on: boolean): Promise<string> {
    try {
      this.session = await sendJson<Session>(`/api/live/${encodeURIComponent(id)}`, { on }, 'PUT');
      return '';
    } catch (err) {
      return (err as Error).message;
    }
  }

  async reset(): Promise<void> {
    await sendJson('/api/live/reset', {});
  }

  async save(): Promise<Capture> {
    const c = await sendJson<Capture>('/api/live/save', {});
    if (!this.captures.some((x) => x.id === c.id)) this.captures = [c, ...this.captures];
    return c;
  }

  async removeCapture(id: string): Promise<void> {
    await fetch(`/api/captures/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.captures = this.captures.filter((c) => c.id !== id);
  }

  /** Whether a device turned up in the last minute of a session that has been going for longer: worth a mark. */
  isNew(d: Device): boolean {
    const started = this.session?.started ?? 0;
    const first = this.firstHere.get(d.id) ?? d.firstSeen;
    return Date.now() / 1000 - first < 60 && first - started > 30;
  }

  private apply(e: ArgusEvent) {
    if (e.type === 'reset') return void this.live.refresh();
    if (e.type === 'captures') {
      this.captures = e.captures;
      return;
    }
    this.session = e.session;
    this.devices = e.devices;
    for (const r of e.remotes) this.remotes[r.id] = r;
    for (const id of e.gone) delete this.remotes[id];
    for (const l of e.links) this.links[`${l.from}>${l.to}`] = l;
    this.fine = overlay(this.fine, e.total.fine);
    this.coarse = overlay(this.coarse, e.total.coarse);
    const next: Record<string, SeriesData> = {};
    for (const d of e.devices) {
      const tail = e.byDevice[d.id];
      next[d.id] = tail ? overlay(this.byDevice[d.id] ?? { ...tail, sent: [], received: [] }, tail, this.fine.sent.length) : (this.byDevice[d.id] ?? EMPTY_SERIES);
    }
    this.byDevice = next;
    this.measure();
  }

  private measure(reset = false) {
    const now = Date.now() / 1000;
    const meters: Record<string, number> = {};
    for (const d of this.devices) {
      if (!this.firstHere.has(d.id)) this.firstHere.set(d.id, reset ? d.firstSeen : now);
      const raw = (d.rate?.sent ?? 0) + (d.rate?.received ?? 0);
      meters[d.id] = reset ? raw : ballistics(this.meters[d.id] ?? 0, raw);
    }
    this.meters = meters;
    this.meter = reset ? (this.session?.rate ?? 0) : ballistics(this.meter, this.session?.rate ?? 0);
  }

  private source(kind: Source['kind'], devices: Device[], remotes: Remote[], links: Link[], capture?: Capture): Source {
    const { sites, siteLinks } = groupSites(remotes, links);
    const graph = new EntityGraph<ArgusEntity>(
      [...devices, ...remotes, ...sites, ...this.interfaces],
      [...links, ...siteLinks, ...devices.flatMap((d) => d.interfaces.map((i) => ({ from: keyOf(d), to: `interface:${i}`, rel: 'seen-on' })))],
      (e) => ('vendor' in e && e.vendor ? `${e.vendor} ${e.model ?? ''}` : 'sites' in e ? e.sites.join(' ') : ''),
    );
    return { kind, capture, devices, remotes, sites, links, graph };
  }
}

/** Rises at once, falls by half each second: a meter that reads, not one that flickers. */
function ballistics(shown: number, raw: number): number {
  if (raw >= shown) return raw;
  const fallen = shown * 0.5 + raw * 0.5;
  return fallen < 1 ? 0 : fallen;
}

/** Lays the newest buckets the server sent over the series the page has, moving it on in time if they are newer. */
export function overlay(have: SeriesData, tail: SeriesData, length = 0): SeriesData {
  const count = Math.max(have.sent.length, tail.sent.length, length);
  const sent = [...have.sent];
  const received = [...have.received];
  while (sent.length < count) {
    sent.unshift(0);
    received.unshift(0);
  }
  let end = have.end;
  if (tail.end > end) {
    const shift = Math.min(count, tail.end - end);
    sent.splice(0, shift);
    received.splice(0, shift);
    for (let k = 0; k < shift; k++) {
      sent.push(0);
      received.push(0);
    }
    end = tail.end;
  }
  tail.sent.forEach((v, k) => {
    const i = count - 1 - (end - (tail.end - (tail.sent.length - 1 - k)));
    if (i >= 0 && i < count) {
      sent[i] = v;
      received[i] = tail.received[k] ?? 0;
    }
  });
  return { step: tail.step, end, sent, received };
}

/** The hosts by who runs them, with a link from each device to each company it talked to, and from each company to its hosts. */
function groupSites(remotes: Remote[], links: Link[]): { sites: Site[]; siteLinks: Link[] } {
  const by = new Map<string, Site>();
  const hostSite = new Map<string, string>();
  for (const r of remotes) {
    const site = r.names.map((n) => siteOf(n.name)).find(Boolean);
    if (!site) continue;
    const company = companyOf(site);
    let s = by.get(company);
    if (!s) {
      s = { kind: 'site', id: company, name: company, sites: [], hosts: [], bytesSent: 0, bytesReceived: 0, lastSeen: 0, aka: [] };
      by.set(company, s);
    }
    if (!s.sites.includes(site)) s.sites.push(site);
    s.hosts.push(r.id);
    s.bytesSent += r.bytesSent;
    s.bytesReceived += r.bytesReceived;
    s.lastSeen = Math.max(s.lastSeen, r.lastSeen);
    hostSite.set(`remote:${r.id}`, company);
  }
  const siteLinks: Link[] = [];
  const toSite = new Map<string, number>();
  for (const l of links) {
    const company = hostSite.get(l.to);
    if (!company || !l.from.startsWith('device:')) continue;
    const key = `${l.from}>site:${company}`;
    toSite.set(key, (toSite.get(key) ?? 0) + (l.weight ?? 0));
  }
  for (const [key, weight] of toSite) {
    const [from, to] = key.split('>') as [string, string];
    siteLinks.push({ from, to, rel: 'uses', weight });
  }
  for (const s of by.values()) {
    s.aka = s.sites.filter((x) => x !== s.name);
    s.summary = s.sites.length === 1 && s.sites[0] === s.name ? `${s.hosts.length} anfitriões` : s.sites.slice(0, 4).join(', ');
    for (const h of s.hosts) siteLinks.push({ from: `site:${s.id}`, to: `remote:${h}`, rel: 'runs' });
  }
  return { sites: [...by.values()].sort((a, b) => b.bytesSent + b.bytesReceived - (a.bytesSent + a.bytesReceived)), siteLinks };
}

export const argus = new Argus();
