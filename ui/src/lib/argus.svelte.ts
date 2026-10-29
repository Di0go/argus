// What the pages share: the live session, kept current over the core's live stream (loaded whole on every connect,
// then each second's changes laid over it), the captures saved, the interfaces, the networks, and a view of either as
// an entity graph (the core's) so any page can find a device, walk to whom it talked, or search them all. The lists
// show the network chosen (networks.svelte.ts: the one it is on now, by default); a device's or a host's own page, the
// search and the cards reach everything the session saw.
//
// The page never sees a packet: only what the server added up (server/live.ts).

import { EntityGraph, keyOf, type Link } from '@organon/core/shared/entities';
import { getJson, LiveStream, sendJson } from '@organon/core/ui/live';
import { within } from '../../../shared/networks.ts';
import { companyOf, siteOf } from '../../../shared/sites.ts';
import { networks } from './networks.svelte.ts';
import type {
  ArgusEntity,
  ArgusEvent,
  Capture,
  Conversation,
  Device,
  HostsView,
  Interface,
  LiveView,
  Network,
  Remote,
  SeriesData,
  Session,
  Site,
  SourceState,
} from '../../../shared/types.ts';

/** What a page shows: the live session or a saved capture, as entities and the graph over them. */
export interface Source {
  kind: 'live' | 'capture';
  capture?: Capture;
  devices: Device[];
  remotes: Remote[];
  sites: Site[];
  links: Link[];
  /** Who talked to whom, by what service, how much and when. */
  conversations: Conversation[];
  graph: EntityGraph<ArgusEntity>;
}

/** A network the history remembers (server/history.ts), by its name as last seen. */
export interface KnownNetwork {
  id: string;
  name: string;
  ssid?: string;
  interfaces: string[];
  first: number;
  last: number;
}

const EMPTY_SERIES: SeriesData = { step: 1, end: 0, sent: [], received: [] };

class Argus {
  session = $state<Session | null>(null);
  devices = $state<Device[]>([]);
  remotes = $state<Record<string, Remote>>({});
  links = $state<Record<string, Link>>({});
  conversations = $state<Record<string, Conversation>>({});
  fine = $state<SeriesData>(EMPTY_SERIES);
  coarse = $state<SeriesData>(EMPTY_SERIES);
  byDevice = $state<Record<string, SeriesData>>({});
  byInterface = $state<Record<string, SeriesData>>({});
  captures = $state<Capture[]>([]);
  interfaces = $state<Interface[]>([]);
  /** The networks the session was on (with which is now), and those the history remembers from before it. */
  networks = $state<Network[]>([]);
  known = $state<KnownNetwork[]>([]);
  /** Where devices are found besides listening (server/sources.ts), and how each is going. */
  sources = $state<SourceState[]>([]);
  /** Why capturing can't be done yet (dumpcap missing or not allowed). */
  interfacesProblem = $state('');
  warnings = $state<string[]>([]);
  /** Whether the server has the table of networks (server/geo.ts): where the data goes. */
  geo = $state(false);
  /** Each device's rate as the meters show it: quick to rise, slow to fall (a level meter's ballistics). */
  meters = $state<Record<string, number>>({});
  /** The whole network's, the same way. */
  meter = $state(0);
  /** Each interface's listened rate, the same way: the bar's pills agree with the lines under them. */
  ifaceMeters = $state<Record<string, number>>({});
  /** Each conversation's rate now, both ways: what its totals grew by over the last three seconds or so (the window a
   * device's rate is taken over, server/live.ts), smoothed the same way. */
  flows = $state<Record<string, number>>({});
  /** Each conversation's totals as they came, with when: the window its rate is read over. */
  private seen = new Map<string, [number, number][]>();
  /** When each device was first seen by this page, to mark newcomers for a while. */
  private firstHere = new Map<string, number>();
  /** Saved captures' views, loaded when first looked at. */
  private views = $state<Record<string, HostsView>>({});
  private asked = new Set<string>();

  readonly live = new LiveStream<ArgusEvent>({
    reload: async () => {
      const [state, view, ifaces] = await Promise.all([
        getJson<{ captures: Capture[]; warnings: string[]; build?: string; geo?: boolean; networks?: KnownNetwork[]; sources?: SourceState[] }>('/api/state'),
        getJson<LiveView>('/api/live'),
        getJson<{ interfaces: Interface[]; problem?: string }>('/api/interfaces').catch((e: Error) => ({ interfaces: [], problem: e.message })),
      ]);
      this.captures = state.captures;
      this.warnings = state.warnings;
      this.geo = Boolean(state.geo);
      this.known = state.networks ?? [];
      this.sources = state.sources ?? [];
      this.networks = view.networks ?? [];
      this.interfaces = ifaces.interfaces;
      this.interfacesProblem = ifaces.problem ?? '';
      this.session = view.session;
      this.devices = view.devices;
      this.remotes = Object.fromEntries(view.remotes.map((r) => [r.id, r]));
      this.links = Object.fromEntries(view.links.map((l) => [`${l.from}>${l.to}`, l]));
      this.conversations = Object.fromEntries(view.conversations.map((c) => [c.id, c]));
      this.fine = view.total.fine;
      this.coarse = view.total.coarse;
      this.byDevice = view.byDevice;
      this.byInterface = view.byInterface ?? {};
      this.measure(true);
      return { build: state.build, seq: view.seq };
    },
    apply: (e) => this.apply(e),
    seq: (e) => (e.type === 'live' ? e.seq : undefined),
  });

  /** The live session as entities, every network of it. */
  allSource = $derived.by(
    (): Source => this.source('live', this.devices, Object.values(this.remotes), Object.values(this.links), Object.values(this.conversations)),
  );

  /** The networks to choose from: the session's, the latest first, then those remembered from before it. */
  netList = $derived.by((): Network[] => {
    const have = new Set(this.networks.map((n) => n.id));
    const before = this.known.filter((k) => !have.has(k.id)).map((k): Network => ({ ...k, routers: [], bytes: 0 }));
    return [...this.networks, ...before.sort((a, b) => b.last - a.last)];
  });

  /** The networks shown (networks.svelte.ts), or null for all of them. */
  shown = $derived(networks.ids(this.networks));

  /** The live session as entities, of the networks shown. */
  liveSource = $derived.by((): Source => {
    const ids = this.shown;
    if (!ids) return this.allSource;
    const v = within({ devices: this.devices, remotes: Object.values(this.remotes), links: Object.values(this.links), conversations: Object.values(this.conversations) }, ids);
    return this.source('live', v.devices, v.remotes, v.links, v.conversations);
  });

  start() {
    this.live.start();
  }

  /**
   * The source a page shows: a capture when the address names one, else the live session; `scoped`, of the networks
   * shown (the lists), else all of it (a device's or a host's page, search, the cards: a link never leads to nothing).
   */
  sourceFor(capture?: string, scoped = false): Source | undefined {
    if (!capture) return scoped ? this.liveSource : this.allSource;
    const v = this.views[capture];
    if (!v) {
      void this.loadCapture(capture);
      return undefined;
    }
    return this.source('capture', v.devices, v.remotes, v.links, v.conversations ?? [], v.capture);
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

  /** Asks the LAN who is there (`iface`, else the server's first real interface): the one thing Argus sends (server/sources.ts). */
  async scanSources(iface?: string): Promise<SourceState[]> {
    this.sources = await sendJson<SourceState[]>('/api/sources/scan', iface ? { iface } : {});
    return this.sources;
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
    if (e.type === 'sources') {
      this.sources = e.sources;
      return;
    }
    this.session = e.session;
    if (e.networks) this.networks = e.networks;
    // Only what changed comes: laid over what the page has, in the order it had (the table keeps its own order).
    if (e.devices.length || e.goneDevices.length) {
      const by = new Map(this.devices.map((d) => [d.id, d]));
      for (const d of e.devices) by.set(d.id, d);
      for (const id of e.goneDevices) by.delete(id);
      this.devices = [...by.values()];
    }
    for (const r of e.remotes) this.remotes[r.id] = r;
    for (const id of e.gone) delete this.remotes[id];
    for (const l of e.links) this.links[`${l.from}>${l.to}`] = l;
    // A host or device forgotten takes its links with it.
    const gone = new Set([...e.gone.map((id) => `remote:${id}`), ...e.goneDevices.map((id) => `device:${id}`)]);
    if (gone.size) for (const [k, l] of Object.entries(this.links)) if (gone.has(l.from) || gone.has(l.to)) delete this.links[k];
    const now = Date.now() / 1000;
    for (const c of e.conversations) {
      const had = this.seen.get(c.id) ?? (this.conversations[c.id] ? [[now - 1, this.conversations[c.id]!.sent + this.conversations[c.id]!.received] as [number, number]] : []);
      had.push([now, c.sent + c.received]);
      while (had.length > 2 && now - had[1]![0] >= 3) had.shift();
      this.seen.set(c.id, had);
    }
    const flows: Record<string, number> = {};
    const came = new Set(e.conversations.map((c) => c.id));
    for (const [id, had] of this.seen) {
      // A conversation not in this update did not grow: its newest total stands now.
      if (!came.has(id)) had.push([now, had.at(-1)![1]]);
      while (had.length > 2 && now - had[1]![0] >= 3) had.shift();
      const [t0, b0] = had[0]!;
      const [t1, b1] = had.at(-1)!;
      const grew = t1 > t0 ? Math.max(0, b1 - b0) / Math.max(1, t1 - t0) : 0;
      const shown = ballistics(this.flows[id] ?? 0, grew);
      if (shown) flows[id] = shown;
      // Still for three seconds: forgotten until it moves again (the next update starts it from its totals).
      else if (!grew) this.seen.delete(id);
    }
    this.flows = flows;
    for (const c of e.conversations) this.conversations[c.id] = c;
    for (const id of e.goneConversations) {
      delete this.conversations[id];
      this.seen.delete(id);
    }
    if (gone.size) for (const [k, c] of Object.entries(this.conversations)) if (gone.has(c.a) || gone.has(c.b)) delete this.conversations[k];
    this.fine = overlay(this.fine, e.total.fine);
    this.coarse = overlay(this.coarse, e.total.coarse);
    // The series that had traffic move on with it; a quiet device's stays as it was until it is heard again.
    const next: Record<string, SeriesData> = { ...this.byDevice };
    for (const id of e.goneDevices) delete next[id];
    for (const [id, tail] of Object.entries(e.byDevice)) next[id] = overlay(next[id] ?? { ...tail, sent: [], received: [] }, tail, this.fine.sent.length);
    this.byDevice = next;
    const ifaces: Record<string, SeriesData> = { ...this.byInterface };
    for (const [id, tail] of Object.entries(e.byInterface ?? {})) ifaces[id] = overlay(ifaces[id] ?? { ...tail, sent: [], received: [] }, tail, this.fine.sent.length);
    this.byInterface = ifaces;
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
    const ifaces: Record<string, number> = {};
    for (const l of this.session?.listening ?? []) ifaces[l.id] = reset ? (l.rate ?? 0) : ballistics(this.ifaceMeters[l.id] ?? 0, l.rate ?? 0);
    this.ifaceMeters = ifaces;
    this.meter = reset ? (this.session?.rate ?? 0) : ballistics(this.meter, this.session?.rate ?? 0);
  }

  private source(kind: Source['kind'], devices: Device[], remotes: Remote[], links: Link[], conversations: Conversation[], capture?: Capture): Source {
    const { sites, siteLinks } = groupSites(remotes, links);
    const graph = new EntityGraph<ArgusEntity>(
      [...devices, ...remotes, ...sites, ...this.interfaces],
      [...links, ...siteLinks, ...devices.flatMap((d) => d.interfaces.map((i) => ({ from: keyOf(d), to: `interface:${i}`, rel: 'seen-on' })))],
      (e) => ('vendor' in e && e.vendor ? `${e.vendor} ${e.model ?? ''}` : 'sites' in e ? e.sites.join(' ') : ''),
    );
    return { kind, capture, devices, remotes, sites, links, conversations, graph };
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
  // Keyed by the pair itself, never by a string split again: a name from the network may hold any character.
  const toSite = new Map<string, Link>();
  for (const l of links) {
    const company = hostSite.get(l.to);
    if (!company || !l.from.startsWith('device:')) continue;
    const to = `site:${company}`;
    const key = JSON.stringify([l.from, to]);
    const have = toSite.get(key) ?? { from: l.from, to, rel: 'uses', weight: 0 };
    have.weight = (have.weight ?? 0) + (l.weight ?? 0);
    toSite.set(key, have);
  }
  siteLinks.push(...toSite.values());
  for (const s of by.values()) {
    s.aka = s.sites.filter((x) => x !== s.name);
    s.summary = s.sites.length === 1 && s.sites[0] === s.name ? `${s.hosts.length} hosts` : s.sites.slice(0, 4).join(', ');
    for (const h of s.hosts) siteLinks.push({ from: `site:${s.id}`, to: `remote:${h}`, rel: 'runs' });
  }
  return { sites: [...by.values()].sort((a, b) => b.bytesSent + b.bytesReceived - (a.bytesSent + a.bytesReceived)), siteLinks };
}

export const argus = new Argus();
