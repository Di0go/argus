// Writes tests/fixtures/lan.pcap: a small home network as a capture on this PC's Wi-Fi would see it, packet by packet,
// so the tests know exactly what is in it (tests/fixtures/lan.truth.json says it). Every packet is built here, by
// hand, from the protocols' own layouts: no capture of anybody's real traffic is committed.
//
//   pnpm fixtures
//
// What is in it:
// - the router (TP-Link OUI) answering DHCP and DNS, and asking ARP;
// - a phone (Apple OUI) asking DHCP for an address with its hostname;
// - a Raspberry Pi answering ARP and announcing itself over mDNS;
// - a Windows PC (Intel OUI) registering its NetBIOS name;
// - this PC talking to a web server out on the internet through the router, after asking DNS for its name;
// - one broadcast from a device that never says its name, from a locally administered (random) MAC.

import { writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../tests/fixtures');

const mac = (s: string) => Buffer.from(s.split(':').map((h) => Number.parseInt(h, 16)));
const ip4 = (s: string) => Buffer.from(s.split('.').map(Number));
const u16 = (n: number) => Buffer.from([n >> 8, n & 255]);
const u32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

const HOSTS = {
  router: { mac: '50:c7:bf:12:34:56', ip: '192.168.50.1' },
  phone: { mac: '3c:22:fb:ab:cd:ef', ip: '192.168.50.23', name: 'Alexs-iPhone' },
  pi: { mac: 'b8:27:eb:44:55:66', ip: '192.168.50.40', name: 'raspberrypi' },
  windows: { mac: '00:1b:21:aa:bb:cc', ip: '192.168.50.50', name: 'DESKTOP-STUDY' },
  me: { mac: '3c:a9:f4:10:20:30', ip: '192.168.50.10' },
  quiet: { mac: '9a:11:22:33:44:55', ip: '192.168.50.77' },
  web: { ip: '203.0.113.14', name: 'www.google.com' },
  cast: {
    mac: 'f4:f5:d8:c0:ff:ee',
    ip: '192.168.50.63',
    name: 'Living Room TV',
    model: 'Chromecast',
    host: 'c0ffee00-0000-4000-8000-00000000ca57.local',
  },
  me6: { ip: '2001:db8:50:1::10' },
  web6: { ip: '2001:db8:ffff:1::200e' },
};
const BROADCAST = 'ff:ff:ff:ff:ff:ff';

function checksum(b: Buffer): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 2) sum += (b[i]! << 8) + (b[i + 1] ?? 0);
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

const ether = (dst: string, src: string, type: number, payload: Buffer) => Buffer.concat([mac(dst), mac(src), u16(type), payload]);

function ipv6(src: string, dst: string, next: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x60, 0, 0, 0]), u16(payload.length), Buffer.from([next, 64]), ip6(src), ip6(dst), payload]);
}

/** An IPv6 address, "::" expanded, as 16 bytes. */
function ip6(s: string): Buffer {
  const [head = '', tail = ''] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = s.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return Buffer.concat(groups.map((g) => u16(Number.parseInt(g, 16))));
}

/** A resource record of any type: name, type, class (cache flush for mDNS), TTL, data. */
const rr = (name: string, type: number, data: Buffer) => Buffer.concat([qname(name), u16(type), u16(0x8001), u32(120), u16(data.length), data]);

/**
 * A Google Cast device's mDNS announcement, as Chromecasts and TV boxes send it: PTR to its instance, TXT with
 * its friendly name (fn) and model (md), SRV to its host, and the host's A record. The host is a UUID, not a name.
 */
function castAnnouncement(c: { ip: string; name: string; model: string; host: string }): Buffer {
  const instance = `${c.model.replace(/\s+/g, '-')}-c0ffee0000004000._googlecast._tcp.local`;
  const txt = Buffer.concat([`id=c0ffee00`, `md=${c.model}`, `fn=${c.name}`].map((t) => Buffer.concat([Buffer.from([t.length]), Buffer.from(t)])));
  const srv = Buffer.concat([u16(0), u16(0), u16(8009), qname(c.host)]);
  return Buffer.concat([
    u16(0),
    u16(0x8400),
    u16(0),
    u16(4),
    u16(0),
    u16(0),
    Buffer.concat([qname('_googlecast._tcp.local'), u16(12), u16(1), u32(120), u16(qname(instance).length), qname(instance)]),
    rr(instance, 16, txt),
    rr(instance, 33, srv),
    rr(c.host, 1, ip4(c.ip)),
  ]);
}

function ipv4(src: string, dst: string, proto: number, payload: Buffer, ttl = 64): Buffer {
  const h = Buffer.concat([
    Buffer.from([0x45, 0]),
    u16(20 + payload.length),
    u16(0x1234),
    u16(0x4000),
    Buffer.from([ttl, proto]),
    u16(0),
    ip4(src),
    ip4(dst),
  ]);
  h.writeUInt16BE(checksum(h), 10);
  return Buffer.concat([h, payload]);
}

const udp = (sport: number, dport: number, payload: Buffer) => Buffer.concat([u16(sport), u16(dport), u16(8 + payload.length), u16(0), payload]);

function tcp(sport: number, dport: number, seq: number, flags: number, payload = Buffer.alloc(0)): Buffer {
  return Buffer.concat([u16(sport), u16(dport), u32(seq), u32(0), Buffer.from([0x50, flags]), u16(64240), u16(0), u16(0), payload]);
}

function arp(op: 1 | 2, sha: string, spa: string, tha: string, tpa: string): Buffer {
  return Buffer.concat([u16(1), u16(0x0800), Buffer.from([6, 4]), u16(op), mac(sha), ip4(spa), mac(tha), ip4(tpa)]);
}

/** A DNS name as labels. */
const qname = (name: string) => Buffer.concat([...name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);

/** `mdns`: answers carry the cache-flush bit in their class, as mDNS announcements do. */
function dns(id: number, flags: number, questions: string[], answers: { name: string; ip: string }[], mdns = false): Buffer {
  return Buffer.concat([
    u16(id),
    u16(flags),
    u16(questions.length),
    u16(answers.length),
    u16(0),
    u16(0),
    ...questions.map((q) => Buffer.concat([qname(q), u16(1), u16(1)])),
    ...answers.map((a) => Buffer.concat([qname(a.name), u16(1), u16(mdns ? 0x8001 : 1), u32(120), u16(4), ip4(a.ip)])),
  ]);
}

function dhcp(op: 1 | 2, type: number, chaddr: string, yiaddr: string, options: Buffer[]): Buffer {
  const fixed = Buffer.alloc(236);
  fixed[0] = op;
  fixed[1] = 1;
  fixed[2] = 6;
  u32(0x3903f326).copy(fixed, 4);
  ip4(yiaddr).copy(fixed, 16);
  mac(chaddr).copy(fixed, 28);
  return Buffer.concat([fixed, Buffer.from([99, 130, 83, 99]), Buffer.from([53, 1, type]), ...options, Buffer.from([255])]);
}
const opt = (code: number, value: Buffer) => Buffer.concat([Buffer.from([code, value.length]), value]);

/** A NetBIOS name, first-level encoded (RFC 1001): padded to 15, a suffix byte, each half-byte as a letter from A. */
function nbName(name: string, suffix = 0): Buffer {
  const raw = Buffer.concat([Buffer.from(name.toUpperCase().padEnd(15, ' ')), Buffer.from([suffix])]);
  const enc = [...raw].flatMap((b) => [65 + (b >> 4), 65 + (b & 15)]);
  return Buffer.concat([Buffer.from([32, ...enc]), Buffer.from([0])]);
}

function nbnsRegistration(name: string, ip: string): Buffer {
  return Buffer.concat([
    u16(0x8001),
    u16(0x2910),
    u16(1),
    u16(0),
    u16(0),
    u16(1),
    nbName(name),
    u16(0x20),
    u16(1),
    Buffer.from([0xc0, 0x0c]),
    u16(0x20),
    u16(1),
    u32(300000),
    u16(6),
    u16(0),
    ip4(ip),
  ]);
}

const { router, phone, pi, windows, me, quiet, web, cast, me6, web6 } = HOSTS;
const packets: Buffer[] = [
  // DHCP: the phone asks, with its name (option 12) and the address it wants (50); the router acks.
  ether(
    BROADCAST,
    phone.mac,
    0x0800,
    ipv4(
      '0.0.0.0',
      '255.255.255.255',
      17,
      udp(68, 67, dhcp(1, 3, phone.mac, '0.0.0.0', [opt(50, ip4(phone.ip)), opt(12, Buffer.from(phone.name)), opt(61, Buffer.concat([Buffer.from([1]), mac(phone.mac)]))])),
    ),
  ),
  ether(
    phone.mac,
    router.mac,
    0x0800,
    ipv4(router.ip, phone.ip, 17, udp(67, 68, dhcp(2, 5, phone.mac, phone.ip, [opt(54, ip4(router.ip)), opt(51, u32(86400)), opt(1, ip4('255.255.255.0'))]))),
  ),
  // ARP: the router asks for the Pi; the Pi answers.
  ether(BROADCAST, router.mac, 0x0806, arp(1, router.mac, router.ip, '00:00:00:00:00:00', pi.ip)),
  ether(router.mac, pi.mac, 0x0806, arp(2, pi.mac, pi.ip, router.mac, router.ip)),
  // mDNS: the Pi announces raspberrypi.local.
  ether('01:00:5e:00:00:fb', pi.mac, 0x0800, ipv4(pi.ip, '224.0.0.251', 17, udp(5353, 5353, dns(0, 0x8400, [], [{ name: `${pi.name}.local`, ip: pi.ip }], true)), 255)),
  // NetBIOS: the Windows PC registers its name by broadcast.
  ether(BROADCAST, windows.mac, 0x0800, ipv4(windows.ip, '192.168.50.255', 17, udp(137, 137, nbnsRegistration(windows.name, windows.ip)))),
  // DNS: this PC asks the router for www.google.com, and gets its address.
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, router.ip, 17, udp(51000, 53, dns(0x1a2b, 0x0100, [web.name], [])))),
  ether(me.mac, router.mac, 0x0800, ipv4(router.ip, me.ip, 17, udp(53, 51000, dns(0x1a2b, 0x8180, [web.name], [{ name: web.name, ip: web.ip }])))),
  // TCP: this PC and the web server, through the router (its MAC on the wire): a handshake and some data.
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, web.ip, 6, tcp(52000, 443, 1, 0x02))),
  ether(me.mac, router.mac, 0x0800, ipv4(web.ip, me.ip, 6, tcp(443, 52000, 1, 0x12), 118)),
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, web.ip, 6, tcp(52000, 443, 2, 0x10))),
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, web.ip, 6, tcp(52000, 443, 2, 0x18, Buffer.alloc(300, 0x16)))),
  ether(me.mac, router.mac, 0x0800, ipv4(web.ip, me.ip, 6, tcp(443, 52000, 2, 0x18, Buffer.alloc(1400, 0x17)), 118)),
  ether(me.mac, router.mac, 0x0800, ipv4(web.ip, me.ip, 6, tcp(443, 52000, 1402, 0x18, Buffer.alloc(1400, 0x17)), 118)),
  // A TV box announcing itself over mDNS as Google Cast does: the name is in the TXT record, not the host name.
  ether('01:00:5e:00:00:fb', cast.mac, 0x0800, ipv4(cast.ip, '224.0.0.251', 17, udp(5353, 5353, castAnnouncement(cast)), 255)),
  // IPv6: this PC's own global address (not a host out on the internet) talking to one, through the router.
  ether(router.mac, me.mac, 0x86dd, ipv6(me6.ip, web6.ip, 6, tcp(52100, 443, 1, 0x02))),
  ether(me.mac, router.mac, 0x86dd, ipv6(web6.ip, me6.ip, 6, tcp(443, 52100, 1, 0x12, Buffer.alloc(200, 0x17)))),
  // A device that says nothing of itself: a random MAC, one broadcast (to a port nobody names).
  ether(BROADCAST, quiet.mac, 0x0800, ipv4(quiet.ip, '255.255.255.255', 17, udp(40000, 9999, Buffer.from('hello')))),
];

// The classic libpcap format: a global header, then each packet with its time and length. Ethernet (link type 1).
const START = Date.UTC(2026, 9, 25, 18, 0, 0) / 1000;
const header = Buffer.alloc(24);
header.writeUInt32LE(0xa1b2c3d4, 0);
header.writeUInt16LE(2, 4);
header.writeUInt16LE(4, 6);
header.writeUInt32LE(65535, 16);
header.writeUInt32LE(1, 20);
const records = packets.map((p, i) => {
  const r = Buffer.alloc(16);
  r.writeUInt32LE(START + i, 0);
  r.writeUInt32LE(250_000, 4);
  r.writeUInt32LE(p.length, 8);
  r.writeUInt32LE(p.length, 12);
  return Buffer.concat([r, p]);
});
writeFileSync(path.join(OUT, 'lan.pcap'), Buffer.concat([header, ...records]));

// What the capture holds, worked out here from the packets above, never from what the dissector says.
const sent = new Map<string, { packets: number; bytes: number }>();
for (const p of packets) {
  const src = [...p.subarray(6, 12)].map((b) => b.toString(16).padStart(2, '0')).join(':');
  const s = sent.get(src) ?? { packets: 0, bytes: 0 };
  s.packets++;
  s.bytes += p.length;
  sent.set(src, s);
}
// The conversations between two unicast addresses, read off the IP and TCP/UDP headers: the pair in the order first
// met, the server's port (the lower of the two, as every port here is), and the bytes each way.
const conversations = new Map<string, { a: string; b: string; service: string; sent: number; received: number; packets: number }>();
for (const p of packets) {
  const type = p.readUInt16BE(12);
  if (type !== 0x0800 && type !== 0x86dd) continue;
  const v4 = type === 0x0800;
  const ip = p.subarray(14);
  const proto = v4 ? ip[9]! : ip[6]!;
  const head = v4 ? (ip[0]! & 0x0f) * 4 : 40;
  // IPv6 written short, as tshark writes it (the URL parser shortens it).
  const addr = (b: Buffer) => (v4 ? [...b].join('.') : new URL(`http://[${(b.toString('hex').match(/.{4}/g) ?? []).join(':')}]`).hostname.slice(1, -1));
  const src = v4 ? addr(ip.subarray(12, 16)) : addr(ip.subarray(8, 24));
  const dst = v4 ? addr(ip.subarray(16, 20)) : addr(ip.subarray(24, 40));
  if (dst.endsWith('.255') || dst.startsWith('224.') || src === '0.0.0.0') continue;
  const name = proto === 6 ? 'tcp' : proto === 17 ? 'udp' : '';
  if (!name) continue;
  const service = `${name}/${Math.min(ip.readUInt16BE(head), ip.readUInt16BE(head + 2))}`;
  const back = conversations.get(`${dst} ${src} ${service}`);
  const c = back ?? conversations.get(`${src} ${dst} ${service}`) ?? { a: src, b: dst, service, sent: 0, received: 0, packets: 0 };
  conversations.set(`${c.a} ${c.b} ${service}`, c);
  if (c.a === src) c.sent += p.length;
  else c.received += p.length;
  c.packets++;
}
writeFileSync(
  path.join(OUT, 'lan.truth.json'),
  `${JSON.stringify(
    {
      packets: packets.length,
      bytes: packets.reduce((n, p) => n + p.length, 0),
      hosts: HOSTS,
      sentByMac: Object.fromEntries(sent),
      conversations: [...conversations.values()],
    },
    null,
    2,
  )}\n`,
);
console.log(`${packets.length} packets in tests/fixtures/lan.pcap`);
