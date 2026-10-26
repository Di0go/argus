// What the page says of privacy and safety, from what a source holds (the live session, a capture), for the whole
// network or one device: conversations in the clear (and which of them are harmless by design), servers that agreed
// old TLS, how each device looks up names, the share that went to advertising, tracking and telemetry, and where the
// data went (the country each host's network is registered in). Facts only: no score, no alert.

import { isOldTls } from '../../../shared/security.ts';
import type { Conversation, Device, Remote } from '../../../shared/types.ts';
import type { Source } from './argus.svelte.ts';

export interface ClearLine {
  c: Conversation;
  device?: Device;
  /** The other end's name. */
  other: string;
  otherKey: string;
  /** Between two devices here, not out to the internet. */
  local: boolean;
  /** The device, the other end's name and the protocol: one line each. */
  key: string;
}

export interface Privacy {
  /** In the clear, out to the internet or with a login: what the colour is for, newest first. */
  clear: ClearLine[];
  /** In the clear but inside the house, without a login: said, not coloured. */
  local: ClearLine[];
  /** In the clear by design and harmless (connectivity checks, certificate lists). */
  harmless: ClearLine[];
  oldTls: ClearLine[];
  /** Devices that ask another resolver in the clear, or ask encrypted. */
  dns: { device: Device; kind: 'other' | 'encrypted'; names: string[] }[];
  /** How many devices ask the house's resolver. */
  dnsHouse: number;
  tracking: { company: string; bytes: number; devices: Device[] }[];
  trackingBytes: number;
  bytes: number;
  where: { country: string; cc: string; bytes: number }[];
  /** Bytes whose host's country is known. */
  whereBytes: number;
}

/** `device`: one device's (its entity key); `since`: only conversations heard since then (epoch seconds). */
export function privacy(src: Source, o: { device?: string; since?: number } = {}): Privacy {
  const devices = new Map(src.devices.map((d) => [`device:${d.id}`, d]));
  const remotes = new Map(src.remotes.map((r) => [`remote:${r.id}`, r]));
  const mine = src.conversations.filter((c) => (!o.device || c.a === o.device || c.b === o.device) && (!o.since || c.last >= o.since));
  const line = (c: Conversation): ClearLine => {
    const other = remotes.get(c.b) ?? devices.get(c.b);
    const name = other?.name ?? c.b.replace(/^\w+:/, '');
    return { c, device: devices.get(c.a), other: name, otherKey: c.b, local: c.b.startsWith('device:'), key: `${c.a}\t${name}\t${c.clear?.proto ?? c.tls ?? ''}` };
  };
  const out: Privacy = { clear: [], local: [], harmless: [], oldTls: [], dns: [], dnsHouse: 0, tracking: [], trackingBytes: 0, bytes: 0, where: [], whereBytes: 0 };
  const tracking = new Map<string, { company: string; bytes: number; devices: Set<Device> }>();
  const where = new Map<string, { country: string; cc: string; bytes: number }>();
  for (const c of mine) {
    const bytes = c.sent + c.received;
    out.bytes += bytes;
    if (c.clear) {
      const l = line(c);
      if (c.clear.harmless) out.harmless.push(l);
      else if (l.local && !c.clear.credentials) out.local.push(l);
      else out.clear.push(l);
    }
    if (c.tls && isOldTls(c.tls)) out.oldTls.push(line(c));
    if (c.app?.tracking) {
      const company = c.app.company ?? c.app.app ?? c.app.site ?? 'Unknown';
      const t = tracking.get(company) ?? { company, bytes: 0, devices: new Set() };
      t.bytes += bytes;
      const d = devices.get(c.a);
      if (d) t.devices.add(d);
      tracking.set(company, t);
      out.trackingBytes += bytes;
    }
    const r: Remote | undefined = remotes.get(c.b);
    if (r?.where?.cc) {
      const w = where.get(r.where.cc) ?? { country: r.where.country ?? r.where.cc, cc: r.where.cc, bytes: 0 };
      w.bytes += bytes;
      where.set(r.where.cc, w);
      out.whereBytes += bytes;
    }
  }
  const newest = (a: ClearLine, b: ClearLine) => Number(Boolean(b.c.clear?.credentials)) - Number(Boolean(a.c.clear?.credentials)) || b.c.last - a.c.last;
  // One host is one line per device: the same name on another address (IPv4 and IPv6, a CDN's several) or connection
  // is the same story; the line kept is the one with a login, else the newest.
  const once = (ls: ClearLine[]) => {
    const seen = new Set<string>();
    return ls.sort(newest).filter((l) => !seen.has(l.key) && Boolean(seen.add(l.key)));
  };
  out.clear = once(out.clear);
  out.local = once(out.local);
  out.harmless = once(out.harmless);
  out.oldTls = once(out.oldTls);
  out.tracking = [...tracking.values()].sort((a, b) => b.bytes - a.bytes).map((t) => ({ ...t, devices: [...t.devices] }));
  out.where = [...where.values()].sort((a, b) => b.bytes - a.bytes);
  for (const d of o.device ? [devices.get(o.device)].filter((x): x is Device => Boolean(x)) : src.devices) {
    const uses = d.dns ?? [];
    if (uses.some((u) => u.kind === 'house')) out.dnsHouse++;
    for (const kind of ['other', 'encrypted'] as const) {
      const these = uses.filter((u) => u.kind === kind);
      if (these.length) out.dns.push({ device: d, kind, names: [...new Set(these.map((u) => u.name ?? u.server))] });
    }
  }
  return out;
}
