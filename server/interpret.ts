// What the sensor's facts mean: the server's reading of what a tally adds up to (server/tally.ts), kept apart from the
// tally so that the sensor (capture and adding up) could one day run on another machine and send only its facts
// (docs/sensor.md). Each host and conversation in plain words (the dictionary), which unencrypted traffic is harmless
// by design, what each device is and how it looks up names, and where each host's network is (geo.ts).
//
// It changes the view it is given and returns it: a live session reads it once a second, and the dictionary's
// answers are remembered (server/dictionary.ts).

import { identify } from '../shared/identify.ts';
import { type DnsUse, harmless, RESOLVERS } from '../shared/security.ts';
import type { Conversation, Device, Remote } from '../shared/types.ts';
import { classify } from './dictionary.ts';
import type { Geo } from './geo.ts';
import type { Dissected } from './tally.ts';

export interface Reading {
  /** This PC's system, and whether it is a laptop (server/capture.ts selfSystem). */
  self?: { os: string; laptop?: boolean };
  geo?: Geo;
}

export function interpret<V extends Dissected | Pick<Dissected, 'devices' | 'remotes' | 'conversations'>>(v: V, o: Reading = {}): V {
  const remotes = new Map(v.remotes.map((h) => [h.id, h]));
  for (const h of v.remotes) {
    // What it is, in plain words: by the names it was given, TLS's and HTTP's first, else its network.
    const app = classify({ names: telling(h), ip: h.ip });
    if (app) h.app = app;
    else delete h.app;
    const where = o.geo?.where(h.ip);
    if (where) h.where = where;
  }
  // And each conversation, by its other end's names and its service: WhatsApp over UDP is a call, DNS is DNS.
  for (const c of v.conversations) {
    const h = c.b.startsWith('remote:') ? remotes.get(c.b.slice('remote:'.length)) : undefined;
    const app = classify({ names: h && telling(h), ip: h?.ip, service: c.service, protocol: c.protocol });
    if (app) c.app = app;
    const asked = h?.names.filter((n) => n.source === 'HTTP' || n.source === 'TLS').map((n) => n.name) ?? [];
    if (c.clear && !c.clear.credentials && harmless(c.clear.proto, asked, app)) c.clear.harmless = true;
  }
  judge(v.devices, v.conversations, o);
  return v;
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
