// Which network each stay was on, and what each network is called: the rule over the sensor's facts (the stays,
// server/tally.ts; docs/sensor.md). The sensor keeps where this PC joined a network and the MACs its frames for the
// internet went through; this says which stays are one network.
//
// A network is its way out: the router's MAC. Two stays through the same router are one network, whatever the
// interface (the house by cable and by Wi-Fi) and whatever their addresses; two routers handing out the same addresses
// (so many hand out the same private range) are two networks, so the subnet tells nothing. Two MACs that were ways out within one stay
// (IPv4 through one router, IPv6 through another) are one network. A stay with no way out seen (Docker's bridge, a
// VPN, a network without internet) is its interface's, one per SSID. A network is named by its SSID when the system
// said one, else by its router ("Tp-Link network"), else by its interface; two of one name are told apart by the end
// of the router's MAC.

import type { Link } from '@organon/core/shared/entities';
import type { Conversation, Device, HttpRequest, Network, Segment } from './types.ts';

export interface Telling {
  /** An interface as he would say it (Wi-Fi, Cable, Docker). */
  label?: (iface: string) => string;
  /** A router's name, by its MAC (its device's). */
  router?: (mac: string) => string | undefined;
  /** The interfaces being listened on: their latest stays are now. */
  listening?: string[];
  /** Epoch seconds. */
  now?: number;
}

/** A stay this young, being listened on, with no way out yet: just joined, so which network it is will be known soon. */
const PENDING = 120;
const FIRST = 10;

const top = (counts?: Record<string, number>) => Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];

/** The networks of these stays, the latest first, and each stay's network (`of`); `pending` are the stays just joined. */
export function tell(segments: Segment[], o: Telling = {}): { networks: Network[]; of: Map<string, string>; pending: Set<string> } {
  // Routers that were ways out within one stay are one network.
  const parent = new Map<string, string>();
  const find = (m: string): string => {
    let r = m;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(m, r);
    return r;
  };
  for (const s of segments) for (const v of s.vias) if (!parent.has(v.mac)) parent.set(v.mac, v.mac);
  for (const s of segments) for (const v of s.vias.slice(1)) parent.set(find(v.mac), find(s.vias[0]!.mac));
  // Each network by the router seen first: the id stays when a second one joins later.
  const sorted = [...segments].sort((a, b) => a.first - b.first);
  const firstMac = new Map<string, string>();
  for (const s of sorted) for (const v of s.vias) if (!firstMac.has(find(v.mac))) firstMac.set(find(v.mac), v.mac);

  const now = o.now ?? Date.now() / 1000;
  const latest = new Map<string, Segment>();
  for (const s of sorted) latest.set(s.iface, s);
  const listening = new Set(o.listening ?? []);
  const pending = new Set<string>();
  // A join seen (DHCP from nothing, another SSID) waits up to PENDING for its way out; a stay that began with listening
  // (or Docker's bridge, a VPN, which never have one) only its first seconds.
  for (const [iface, s] of latest) if (listening.has(iface) && !s.vias.length && now - s.first < (s.began ? PENDING : FIRST)) pending.add(s.id);

  const of = new Map<string, string>();
  const nets = new Map<string, Network & { ssids: Record<string, number>; frames: Map<string, number>; fresh: boolean }>();
  for (const s of sorted) {
    const ssid = top(s.ssids);
    const id = s.vias.length ? `net:${firstMac.get(find(s.vias[0]!.mac))}` : `if:${s.iface}${ssid ? `:${ssid}` : ''}`;
    of.set(s.id, id);
    let n = nets.get(id);
    if (!n) {
      n = { id, name: '', routers: [], interfaces: [], first: s.first, last: s.last, bytes: 0, ssids: {}, frames: new Map(), fresh: true };
      nets.set(id, n);
    }
    n.first = Math.min(n.first, s.first);
    n.last = Math.max(n.last, s.last);
    n.bytes += s.bytes;
    if (!n.interfaces.includes(s.iface)) n.interfaces.push(s.iface);
    for (const [k, c] of Object.entries(s.ssids ?? {})) n.ssids[k] = (n.ssids[k] ?? 0) + c;
    for (const v of s.vias) n.frames.set(v.mac, (n.frames.get(v.mac) ?? 0) + v.frames);
    if (!pending.has(s.id)) n.fresh = false;
  }
  for (const [iface, s] of latest) {
    if (!listening.has(iface)) continue;
    const n = nets.get(of.get(s.id)!)!;
    n.now = true;
    (n.nowOn ??= []).push(iface);
  }

  const out: Network[] = [];
  for (const n of nets.values()) {
    const { ssids, frames, fresh, ...net } = n;
    net.routers = [...frames].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const ssid = top(ssids);
    if (ssid) net.ssid = ssid;
    const iface = net.interfaces[0] ?? '';
    const router = net.routers[0];
    // Without an SSID, by its router: "Tp-Link network" (its maker, as the router is named), "Livebox-1234 network".
    const routerName = router ? (o.router?.(router)?.replace(/^Router\s+/, '') ?? `Router ·${router.slice(-5)}`) : undefined;
    net.name = ssid ?? (routerName ? `${routerName} network` : (o.label?.(iface) ?? (iface || 'This capture')));
    if (fresh) net.pending = true;
    out.push(net);
  }
  // Two of one name (two cafés' "MEO-WiFi", two routers of one maker): the end of the router's MAC, as long as it takes
  // to tell them apart, or the interface.
  const groups = new Map<string, Network[]>();
  for (const n of out) groups.set(n.name, [...(groups.get(n.name) ?? []), n]);
  for (const [name, same] of groups) {
    if (same.length < 2) continue;
    let k = 5;
    const tail = (n: Network) => (n.routers[0] ? `·${n.routers[0].slice(-k)}` : `(${n.interfaces.join(', ')})`);
    while (k < 17 && new Set(same.map(tail)).size < same.length) k += 3;
    for (const n of same) n.name = `${name} ${tail(n)}`;
  }
  return { networks: out.sort((a, b) => b.last - a.last), of, pending };
}

/**
 * The facts read by network: the networks of their stays; each device's networks (the latest first) and, on more than
 * one, its traffic on each; each conversation's network, the stays of one network joined into one conversation. The
 * stays themselves are dropped (the page and the agent need the networks). Facts without stays are left as they are.
 */
export function byNetwork<V extends { devices: Device[]; conversations: Conversation[]; segments?: Segment[]; listening?: string[]; requests?: HttpRequest[] }>(
  v: V,
  o: Telling = {},
): V & { networks?: Network[] } {
  if (!v.segments) return v;
  const told = tell(v.segments, { ...o, listening: o.listening ?? v.listening });
  const bySeg = new Map(v.segments.map((s) => [s.id, s]));
  const near = networkAt(v.segments, told.of);
  for (const d of v.devices) {
    const per = new Map<string, NonNullable<Device['perNetwork']>[string]>();
    for (const h of d.heard ?? []) {
      const id = told.of.get(h.segment) ?? (bySeg.has(h.segment) ? undefined : near(d.interfaces[0] ?? '', h.last));
      if (!id) continue;
      const p = per.get(id) ?? { packets: 0, bytesSent: 0, bytesReceived: 0, firstSeen: h.first, lastSeen: h.last };
      p.packets += h.packets;
      p.bytesSent += h.sent;
      p.bytesReceived += h.received;
      p.firstSeen = Math.min(p.firstSeen, h.first);
      p.lastSeen = Math.max(p.lastSeen, h.last);
      per.set(id, p);
    }
    if (!per.size) {
      const id = near(d.interfaces[0] ?? '', d.lastSeen);
      if (id) per.set(id, { packets: d.packets, bytesSent: d.bytesSent, bytesReceived: d.bytesReceived, firstSeen: d.firstSeen, lastSeen: d.lastSeen });
    }
    d.networks = [...per].sort((a, b) => b[1].lastSeen - a[1].lastSeen).map(([id]) => id);
    if (per.size > 1) d.perNetwork = Object.fromEntries(per);
    else delete d.perNetwork;
    delete d.heard;
  }
  const merged = new Map<string, Conversation>();
  const pending = new Set<string>();
  for (const c of v.conversations) {
    const network = (c.segment && told.of.get(c.segment)) || near(c.interfaces[0] ?? '', c.first) || '';
    const id = `${c.a} ${c.b} ${c.service}${network ? ` ${network}` : ''}`;
    if (c.segment && told.pending.has(c.segment)) pending.add(id);
    const had = merged.get(id);
    const { segment: _, ...rest } = c;
    if (!had) {
      merged.set(id, { ...rest, id, interfaces: [...c.interfaces], ...(network ? { network } : {}) });
      continue;
    }
    had.sent += c.sent;
    had.received += c.received;
    had.packets += c.packets;
    had.first = Math.min(had.first, c.first);
    had.last = Math.max(had.last, c.last);
    for (const i of c.interfaces) if (!had.interfaces.includes(i)) had.interfaces.push(i);
    had.protocol ??= c.protocol;
    if (c.clear) had.clear = { proto: c.clear.proto, ...(c.clear.credentials || had.clear?.credentials ? { credentials: true } : {}) };
    if (c.tls) had.tls = c.tls;
    if (c.read) had.read = true;
  }
  v.conversations = [...merged.values()];
  // Which network a just-joined stay is on is not known yet: the history counts its traffic once it is.
  for (const c of v.conversations) if (pending.has(c.id)) c.pending = true;
  // Each HTTP request on the network of its stay, as its conversation is.
  for (const r of v.requests ?? []) {
    const network = (r.segment && told.of.get(r.segment)) || near(r.iface, r.time);
    delete r.segment;
    if (network) r.network = network;
  }
  delete v.segments;
  return Object.assign(v, { networks: told.networks });
}

/** How near a stay a time may be and still be its network: a frame heard just before the stay was told, or just after. */
const NEAR = 60;

/**
 * The network an interface was on at a time: its stay that holds it, else the nearest one within a minute. Outside
 * that it could have been on another network, so it is none: a list that guesses is worse than one that says it does
 * not know. `of` is each stay's network (tell). What another source found (server/sources.ts) is placed by the same rule.
 */
export function networkAt(segments: Segment[], of: Map<string, string>): (iface: string, t: number) => string | undefined {
  return (iface, t) => {
    const gap = (s: Segment) => (t < s.first ? s.first - t : t > s.last ? t - s.last : 0);
    const stays = segments.filter((x) => x.iface === iface);
    const inside = stays.filter((s) => gap(s) === 0).sort((a, b) => b.last - a.last)[0];
    if (inside) return of.get(inside.id);
    const s = stays.sort((a, b) => gap(a) - gap(b))[0];
    return s && gap(s) <= NEAR ? of.get(s.id) : undefined;
  };
}

/**
 * What one or more networks saw: their devices (with their traffic on them, when they were on others too), their
 * conversations, the hosts those reached (with what went to and from them there), and the links between them.
 */
export function within<V extends { devices: Device[]; remotes: { id: string; packets: number; bytesSent: number; bytesReceived: number; firstSeen: number; lastSeen: number }[]; links: Link[]; conversations: Conversation[] }>(
  v: V,
  networks: ReadonlySet<string>,
): V {
  const devices = v.devices.flatMap((d) => {
    const all = d.networks ?? [];
    const mine = all.filter((n) => networks.has(n));
    if (!mine.length) return [];
    const per = d.perNetwork ? mine.map((n) => [n, d.perNetwork![n]!] as const).filter(([, p]) => p) : [];
    // What it moved on the networks shown: its own share on each when it was on more than one, else its whole.
    const totals = per.length
      ? {
          packets: per.reduce((s, [, p]) => s + p.packets, 0),
          bytesSent: per.reduce((s, [, p]) => s + p.bytesSent, 0),
          bytesReceived: per.reduce((s, [, p]) => s + p.bytesReceived, 0),
          firstSeen: Math.min(...per.map(([, p]) => p.firstSeen)),
          lastSeen: Math.max(...per.map(([, p]) => p.lastSeen)),
        }
      : { packets: d.packets, bytesSent: d.bytesSent, bytesReceived: d.bytesReceived, firstSeen: d.firstSeen, lastSeen: d.lastSeen };
    const elsewhere = all.filter((n) => !networks.has(n));
    return [{ ...d, ...totals, networks: mine, ...(elsewhere.length ? { elsewhere } : {}) }];
  });
  const conversations = v.conversations.filter((c) => c.network && networks.has(c.network));
  const hosts = new Map<string, { packets: number; bytesSent: number; bytesReceived: number; firstSeen: number; lastSeen: number }>();
  const links = new Map<string, Link>();
  for (const c of conversations) {
    const l = links.get(`${c.a}>${c.b}`) ?? { from: c.a, to: c.b, rel: 'talks-to', weight: 0 };
    l.weight = (l.weight ?? 0) + c.sent + c.received;
    links.set(`${c.a}>${c.b}`, l);
    if (!c.b.startsWith('remote:')) continue;
    const id = c.b.slice('remote:'.length);
    const h = hosts.get(id) ?? { packets: 0, bytesSent: 0, bytesReceived: 0, firstSeen: c.first, lastSeen: c.last };
    h.packets += c.packets;
    h.bytesSent += c.received;
    h.bytesReceived += c.sent;
    h.firstSeen = Math.min(h.firstSeen, c.first);
    h.lastSeen = Math.max(h.lastSeen, c.last);
    hosts.set(id, h);
  }
  const remotes = v.remotes.filter((r) => hosts.has(r.id)).map((r) => ({ ...r, ...hosts.get(r.id) }));
  const busiest = <T extends { bytesSent: number; bytesReceived: number }>(a: T, b: T) => b.bytesSent + b.bytesReceived - (a.bytesSent + a.bytesReceived);
  return { ...v, devices, conversations, remotes: remotes.sort(busiest), links: [...links.values()] };
}

/** The networks a view is about when "now" is asked: those listened on now, else the latest one. */
export function nowOf(networks: Network[]): Set<string> {
  const now = networks.filter((n) => n.now);
  return new Set((now.length ? now : networks.slice(0, 1)).map((n) => n.id));
}

/** A network by its id or its name (whole, then a part of it), as the agent may ask for it. */
export function findNetwork(networks: Network[], q: string): Network | undefined {
  const s = q.trim().toLowerCase();
  return (
    networks.find((n) => n.id.toLowerCase() === s || n.name.toLowerCase() === s || n.ssid?.toLowerCase() === s) ??
    networks.find((n) => n.name.toLowerCase().includes(s))
  );
}
