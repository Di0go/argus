#!/usr/bin/env node
// A tshark for the demo (pnpm demo): asked to listen (-i), it makes up a house at work instead of capturing, and
// prints each made-up frame's fields as the real one does (-T fields, server/tally.ts's list), as they "arrive". On the
// Wi-Fi it is at a café first (ARGUS_DEMO_CAFE seconds, 15; 0 for none: its own router, the same addresses as many a
// network, a till paying, a guest's phone, a speaker), then this PC goes home and joins the house's Wi-Fi as a laptop
// does (DHCP from nothing); each Wi-Fi's name is written to ARGUS_DEMO_SSID_FILE for the demo's iw (scripts/demo-iw.ts). It
// hears the house as a sensor on the router would (a mirror port): the TV on Netflix, a phone on Instagram and then
// on a WhatsApp call, a tablet on YouTube asking Google's DNS directly, the office PC updating Windows, a speaker on
// Spotify, a printer posting scans over plain HTTP with a password, and this PC on a call and a build; on docker0, a
// few containers at work. The devices also say what they are (DHCP, mDNS, User-Agent). Every name, address, MAC and
// password is invented. Asked anything else (-r, a file), it is the real tshark.
//
// It touches no network and writes no packets: the ring buffer folder it is given gets the test fixture, so saving a
// capture works too.

import { spawn } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FIELDS, SEP } from '../server/tally.ts';

type Frame = Partial<Record<(typeof FIELDS)[number], string | string[]>>;

const ROUTER = { mac: '50:c7:bf:12:34:56', vendor: 'TP-LINK TECHNOLOGIES CO.,LTD.', ip: '192.168.50.1' };
const ME = { mac: '3c:a9:f4:10:20:30', vendor: 'Intel Corporate', ip: '192.168.50.10', ip6: '2001:db8:50:1::10' };
/** The others, heard by what they announce. */
type Home = { mac: string; vendor?: string; ip: string; dhcp?: string; vendorClass?: string; netbios?: string; mdns?: { fn?: string; md?: string; host?: string; service?: string }; ua?: string };
const HOUSE: Home[] = [
  { mac: '3c:22:fb:ab:cd:ef', vendor: 'Apple, Inc.', ip: '192.168.50.23', dhcp: 'Alexs-iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
  { mac: 'f4:f5:d8:c0:ff:ee', vendor: 'Google, Inc.', ip: '192.168.50.31', mdns: { fn: 'Living Room TV', md: 'Chromecast', service: '_googlecast._tcp' } },
  { mac: '00:04:3c:11:22:33', vendor: 'SONOS Co., Ltd.', ip: '192.168.50.32', mdns: { fn: 'Kitchen Speaker', md: 'Sonos One', service: '_sonos._tcp' } },
  { mac: '00:01:e6:ab:cd:01', vendor: 'Hewlett Packard', ip: '192.168.50.60', mdns: { fn: 'Office Printer', md: 'LaserJet', service: '_ipp._tcp' } },
  { mac: '00:1b:21:aa:bb:cc', vendor: 'Intel Corporate', ip: '192.168.50.50', netbios: 'DESKTOP-OFFICE', vendorClass: 'MSFT 5.0', dhcp: 'DESKTOP-OFFICE' },
  { mac: 'b8:27:eb:44:55:66', vendor: 'Raspberry Pi Foundation', ip: '192.168.50.40', mdns: { host: 'raspberrypi', service: '_workstation._tcp' } },
  { mac: '9a:11:22:33:44:55', ip: '192.168.50.77' },
  { mac: '00:00:f0:65:43:21', vendor: 'Samsung Electronics Co.,Ltd', ip: '192.168.50.45', dhcp: 'Galaxy-Tab-S9', vendorClass: 'android-dhcp-14' },
];
const [PHONE, TV, SPEAKER, PRINTER, OFFICE, , , TABLET] = HOUSE as [Home, Home, Home, Home, Home, Home, Home, Home];
/**
 * Who talks to what, and how: `by` is the device (this PC when not said), `bulk` the peak bytes a second and the
 * share of the time it is on, `udp` a port for a call, `http` plain HTTP (with a login, `auth`), `every` seconds
 * between short visits.
 */
type Talk = { name: string; ip: string; bulk: readonly [number, number]; by?: Home; udp?: number; http?: boolean; auth?: boolean; dns?: string };
const REMOTES: readonly Talk[] = [
  { name: 'ipv6-c001-xyz001-ix.1.oca.nflxvideo.net', ip: '198.51.100.162', bulk: [2_600_000, 0.75], by: TV },
  { name: 'audio-ak-spotify-com.akamaized.net', ip: '203.0.113.17', bulk: [60_000, 0.8], by: SPEAKER },
  { name: 'registry.npmjs.org', ip: '198.51.100.35', bulk: [900_000, 0.12] },
  { name: 'scontent-lis1-1.cdninstagram.com', ip: '203.0.113.120', bulk: [400_000, 0.45], by: PHONE },
  { name: 'graph.instagram.com', ip: '203.0.113.121', bulk: [6_000, 0.3], by: PHONE },
  { name: 'e7.whatsapp.net', ip: '203.0.113.122', bulk: [40_000, 0.95], by: PHONE, udp: 3478 },
  { name: 'rr2---sn-aigl6nzr.googlevideo.com', ip: '203.0.113.130', bulk: [700_000, 0.6], by: TABLET, dns: '8.8.8.8' },
  { name: 'app-measurement.com', ip: '203.0.113.131', bulk: [8_000, 0.4], by: TABLET, dns: '8.8.8.8' },
  { name: 'dl.delivery.mp.microsoft.com', ip: '203.0.113.140', bulk: [1_800_000, 0.2], by: OFFICE },
  { name: 'ctldl.windowsupdate.com', ip: '203.0.113.141', bulk: [3_000, 0.1], by: OFFICE, http: true },
  { name: 'scan.printhub.example', ip: '198.51.100.77', bulk: [20_000, 0.08], by: PRINTER, http: true, auth: true },
  { name: 'meet.google.com', ip: '203.0.113.110', bulk: [180_000, 0.9], udp: 3478 },
  { name: 'api.anthropic.com', ip: '198.51.100.10', bulk: [24_000, 0.5] },
  { name: 'github.com', ip: '198.51.100.4', bulk: [40_000, 0.2] },
  { name: 'www.google.com', ip: '2001:db8:4860::2004', bulk: [6_000, 0.3] },
  { name: 'fonts.gstatic.com', ip: '203.0.113.3', bulk: [3_000, 0.15] },
  { name: 'www.icloud.com', ip: '203.0.113.68', bulk: [2_000, 0.15] },
  { name: 'outlook.office.com', ip: '203.0.113.162', bulk: [9_000, 0.35] },
  { name: 'www.theguardian.com', ip: '198.51.100.42', bulk: [12_000, 0.2] },
  { name: 'cdn.jsdelivr.net', ip: '198.51.100.229', bulk: [5_000, 0.2] },
];
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

/**
 * The café: its router (another maker) hands out the house's own addresses, as so many do (the router at .1, a phone
 * at the TV's .31, a speaker at the Pi's .40): only the routers tell the two networks apart. And who is there.
 */
const CAFE = { mac: 'f0:9f:c2:5e:a1:01', vendor: 'Ubiquiti Inc', ip: '192.168.50.1', me: '192.168.50.57', ssid: 'Harbour Café' };
const AT_CAFE: (Home & { to: string; bulk: number; udp?: boolean })[] = [
  { mac: '00:1b:21:5e:a1:20', vendor: 'Intel Corporate', ip: '192.168.50.20', netbios: 'CAFE-TILL', to: '203.0.113.52', bulk: 4_000 },
  { mac: 'da:7e:11:5e:a1:31', ip: '192.168.50.31', dhcp: 'Pixel-8', vendorClass: 'android-dhcp-14', to: '203.0.113.120', bulk: 300_000 },
  { mac: '00:04:3c:5e:a1:40', vendor: 'SONOS Co., Ltd.', ip: '192.168.50.40', mdns: { fn: 'Café Speaker', md: 'Sonos Era 100', service: '_sonos._tcp' }, to: '203.0.113.17', bulk: 50_000 },
];
const CAFE_FOR = Number(process.env.ARGUS_DEMO_CAFE ?? 15);
const HOME_SSID = 'Willow House';
const ssid = (name: string) => {
  if (process.env.ARGUS_DEMO_SSID_FILE) writeFileSync(process.env.ARGUS_DEMO_SSID_FILE, name);
};

function play(iface: string) {
  if (iface === 'docker0') return containers(iface);
  if (CAFE_FOR > 0) return cafe(iface, () => house(iface));
  ssid(HOME_SSID);
  house(iface);
}

/** This PC at the café for CAFE_FOR seconds: the till, a guest's phone and a speaker; this PC on GitHub and Claude. */
function cafe(iface: string, then: () => void) {
  ssid(CAFE.ssid);
  const out = (f: Frame) => process.stdout.write(`${line({ 'frame.time_epoch': String(Date.now() / 1000), 'frame.interface_name': iface, ...f })}\n`);
  const eth = (src: { mac: string; vendor?: string }, dst: { mac: string; vendor?: string }): Frame => ({
    'eth.src': src.mac,
    'eth.dst': dst.mac,
    'eth.src.oui_resolved': src.vendor ?? '',
    'eth.dst.oui_resolved': dst.vendor ?? '',
  });
  const me = { mac: ME.mac, vendor: ME.vendor };
  out({ ...eth(me, { mac: 'ff:ff:ff:ff:ff:ff' }), 'frame.len': '342', 'ip.src': '0.0.0.0', 'ip.dst': '255.255.255.255', ...udp(68, 67), 'dhcp.hw.mac_addr': ME.mac });
  out({ ...eth(CAFE, me), 'frame.len': '342', 'ip.src': CAFE.ip, 'ip.dst': CAFE.me, ...udp(67, 68), 'dhcp.hw.mac_addr': ME.mac, 'dhcp.ip.your': CAFE.me });
  for (const d of AT_CAFE) {
    const b = { ...eth(d, { mac: 'ff:ff:ff:ff:ff:ff' }), 'frame.len': '110' };
    out({ ...b, 'arp.src.hw_mac': d.mac, 'arp.src.proto_ipv4': d.ip });
    if (d.netbios) out({ ...b, 'ip.src': d.ip, 'ip.dst': '192.168.50.255', ...udp(137, 137), 'nbns.name': `${d.netbios}<00>` });
    if (d.dhcp) out({ ...b, 'frame.len': '342', 'dhcp.hw.mac_addr': d.mac, 'dhcp.option.hostname': d.dhcp, 'dhcp.option.requested_ip_address': d.ip, 'dhcp.option.vendor_class_id': d.vendorClass ?? '' });
    if (d.mdns)
      out({ ...eth(d, { mac: '01:00:5e:00:00:fb' }), 'frame.len': '420', 'ip.src': d.ip, 'ip.dst': '224.0.0.251', ...udp(5353, 5353), 'dns.flags.response': '1', 'dns.resp.name': [`${d.mdns.service}.local`], 'dns.resp.type': ['12'], 'dns.txt': [`fn=${d.mdns.fn}`, `md=${d.mdns.md}`] });
  }
  // This PC's own: GitHub and Claude, named as TLS says them.
  const mine = [REMOTES[13]!, REMOTES[12]!];
  for (const r of mine) {
    out({ ...eth(me, CAFE), 'frame.len': '583', 'ip.src': CAFE.me, 'ip.dst': r.ip, ...tcp(50100, 443), 'frame.protocols': 'eth:ethertype:ip:tcp:tls', 'tls.handshake.extensions_server_name': r.name, 'tls.handshake.type': '1' });
  }
  const tick = setInterval(() => {
    for (const r of mine) {
      out({ ...eth(CAFE, me), 'frame.len': String(800 + Math.round(Math.random() * 700)), 'ip.src': r.ip, 'ip.dst': CAFE.me, ...tcp(443, 50100) });
      out({ ...eth(me, CAFE), 'frame.len': '66', 'ip.src': CAFE.me, 'ip.dst': r.ip, ...tcp(50100, 443) });
    }
    for (const d of AT_CAFE) {
      out({ ...eth(CAFE, d), 'frame.len': String(Math.min(1514, Math.round((d.bulk / 10) * Math.random()) + 66)), 'ip.src': d.to, 'ip.dst': d.ip, ...tcp(443, 51000) });
      out({ ...eth(d, CAFE), 'frame.len': '66', 'ip.src': d.ip, 'ip.dst': d.to, ...tcp(51000, 443) });
    }
  }, 100);
  setTimeout(() => {
    clearInterval(tick);
    // Home: the house's Wi-Fi, joined as a laptop does, asking DHCP for an address from nothing.
    ssid(HOME_SSID);
    out({ ...eth(me, { mac: 'ff:ff:ff:ff:ff:ff' }), 'frame.len': '342', 'ip.src': '0.0.0.0', 'ip.dst': '255.255.255.255', ...udp(68, 67), 'dhcp.hw.mac_addr': ME.mac });
    out({ ...eth(ROUTER, me), 'frame.len': '342', 'ip.src': ROUTER.ip, 'ip.dst': ME.ip, ...udp(67, 68), 'dhcp.hw.mac_addr': ME.mac, 'dhcp.ip.your': ME.ip });
    then();
  }, CAFE_FOR * 1000);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

/** The house, on its Wi-Fi. */
function house(iface: string) {
  const out = (f: Frame) => process.stdout.write(`${line({ 'frame.time_epoch': String(Date.now() / 1000), 'frame.interface_name': iface, ...f })}\n`);
  const who = (r: Talk) => r.by ?? { ...ME, vendor: ME.vendor };
  const fromRouter = (d: Home) => ({ 'eth.src': ROUTER.mac, 'eth.dst': d.mac, 'eth.src.oui_resolved': ROUTER.vendor, 'eth.dst.oui_resolved': d.vendor ?? '' });
  const toRouter = (d: Home) => ({ 'eth.src': d.mac, 'eth.dst': ROUTER.mac, 'eth.src.oui_resolved': d.vendor ?? '', 'eth.dst.oui_resolved': ROUTER.vendor });
  const v6 = (ip: string) => ip.includes(':');
  const ipPair = (src: string, dst: string): Frame =>
    v6(src) || v6(dst) ? { 'ipv6.src': v6(src) ? src : ME.ip6, 'ipv6.dst': v6(dst) ? dst : ME.ip6 } : { 'ip.src': src, 'ip.dst': dst };

  // The names first: what DNS said of each host, as each device asked (the tablet asks Google's DNS directly).
  for (const r of REMOTES) {
    const d = who(r);
    const server = r.dns ?? ROUTER.ip;
    out({ ...toRouter(d), 'frame.len': '78', 'ip.src': d.ip, 'ip.dst': server, ...udp(53000, 53), 'dns.flags.response': '0', 'dns.qry.name': r.name });
    out({
      ...fromRouter(d),
      'frame.len': '110',
      'ip.src': server,
      'ip.dst': d.ip,
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
      if (d.dhcp)
        out({
          ...eth,
          'frame.len': '342',
          'dhcp.hw.mac_addr': d.mac,
          'dhcp.option.hostname': d.dhcp,
          'dhcp.option.requested_ip_address': d.ip,
          ...(d.vendorClass ? { 'dhcp.option.vendor_class_id': d.vendorClass } : {}),
        });
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
          'dns.resp.name': [`${host}.local`, ...(d.mdns.service ? [`${d.mdns.service}.local`] : [])],
          'dns.resp.type': ['1', ...(d.mdns.service ? ['12'] : [])],
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
      const d = who(r);
      const port = r.udp ?? (r.http ? 80 : 443);
      const ports = (out: boolean) => (r.udp ? (out ? udp(50000 + k, port) : udp(port, 50000 + k)) : out ? tcp(50000 + k, port) : tcp(port, 50000 + k));
      const layers = r.udp ? 'eth:ethertype:ip:udp:stun' : r.http ? 'eth:ethertype:ip:tcp:http' : 'eth:ethertype:ip:tcp:tls';
      if (!opened.has(r.ip)) {
        // Its connection opens: TLS says the name it asked for (SNI) in the clear; plain HTTP says it all.
        opened.add(r.ip);
        const hello: Frame = r.http
          ? { 'http.host': r.name, 'http.user_agent': d.ua ?? (d === OFFICE ? 'Microsoft-CryptoAPI/10.0' : 'HP-ChaiSOE/1.0'), ...(r.auth ? { 'http.authorization': 'Basic ZGVtbzpkZW1v' } : {}) }
          : r.udp
            ? {}
            : { 'tls.handshake.extensions_server_name': r.name, 'tls.handshake.type': '1' };
        out({ ...toRouter(d), 'frame.len': '583', ...ipPair(d.ip, r.ip), ...ports(true), 'frame.protocols': layers, ...hello });
        if (!r.udp && !r.http) out({ ...fromRouter(d), 'frame.len': '1400', ...ipPair(r.ip, d.ip), ...ports(false), 'frame.protocols': layers, 'tls.handshake.type': '2', 'tls.handshake.extensions.supported_version': '0x0304' });
      }
      while (bytes > 0) {
        const len = Math.min(1514, Math.max(66, Math.round(bytes)));
        out({ ...fromRouter(d), 'frame.len': String(len), ...ipPair(r.ip, d.ip), ...ports(false), 'frame.protocols': layers });
        if (Math.random() < 0.25) out({ ...toRouter(d), 'frame.len': '66', ...ipPair(d.ip, r.ip), ...ports(true), 'frame.protocols': layers });
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
