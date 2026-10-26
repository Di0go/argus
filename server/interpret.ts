// What the sensor's facts mean: the server's reading of what a tally adds up to (server/tally.ts), kept apart from the
// tally so that the sensor (capture and adding up) could one day run on another machine and send only its facts
// (docs/sensor.md). Each host and conversation in plain words (the dictionary), which unencrypted traffic is harmless
// by design, what each device is and how it looks up names, and where each host's network is (geo.ts).
//
// It changes the view it is given and returns it: a live session reads it once a second, and the dictionary's
// answers are remembered (server/dictionary.ts).

import { identify } from '../shared/identify.ts';
import { byNetwork } from '../shared/networks.ts';
import { type DnsUse, harmless, RESOLVERS } from '../shared/security.ts';
import { type Classification, describe } from '../shared/classify.ts';
import { CATEGORIES, PORTS, TAILSCALE_RELAY } from '../shared/dictionary/apps.ts';
import type { Conversation, Device, Remote } from '../shared/types.ts';
import { asnOf, classify, siteOf } from './dictionary.ts';
import type { Geo } from './geo.ts';
import type { Dissected } from './tally.ts';

export interface Reading {
  /** This PC's system, and whether it is a laptop (server/capture.ts selfSystem). */
  self?: { os: string; laptop?: boolean };
  geo?: Geo;
  /** An interface as he would say it (server/capture.ts classify): what a network without a router is called. */
  label?: (iface: string) => string;
}

export function interpret<V extends Dissected | Pick<Dissected, 'devices' | 'remotes' | 'conversations' | 'segments'>>(v: V, o: Reading = {}): V {
  // Which network each stay was on (shared/networks.ts): the devices', the conversations' (a network's stays joined).
  byNetwork(v, { label: o.label, router: (mac) => v.devices.find((d) => d.mac === mac)?.name });
  const remotes = new Map(v.remotes.map((h) => [h.id, h]));
  for (const h of v.remotes) {
    // What it is, in plain words: by the names it was given, TLS's and HTTP's first, else its network.
    const app = classify({ names: telling(h), ip: h.ip, also: h.names.map((n) => n.name) });
    if (app) h.app = app;
    else delete h.app;
    const where = o.geo?.where(h.ip);
    if (where) h.where = where;
  }
  // And each conversation, by its other end's names and its service: WhatsApp over UDP is a call, DNS is DNS.
  for (const c of v.conversations) {
    const h = c.b.startsWith('remote:') ? remotes.get(c.b.slice('remote:'.length)) : undefined;
    const app = classify({ names: h && telling(h), ip: h?.ip, service: c.service, protocol: c.protocol, also: h?.names.map((n) => n.name) });
    if (app) c.app = app;
    // Not known, but named: the site, said by its name rather than as nothing.
    const site = !app && h ? telling(h).map((n) => siteOf(n)).find(Boolean) : undefined;
    if (site) c.site = site;
    else delete c.site;
    const asked = h?.names.filter((n) => n.source === 'HTTP' || n.source === 'TLS').map((n) => n.name) ?? [];
    if (c.clear && !c.clear.credentials && harmless(c.clear.proto, asked, (n) => classify({ names: [n] }))) c.clear.harmless = true;
  }
  // Hosts that never said a name: by how they are talked to, and by whom (likely), or by their neighbours (possibly).
  const talks = new Map<string, Conversation[]>();
  for (const c of v.conversations) if (c.b.startsWith('remote:')) (talks.get(c.b.slice(7)) ?? talks.set(c.b.slice(7), []).get(c.b.slice(7))!).push(c);
  const network = (h: Remote) => h.where?.asn ?? asnOf(h.ip);
  relays(v, talks, network);
  agreed(v.remotes, talks);
  neighbours(v.remotes, network);
  // A CDN or cloud this side mostly sent to is uploaded to (logs, backups, photos), not downloaded from.
  const up = new Map<string, [number, number]>();
  for (const c of v.conversations) {
    if (c.app?.carrier && c.b.startsWith('remote:')) {
      const u = up.get(c.b) ?? [0, 0];
      u[0] += c.sent;
      u[1] += c.received;
      up.set(c.b, u);
      if (uploads(c.sent, c.received)) c.app = { ...c.app, activity: UPLOADING };
    }
  }
  for (const h of v.remotes) {
    const u = up.get(`remote:${h.id}`);
    if (h.app?.carrier && u && uploads(u[0], u[1])) h.app = { ...h.app, activity: UPLOADING };
  }
  judge(v.devices, v.conversations, o);
  return v;
}

const UPLOADING = 'uploading to a CDN or cloud';
/** Mostly sent: twice what came back, and a megabyte or more. */
const uploads = (sent: number, received: number) => sent >= 1_000_000 && sent > 2 * received;

/** A host no name said what it is: none seen, and nothing known of it but its carrier. */
const unnamed = (h: Remote) => !h.names.length && (!h.app || h.app.carrier);

/**
 * Tailscale's relays (DERP) that never said their name. Its client asks every relay on the map its server gives it the
 * way through the router (STUN, port 3478) and how far it is (HTTP on 80, TLS on 443, ping), by address, all in the same
 * seconds (its netcheck); only the relay it settles on is named, in TLS (derp4c.tailscale.com). A host with no name
 * talked to only that way, with STUN among it, is likely one of them: from a device running Tailscale, when it is in a
 * network (AS) where one of its named relays is, or when its STUN began within seconds of STUN to many other such
 * hosts; from any device, when they are a great many (the whole map, a hundred, is asked at once). A call's relay given
 * by address (Teams, Meet) is one or two hosts, when the call begins.
 */
function relays(v: Pick<Dissected, 'remotes' | 'conversations'>, talks: Map<string, Conversation[]>, network: (h: Remote) => number | undefined) {
  // Running Tailscale: talking to it by name, or to a peer on its port.
  const running = new Set<string>();
  for (const c of v.conversations) if (c.app?.company === 'Tailscale' && !c.app.confidence) running.add(c.a);
  const named = v.remotes.filter((h) => h.app?.by === 'name' && h.app.activity === TAILSCALE_RELAY.activity);
  const nets = new Set(named.map(network).filter((n) => n !== undefined));
  const stun = (c: Conversation) => c.protocol === 'stun' || c.service === 'udp/3478';
  const probe = (c: Conversation) => stun(c) || !c.service || /^(tcp\/(80|443)|icmp|icmpv6)$/.test(c.service);
  const candidates = v.remotes.filter((h) => {
    const cs = talks.get(h.id) ?? [];
    return unnamed(h) && cs.some(stun) && cs.every(probe);
  });
  // When each candidate was first asked the way: a netcheck asks them all within a few seconds.
  const began = candidates.map((h) => Math.min(...talks.get(h.id)!.filter(stun).map((c) => c.first)));
  const like = named[0]?.app ?? { ...describe(TAILSCALE_RELAY), by: 'name' as const, rule: '' };
  candidates.forEach((h, i) => {
    const cs = talks.get(h.id)!;
    const ours = cs.every((c) => running.has(c.a));
    const net = network(h);
    const beside = ours && net !== undefined && nets.has(net) ? named.find((n) => network(n) === net) : undefined;
    const together = began.filter((t) => Math.abs(t - began[i]!) <= BURST_SECONDS).length;
    if (!beside && together < (ours ? BURST : BURST_ALONE)) return;
    const rule = beside
      ? `STUN from a device running Tailscale, in AS${net} beside its relay ${telling(beside)[0]}`
      : `STUN${ours ? ' from a device running Tailscale' : ''} to ${together} hosts with no name in the same seconds (its netcheck)`;
    h.app = { ...like, by: 'pattern', rule, confidence: 'likely', site: undefined };
    for (const c of cs) c.app = { ...like, ...(stun(c) ? { activity: 'finding the way to its relays (STUN)' } : {}), by: 'pattern', rule, confidence: 'likely', site: undefined };
  });
}

/**
 * How many hosts with no name asked by STUN within how many seconds make a netcheck rather than a call: from a device
 * known to run Tailscale, and from one that is not.
 */
const BURST = 8;
const BURST_ALONE = 20;
const BURST_SECONDS = 10;

/**
 * A host with no name whose every conversation says one company's app by how it goes (a Tailscale peer on 41641):
 * that app (and Spotify on 4070, likely). A service alone (STUN, DNS) is not whose it is, and does not count.
 */
function agreed(remotes: Remote[], talks: Map<string, Conversation[]>) {
  for (const h of remotes) {
    // Packets with no service (a ping, an ICMP error) say nothing of whose a host is.
    const cs = (talks.get(h.id) ?? []).filter((c) => c.service && c.service !== 'icmp' && c.service !== 'icmpv6');
    if (!unnamed(h) || !cs.length) continue;
    const first = cs[0]!.app;
    if (!first?.company || !first.app || first.carrier || !owned(first, cs[0]!.service)) continue;
    if (cs.every((c) => c.app && !c.app.carrier && c.app.company === first.company && c.app.app === first.app)) h.app = { ...first, site: undefined };
  }
}

/** A port's word that is a company's own (Tailscale's 41641), not a service with the carrier's name on it (STUN on AWS). */
const owned = (c: Classification, service?: string) => c.by !== 'port' || (service !== undefined && PORTS[service]?.company === c.company);

/**
 * A host with no name beside hosts with names: in the same /24 (IPv6: /64) and the same network, where every named
 * neighbour says one company in one category. Possibly that company's: a cloud gives neighbouring addresses to other
 * customers (measured on a real day: 9 in 10 such neighbours were the same company, 6 in 10 the same app).
 */
function neighbours(remotes: Remote[], network: (h: Remote) => number | undefined) {
  const named = new Map<string, Remote[]>();
  for (const h of remotes) {
    const net = network(h);
    if (net === undefined || !h.names.length || h.app?.by !== 'name' || h.app.carrier || !h.app.company) continue;
    const key = `${net} ${prefix(h.ip)}`;
    (named.get(key) ?? named.set(key, []).get(key)!).push(h);
  }
  for (const h of remotes) {
    const net = network(h);
    const near = net === undefined || !unnamed(h) ? undefined : named.get(`${net} ${prefix(h.ip)}`);
    const first = near?.[0]?.app;
    if (!near || !first || !near.every((n) => n.app!.company === first.company && n.app!.category === first.category)) continue;
    const app: Classification = { ...first, by: 'neighbour', rule: `its neighbour ${near[0]!.ip} (${telling(near[0]!)[0]})`, confidence: 'possibly', site: undefined };
    if (!near.every((n) => n.app!.app === first.app && n.app!.activity === first.activity)) {
      delete app.app;
      app.activity = CATEGORIES[first.category].activity;
    }
    h.app = app;
  }
}

/** The /24 of an IPv4 address, the /64 of an IPv6 one. */
function prefix(ip: string): string {
  if (!ip.includes(':')) return ip.split('.').slice(0, 3).join('.');
  const [head = '', tail] = ip.toLowerCase().split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

/**
 * The names that say what a host is: those TLS and HTTP asked it for, which are what its connections were for; only
 * when there are none, those DNS answered with its address (the same address answers for many names, at other times).
 */
export function telling(h: Remote): string[] {
  const asked = h.names.filter((n) => n.source === 'TLS' || n.source === 'HTTP');
  return (asked.length ? asked : h.names).map((n) => n.name);
}

/**
 * What each device is (shared/identify.ts: its own words, its maker, what it talks to) and how it looks up names: the
 * house's resolver (the router's address, or the one most devices ask), another in the clear, or encrypted (DNS over
 * TLS, or a known resolver's name in TLS).
 */
function judge(devices: Device[], conversations: Conversation[], o: Reading) {
  const byKey = new Map(devices.map((d) => [`device:${d.id}`, d]));
  const talks = new Map<string, { app?: string; company?: string; bytes: number }[]>();
  const dns = new Map<string, Map<string, DnsUse>>();
  const routerIps = new Set(devices.filter((d) => d.role === 'gateway').flatMap((d) => d.ips));
  const askers = new Map<string, Set<string>>();
  for (const c of conversations) {
    if (!byKey.has(c.a)) continue;
    if (c.app && (c.app.app || c.app.company)) (talks.get(c.a) ?? talks.set(c.a, []).get(c.a)!).push({ app: c.app.app, company: c.app.company, bytes: c.sent + c.received });
    const server = c.b.startsWith('remote:') ? c.b.slice(7) : (byKey.get(c.b)?.ips[0] ?? c.b);
    let kind: DnsUse['kind'] | undefined;
    if (c.service === 'udp/53' || c.service === 'tcp/53') kind = 'other';
    else if (c.service === 'tcp/853' || c.service === 'udp/853' || /encrypted DNS/.test(c.app?.activity ?? '')) kind = 'encrypted';
    if (!kind) continue;
    const uses = dns.get(c.a) ?? dns.set(c.a, new Map()).get(c.a)!;
    const u = uses.get(server) ?? { kind, server, count: 0, ...(RESOLVERS[server] ? { name: RESOLVERS[server] } : kind === 'encrypted' && c.app?.app ? { name: c.app.app } : {}) };
    u.count += c.packets;
    uses.set(server, u);
    if (kind === 'other') (askers.get(server) ?? askers.set(server, new Set()).get(server)!).add(c.a);
  }
  // The house's resolver: the router's, else the one most devices ask (a Pi-hole, an AdGuard Home).
  const popular = [...askers].sort((a, b) => b[1].size - a[1].size)[0];
  const house = new Set([...routerIps, ...(popular && popular[1].size > 1 && !RESOLVERS[popular[0]] ? [popular[0]] : [])]);
  for (const d of devices) {
    const key = `device:${d.id}`;
    const uses = [...(dns.get(key)?.values() ?? [])].map((u) =>
      u.kind === 'other' && house.has(u.server) ? { ...u, kind: 'house' as const, name: routerIps.has(u.server) ? 'the router' : 'the house’s resolver' } : u,
    );
    if (uses.length) d.dns = uses.sort((a, b) => b.count - a.count);
    const identity = identify({ ...d, talksTo: talks.get(key), self: d.role === 'self' ? o.self : undefined });
    if (!identity) continue;
    d.identity = identity;
    if (!d.role && !d.summary?.startsWith(identity.label)) d.summary = [identity.label, d.summary].filter(Boolean).join('; ');
    // A device that never said its name is called by what it surely or likely is, rather than by its maker.
    if (!d.names.length && !d.role && identity.product && identity.confidence !== 'possibly') d.name = `${identity.product} ·${(d.mac ?? d.ips[0] ?? '').slice(-5)}`;
  }
}
