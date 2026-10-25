#!/usr/bin/env node
// A tshark for the demo (pnpm demo): asked to listen (-i), it makes up a house at work instead of capturing (a
// laptop streaming a series, music, a build pulling packages, a video call; on docker0, a few containers at work), and
// prints each made-up frame's fields
// as the real one does (-T fields, server/tally.ts's list), as they "arrive". The other devices are heard as a PC on
// a switched network hears them: by what they announce to everyone (DHCP, mDNS, NetBIOS, ARP). Every name, address
// and MAC is invented. Asked anything else (-r, a file), it is the real tshark.
//
// It touches no network and writes no packets: the ring buffer folder it is given gets the test fixture, so saving a
// capture works too.

import { spawn } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { FIELDS, SEP } from '../server/tally.ts';

type Frame = Partial<Record<(typeof FIELDS)[number], string | string[]>>;

const ROUTER = { mac: '50:c7:bf:12:34:56', vendor: 'TP-LINK TECHNOLOGIES CO.,LTD.', ip: '192.168.50.1' };
const ME = { mac: '3c:a9:f4:10:20:30', vendor: 'Intel Corporate', ip: '192.168.50.10', ip6: '2001:db8:50:1::10' };
/** The others, heard by what they announce. */
const HOUSE = [
  { mac: '3c:22:fb:ab:cd:ef', vendor: 'Apple, Inc.', ip: '192.168.50.23', dhcp: 'Alexs-iPhone' },
  { mac: 'f4:f5:d8:c0:ff:ee', vendor: 'Google, Inc.', ip: '192.168.50.31', mdns: { fn: 'Living Room TV', md: 'Chromecast' } },
  { mac: '00:04:3c:11:22:33', vendor: 'SONOS Co., Ltd.', ip: '192.168.50.32', mdns: { fn: 'Kitchen Speaker', md: 'Sonos One' } },
  { mac: '00:01:e6:ab:cd:01', vendor: 'Hewlett Packard', ip: '192.168.50.60', mdns: { fn: 'Office Printer', md: 'LaserJet' } },
  { mac: '00:1b:21:aa:bb:cc', vendor: 'Intel Corporate', ip: '192.168.50.50', netbios: 'DESKTOP-OFFICE' },
  { mac: 'b8:27:eb:44:55:66', vendor: 'Raspberry Pi Foundation', ip: '192.168.50.40', mdns: { host: 'raspberrypi' } },
  { mac: '9a:11:22:33:44:55', ip: '192.168.50.77' },
  { mac: '00:00:f0:65:43:21', vendor: 'Samsung Electronics Co.,Ltd', ip: '192.168.50.45', dhcp: 'Galaxy-Tab-S9' },
];
/** What this PC talks to, and how: a stream, music, a build, a call, and the small talk of an open browser. */
const REMOTES = [
  { name: 'ipv6-c001-xyz001-ix.1.oca.nflxvideo.net', ip: '2001:db8:2042::162', bulk: [2_600_000, 0.35] },
  { name: 'audio-ak-spotify-com.akamaized.net', ip: '203.0.113.17', bulk: [60_000, 0.25] },
  { name: 'registry.npmjs.org', ip: '198.51.100.35', bulk: [900_000, 0.12] },
  { name: 'meet.google.com', ip: '203.0.113.110', bulk: [180_000, 0.9], udp: 3478 },
  { name: 'api.anthropic.com', ip: '198.51.100.10', bulk: [24_000, 0.5] },
  { name: 'github.com', ip: '198.51.100.4', bulk: [40_000, 0.2] },
  { name: 'www.google.com', ip: '203.0.113.14', bulk: [6_000, 0.3] },
  { name: 'fonts.gstatic.com', ip: '203.0.113.3', bulk: [3_000, 0.15] },
  { name: 'www.icloud.com', ip: '203.0.113.68', bulk: [2_000, 0.15] },
  { name: 'outlook.office.com', ip: '203.0.113.162', bulk: [9_000, 0.35] },
  { name: 'www.theguardian.com', ip: '198.51.100.42', bulk: [12_000, 0.2] },
  { name: 'cdn.jsdelivr.net', ip: '198.51.100.229', bulk: [5_000, 0.2] },
] as const;
/** On docker0: this PC's bridge, and containers: a web app with its database and cache, pulling packages now and then. */
const BRIDGE = { mac: '02:42:5a:11:22:33', ip: '172.30.0.1' };
const CONTAINERS = [
  { mac: '02:42:ac:1e:00:02', ip: '172.30.0.2', port: 3000 },
  { mac: '02:42:ac:1e:00:03', ip: '172.30.0.3', port: 5432 },
  { mac: '02:42:ac:1e:00:04', ip: '172.30.0.4', port: 6379 },
];

function line(f: Frame): string {
  return FIELDS.map((k) => {
    const v = f[k];
    return Array.isArray(v) ? v.join(SEP) : (v ?? '');
  }).join('\t');
}

const tcp = (src: number, dst: number): Frame => ({ 'tcp.srcport': String(src), 'tcp.dstport': String(dst), 'ip.proto': '6' });
const udp = (src: number, dst: number): Frame => ({ 'udp.srcport': String(src), 'udp.dstport': String(dst), 'ip.proto': '17' });

function play(iface: string) {
  if (iface === 'docker0') return containers(iface);
  const out = (f: Frame) => process.stdout.write(`${line({ 'frame.time_epoch': String(Date.now() / 1000), 'frame.interface_name': iface, ...f })}\n`);
  const fromRouter = { 'eth.src': ROUTER.mac, 'eth.dst': ME.mac, 'eth.src.oui_resolved': ROUTER.vendor, 'eth.dst.oui_resolved': ME.vendor };
  const toRouter = { 'eth.src': ME.mac, 'eth.dst': ROUTER.mac, 'eth.src.oui_resolved': ME.vendor, 'eth.dst.oui_resolved': ROUTER.vendor };
  const v6 = (ip: string) => ip.includes(':');
  const ipPair = (src: string, dst: string): Frame =>
    v6(src) || v6(dst) ? { 'ipv6.src': v6(src) ? src : ME.ip6, 'ipv6.dst': v6(dst) ? dst : ME.ip6 } : { 'ip.src': src, 'ip.dst': dst };

  // The names first: what DNS said of each host, as the PC asked.
  for (const r of REMOTES) {
    out({ ...toRouter, 'frame.len': '78', 'ip.src': ME.ip, 'ip.dst': ROUTER.ip, ...udp(53000, 53), 'dns.flags.response': '0', 'dns.qry.name': r.name });
    out({
      ...fromRouter,
      'frame.len': '110',
      'ip.src': ROUTER.ip,
      'ip.dst': ME.ip,
      ...udp(53, 53000),
      'dns.flags.response': '1',
      'dns.qry.name': r.name,
      [v6(r.ip) ? 'dns.aaaa' : 'dns.a']: r.ip,
    });
  }
  const announce = () => {
    for (const d of HOUSE) {
      const eth = { 'eth.src': d.mac, 'eth.dst': 'ff:ff:ff:ff:ff:ff', 'eth.src.oui_resolved': d.vendor ?? '' };
      out({ ...eth, 'frame.len': '60', 'arp.src.hw_mac': d.mac, 'arp.src.proto_ipv4': d.ip });
      if (d.dhcp) out({ ...eth, 'frame.len': '342', 'dhcp.hw.mac_addr': d.mac, 'dhcp.option.hostname': d.dhcp, 'dhcp.option.requested_ip_address': d.ip });
      if (d.netbios) out({ ...eth, 'frame.len': '110', 'ip.src': d.ip, 'ip.dst': '192.168.50.255', ...udp(137, 137), 'nbns.name': `${d.netbios}<00>` });
      if (d.mdns) {
        const host = 'host' in d.mdns ? d.mdns.host : 'c0ffee00-0000-4000-8000-00000000ca57';
        out({
          'eth.src': d.mac,
          'eth.dst': '01:00:5e:00:00:fb',
          'eth.src.oui_resolved': d.vendor ?? '',
          'frame.len': '420',
          'ip.src': d.ip,
          'ip.dst': '224.0.0.251',
          ...udp(5353, 5353),
          'dns.flags.response': '1',
          'dns.resp.name': [`${host}.local`],
          'dns.resp.type': ['1'],
          'dns.txt': 'fn' in d.mdns ? [`fn=${d.mdns.fn}`, `md=${d.mdns.md}`] : [],
        });
      }
    }
  };
  announce();
  setInterval(announce, 30_000);

  // Then the traffic, a tenth of a second at a time: each host's share rises and falls on its own slow wave, with
  // bursts, as a stream buffers and a build downloads.
  const started = Date.now();
  const opened = new Set<string>();
  setInterval(() => {
    const t = (Date.now() - started) / 1000;
    REMOTES.forEach((r, k) => {
      const [peak, duty] = r.bulk;
      const wave = 0.5 + 0.5 * Math.sin(t / (9 + k * 3) + k);
      const on = (Math.sin(t / (4 + k) + k * 1.7) + 1) / 2 < duty || wave > 0.92;
      let bytes = (on ? peak * (0.4 + 0.6 * Math.random()) * wave : peak * 0.02 * Math.random()) / 10;
      const port = 'udp' in r ? r.udp : 443;
      const ports = (out: boolean) => ('udp' in r ? (out ? udp(50000 + k, port) : udp(port, 50000 + k)) : out ? tcp(50000 + k, port) : tcp(port, 50000 + k));
      if (!opened.has(r.ip)) {
        // Its encrypted connection opens: the name it asked for (SNI) is said in the clear.
        opened.add(r.ip);
        out({ ...toRouter, 'frame.len': '583', ...ipPair(ME.ip, r.ip), ...ports(true), 'tls.handshake.extensions_server_name': r.name });
      }
      while (bytes > 0) {
        const len = Math.min(1514, Math.max(66, Math.round(bytes)));
        out({ ...fromRouter, 'frame.len': String(len), ...ipPair(r.ip, ME.ip), ...ports(false) });
        if (Math.random() < 0.25) out({ ...toRouter, 'frame.len': '66', ...ipPair(ME.ip, r.ip), ...ports(true) });
        bytes -= len;
      }
    });
  }, 100);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

/** docker0: the containers say where they are (ARP), the app asks its database and cache, and the PC asks the app. */
function containers(iface: string) {
  const out = (f: Frame) => process.stdout.write(`${line({ 'frame.time_epoch': String(Date.now() / 1000), 'frame.interface_name': iface, ...f })}\n`);
  const eth = (src: { mac: string }, dst: { mac: string }): Frame => ({ 'eth.src': src.mac, 'eth.dst': dst.mac });
  const announce = () => {
    for (const c of CONTAINERS) out({ 'eth.src': c.mac, 'eth.dst': 'ff:ff:ff:ff:ff:ff', 'frame.len': '42', 'arp.src.hw_mac': c.mac, 'arp.src.proto_ipv4': c.ip });
  };
  announce();
  setInterval(announce, 30_000);
  const [app, db, cache] = CONTAINERS as [(typeof CONTAINERS)[number], (typeof CONTAINERS)[number], (typeof CONTAINERS)[number]];
  const npm = REMOTES[2];
  const started = Date.now();
  setInterval(() => {
    const t = (Date.now() - started) / 1000;
    const busy = 0.5 + 0.5 * Math.sin(t / 7);
    const talk = (a: typeof app | typeof BRIDGE, b: typeof app, ask: number, answer: number, from: number) => {
      out({ ...eth(a, b), 'frame.len': String(ask), 'ip.src': a.ip, 'ip.dst': b.ip, ...tcp(from, b.port) });
      out({ ...eth(b, a), 'frame.len': String(answer), 'ip.src': b.ip, 'ip.dst': a.ip, ...tcp(b.port, from) });
    };
    if (Math.random() < 0.6 * busy) talk(BRIDGE, app, 420, 1514, 41000);
    if (Math.random() < 0.8 * busy) talk(app, db, 180, 900, 42000);
    if (Math.random() < 0.9 * busy) talk(app, cache, 90, 160, 43000);
    // Now and then the app pulls a package, through the bridge (this PC is its way out).
    if (Math.sin(t / 23) > 0.85)
      for (let k = 0; k < 6; k++) {
        out({ ...eth(BRIDGE, app), 'frame.len': '1514', 'ip.src': npm.ip, 'ip.dst': app.ip, ...tcp(443, 44000) });
        if (k % 3 === 0) out({ ...eth(app, BRIDGE), 'frame.len': '66', 'ip.src': app.ip, 'ip.dst': npm.ip, ...tcp(44000, 443) });
      }
  }, 100);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

const args = process.argv.slice(2);
const listen = args[args.indexOf('-i') + 1];
if (!args.includes('-i') || !listen) {
  const real = spawn(process.env.ARGUS_REAL_TSHARK ?? 'tshark', args, { stdio: 'inherit' });
  real.on('close', (code) => process.exit(code ?? 1));
} else {
  const ring = args[args.indexOf('-w') + 1];
  if (ring) copyFileSync(path.resolve(import.meta.dirname, '../tests/fixtures/lan.pcap'), ring.replace(/\.pcapng$/, '_00001_20260101000000.pcapng'));
  process.stderr.write(`Capturing on '${listen}'\n`);
  play(listen);
}
