// How many of the hosts out on the internet Argus calls by a name a person reads, and how many it leaves as an address
// or a network's name: `node scripts/nomes.ts <session.json | capture> [--top 40] [--json]`. It reads a live session
// as the server keeps it (data/live/session.json, never committed), or a capture, with the same tally and reading as the server.
//
// Readable: what the dictionary says names it (an app or a company that is not only a carrier), or a site's name was
// seen. Not readable: nothing said, or only the carrier (AWS, Akamai) or the port, with no name.

import { readFileSync } from 'node:fs';
import { interpret } from '../server/interpret.ts';
import { Tally } from '../server/tally.ts';
import { dissect } from '../server/dissect.ts';
import { ownMacs } from '../server/capture.ts';
import { Geo, geoFile } from '../server/geo.ts';
import { siteOf } from '../server/dictionary.ts';
import type { Remote } from '../shared/types.ts';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && args[i - 1] !== '--top' && args[i - 1] !== '--since');
if (!file) {
  console.error('node scripts/nomes.ts <session.json | capture> [--top 40] [--since <epoch>] [--json]');
  process.exit(2);
}
const top = Number(args[args.indexOf('--top') + 1]) || 40;
// --since <epoch seconds>: only the hosts first seen after it (what came after the rules were written).
const since = args.includes('--since') ? Number(args[args.indexOf('--since') + 1]) : 0;
const geo = Geo.load(geoFile(process.env));
// A capture (.pcap, .pcapng) is read as a saved one is; anything else is a session as the server keeps it.
const facts = /\.pcap(ng)?$/.test(file) ? await dissect(file, { tshark: process.env.TSHARK ?? 'tshark', ownMacs: ownMacs() }) : Tally.load(JSON.parse(readFileSync(file, 'utf8'))).view();
const v = interpret(facts, { geo });

const devices = new Map<string, Set<string>>();
for (const c of v.conversations) if (c.b.startsWith('remote:')) (devices.get(c.b.slice(7)) ?? devices.set(c.b.slice(7), new Set()).get(c.b.slice(7))!).add(c.a);

const readable = (h: Remote) => Boolean((h.app && !h.app.carrier && (h.app.app || h.app.company)) || h.names.some((n) => siteOf(n.name)));
const rows = v.remotes.filter((h) => h.firstSeen >= since).map((h) => ({
  ip: h.ip,
  bytes: h.bytesSent + h.bytesReceived,
  devices: devices.get(h.id)?.size ?? 0,
  readable: readable(h),
  said: h.app ? `${h.app.company ?? ''}${h.app.carrier ? ' (carrier)' : ''} · ${h.app.app ?? ''} · ${h.app.activity} [${h.app.by} ${h.app.rule}]` : '',
  names: h.names.map((n) => `${n.name}(${n.source})`).slice(0, 3).join(' '),
  net: h.where ? `AS${h.where.asn} ${h.where.org} ${h.where.cc}` : '',
}));
const all = rows.reduce((a, r) => a + r.bytes, 0);
const not = rows.filter((r) => !r.readable);
const notBytes = not.reduce((a, r) => a + r.bytes, 0);
const pct = (a: number, b: number) => `${((100 * a) / (b || 1)).toFixed(1)} %`;
if (args.includes('--json')) {
  console.log(JSON.stringify({ hosts: rows.length, unreadable: not.length, bytes: all, unreadableBytes: notBytes, rows: not.sort((a, b) => b.bytes - a.bytes) }, null, 1));
} else {
  console.log(`Hosts on the internet: ${rows.length}; without a readable name: ${not.length} (${pct(not.length, rows.length)})`);
  console.log(`Bytes: ${(all / 1e6).toFixed(1)} MB; to hosts without a readable name: ${(notBytes / 1e6).toFixed(1)} MB (${pct(notBytes, all)})`);
  for (const r of not.sort((a, b) => b.bytes - a.bytes).slice(0, top)) console.log(`${(r.bytes / 1e6).toFixed(2).padStart(9)} MB  ${String(r.devices).padStart(2)} dev  ${r.ip.padEnd(28)} ${r.net} | ${r.said} | ${r.names}`);
}
