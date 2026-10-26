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
// - one broadcast from a device that never says its name, from a locally administered (random) MAC;
// - for the dictionary (shared/classify.ts): YouTube's video, named by DNS; a WireGuard tunnel on port 443 to a host
//   with no name (a VPN, not the web); a WhatsApp call (STUN to a host DNS named); STUN to a host with no name; and
//   the TV box answering this PC's SSDP question from a port of its own (SSDP, though neither port says so);
// - for what a device is (shared/identify.ts) and how safe it is (shared/security.ts): an Android tablet asking DHCP
//   with its vendor class and asking Google's DNS directly; the phone's connectivity check over HTTP with its
//   User-Agent; the Windows PC fetching a certificate list over HTTP; a printer announcing printing over mDNS and
//   posting to a server out there over HTTP with a password; the Pi logging in to FTP; this PC's TLS to a server that
//   agrees TLS 1.0, and to an encrypted DNS resolver by name. Every password here is invented, and only that one went
//   by is kept.

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
  video: { ip: '173.194.188.71', name: 'rr4---sn-aigl6nzr.googlevideo.com' },
  vpn: { ip: '198.51.100.7' },
  call: { ip: '157.240.212.60', name: 'e7.whatsapp.net' },
  turn: { ip: '203.0.113.5' },
  tablet: { mac: '00:00:f0:65:43:21', ip: '192.168.50.45', name: 'Galaxy-Tab-S9', vendorClass: 'android-dhcp-14' },
  printer: { mac: '00:01:e6:ab:cd:01', ip: '192.168.50.60', name: 'Office Printer' },
  google: { ip: '8.8.8.8' },
  captive: { ip: '203.0.113.30', name: 'captive.apple.com' },
  crl: { ip: '203.0.113.80', name: 'crl3.digicert.com' },
  upload: { ip: '198.51.100.77', name: 'print.example.net' },
  ftp: { ip: '203.0.113.21', name: 'ftp.example.net' },
  legacy: { ip: '203.0.113.90', name: 'legacy.example.net' },
  doh: { ip: '198.51.100.53', name: 'cloudflare-dns.com' },
};
const BROADCAST = 'ff:ff:ff:ff:ff:ff';

/** WireGuard's messages, as its heuristic knows them: the type in the first byte, three zeros, and the length each has. */
const wireguard = (type: 1 | 2 | 4, length: number) => Buffer.concat([Buffer.from([type, 0, 0, 0]), Buffer.alloc(length - 4, 0x5a)]);
/** A STUN binding request (RFC 5389): its type, no attributes, the magic cookie, a transaction id. */
const stunRequest = (id: number) => Buffer.concat([u16(0x0001), u16(0), u32(0x2112a442), Buffer.alloc(8, 0), u32(id)]);

/** A TLS record holding one handshake message. */
const tlsRecord = (type: number, body: Buffer, version = 0x0301) =>
  Buffer.concat([Buffer.from([0x16]), u16(version), u16(body.length + 4), Buffer.from([type]), Buffer.from([0, body.length >> 8, body.length & 255]), body]);
/** A ClientHello asking for `name` (SNI) and TLS 1.3 or 1.2. */
function clientHello(name: string) {
  const sni = Buffer.concat([u16(name.length + 3), Buffer.from([0]), u16(name.length), Buffer.from(name)]);
  const versions = Buffer.from([4, 0x03, 0x04, 0x03, 0x03]);
  const ext = Buffer.concat([u16(0), u16(sni.length), sni, u16(0x2b), u16(versions.length), versions]);
  const body = Buffer.concat([u16(0x0303), Buffer.alloc(32, 7), Buffer.from([0]), u16(4), u16(0x1301), u16(0x002f), Buffer.from([1, 0]), u16(ext.length), ext]);
  return tlsRecord(1, body);
}
/** A ServerHello agreeing TLS 1.0, as an old server does. */
const serverHello10 = () => tlsRecord(2, Buffer.concat([u16(0x0301), Buffer.alloc(32, 9), Buffer.from([0]), u16(0x002f), Buffer.from([0])]));
const http = (lines: string[]) => Buffer.from(`${lines.join('\r\n')}\r\n\r\n`);

/** An mDNS announcement of a printer: PTR from the IPP service type to its instance. */
function printerAnnouncement(name: string): Buffer {
  const instance = `${name}._ipp._tcp.local`;
  return Buffer.concat([u16(0), u16(0x8400), u16(0), u16(1), u16(0), u16(0), qname('_ipp._tcp.local'), u16(12), u16(1), u32(120), u16(qname(instance).length), qname(instance)]);
}

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

const { router, phone, pi, windows, me, quiet, web, cast, me6, web6, video, vpn, call, turn, tablet, printer, google, captive, crl, upload, ftp, legacy, doh } = HOSTS;
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
  // YouTube: DNS names a googlevideo.com host, and the video comes over UDP 443 (QUIC's port).
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, router.ip, 17, udp(51001, 53, dns(0x1a2c, 0x0100, [video.name], [])))),
  ether(me.mac, router.mac, 0x0800, ipv4(router.ip, me.ip, 17, udp(53, 51001, dns(0x1a2c, 0x8180, [video.name], [{ name: video.name, ip: video.ip }])))),
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, video.ip, 17, udp(53001, 443, Buffer.alloc(200, 0x40)))),
  ether(me.mac, router.mac, 0x0800, ipv4(video.ip, me.ip, 17, udp(443, 53001, Buffer.alloc(1300, 0x41)), 118)),
  ether(me.mac, router.mac, 0x0800, ipv4(video.ip, me.ip, 17, udp(443, 53001, Buffer.alloc(1300, 0x42)), 118)),
  // A WireGuard tunnel to a host with no name, on UDP 443: the handshake, and one message of data each way.
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, vpn.ip, 17, udp(40404, 443, wireguard(1, 148)))),
  ether(me.mac, router.mac, 0x0800, ipv4(vpn.ip, me.ip, 17, udp(443, 40404, wireguard(2, 92)), 50)),
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, vpn.ip, 17, udp(40404, 443, wireguard(4, 160)))),
  ether(me.mac, router.mac, 0x0800, ipv4(vpn.ip, me.ip, 17, udp(443, 40404, wireguard(4, 1120)), 50)),
  // A WhatsApp call: DNS names the relay, and the call begins with STUN to it.
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, router.ip, 17, udp(51002, 53, dns(0x1a2d, 0x0100, [call.name], [])))),
  ether(me.mac, router.mac, 0x0800, ipv4(router.ip, me.ip, 17, udp(53, 51002, dns(0x1a2d, 0x8180, [call.name], [{ name: call.name, ip: call.ip }])))),
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, call.ip, 17, udp(49152, 3478, stunRequest(1)))),
  // STUN to a host no name was seen for: a way through the router, for something that does not say what.
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, turn.ip, 17, udp(49153, 3478, stunRequest(2)))),
  // SSDP: this PC asks who is there; the TV box answers it directly, from a port of its own to the one that asked.
  ether('01:00:5e:7f:ff:fa', me.mac, 0x0800, ipv4(me.ip, '239.255.255.250', 17, udp(50123, 1900, Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n')), 1)),
  ether(me.mac, cast.mac, 0x0800, ipv4(cast.ip, me.ip, 17, udp(41234, 50123, Buffer.from('HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nST: upnp:rootdevice\r\n\r\n')))),
  // The tablet asks DHCP with its vendor class (60) and the options it wants (55), then asks Google's DNS directly.
  ether(
    BROADCAST,
    tablet.mac,
    0x0800,
    ipv4(
      '0.0.0.0',
      '255.255.255.255',
      17,
      udp(
        68,
        67,
        dhcp(1, 3, tablet.mac, '0.0.0.0', [
          opt(50, ip4(tablet.ip)),
          opt(12, Buffer.from(tablet.name)),
          opt(60, Buffer.from(tablet.vendorClass)),
          opt(55, Buffer.from([1, 3, 6, 15, 26, 28, 51, 58, 59, 43, 114, 108])),
        ]),
      ),
    ),
  ),
  ether(router.mac, tablet.mac, 0x0800, ipv4(tablet.ip, google.ip, 17, udp(51003, 53, dns(0x1a2e, 0x0100, [web.name], [])))),
  ether(tablet.mac, router.mac, 0x0800, ipv4(google.ip, tablet.ip, 17, udp(53, 51003, dns(0x1a2e, 0x8180, [web.name], [{ name: web.name, ip: web.ip }])), 118)),
  // The phone checks for a captive portal over plain HTTP, as iPhones do, saying what it is.
  ether(
    router.mac,
    phone.mac,
    0x0800,
    ipv4(phone.ip, captive.ip, 6, tcp(53000, 80, 1, 0x18, http(['GET /hotspot-detect.html HTTP/1.1', `Host: ${captive.name}`, 'User-Agent: CaptiveNetworkSupport-481.0.1 wispr', 'Accept: */*']))),
  ),
  ether(
    router.mac,
    phone.mac,
    0x0800,
    ipv4(phone.ip, captive.ip, 6, tcp(53001, 80, 1, 0x18, http(['GET /library/test/success.html HTTP/1.1', `Host: ${captive.name}`, 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148']))),
  ),
  // The Windows PC fetches a certificate list over HTTP (signed, so harmless in the clear).
  ether(router.mac, windows.mac, 0x0800, ipv4(windows.ip, crl.ip, 6, tcp(53100, 80, 1, 0x18, http(['GET /pki/root.crl HTTP/1.1', 'User-Agent: Microsoft-CryptoAPI/10.0', `Host: ${crl.name}`])))),
  // The printer announces printing over mDNS, and posts to a server out there over HTTP, with a (made-up) password.
  ether('01:00:5e:00:00:fb', printer.mac, 0x0800, ipv4(printer.ip, '224.0.0.251', 17, udp(5353, 5353, printerAnnouncement(printer.name)), 255)),
  ether(
    router.mac,
    printer.mac,
    0x0800,
    ipv4(printer.ip, upload.ip, 6, tcp(53200, 80, 1, 0x18, http(['POST /scan HTTP/1.1', `Host: ${upload.name}`, 'Authorization: Basic ZXhhbXBsZTpleGFtcGxl', 'Content-Length: 0']))),
  ),
  // The Pi logs in to FTP: its user and (made-up) password travel as they are.
  ether(router.mac, pi.mac, 0x0800, ipv4(pi.ip, ftp.ip, 6, tcp(53300, 21, 1, 0x18, Buffer.from('USER example\r\n')))),
  ether(router.mac, pi.mac, 0x0800, ipv4(pi.ip, ftp.ip, 6, tcp(53300, 21, 15, 0x18, Buffer.from('PASS example\r\n')))),
  // This PC: TLS to an old server, which agrees TLS 1.0; and to an encrypted DNS resolver, by name.
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, legacy.ip, 6, tcp(53400, 443, 1, 0x18, clientHello(legacy.name)))),
  ether(me.mac, router.mac, 0x0800, ipv4(legacy.ip, me.ip, 6, tcp(443, 53400, 1, 0x18, serverHello10()), 118)),
  ether(router.mac, me.mac, 0x0800, ipv4(me.ip, doh.ip, 6, tcp(53500, 443, 1, 0x18, clientHello(doh.name)))),
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
// met, the server's port (the lower of the two, as every port here is, but for an answer to an SSDP question: SSDP's,
// as the question was), and the bytes each way.
const askedSsdp = new Set<string>();
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
  const [sport, dport] = [ip.readUInt16BE(head), ip.readUInt16BE(head + 2)];
  if (proto === 17 && dport === 1900) askedSsdp.add(`${src}|${sport}`);
  if (dst.endsWith('.255') || dst.startsWith('224.') || dst.startsWith('239.') || src === '0.0.0.0') continue;
  const name = proto === 6 ? 'tcp' : proto === 17 ? 'udp' : '';
  if (!name) continue;
  const service = proto === 17 && askedSsdp.has(`${dst}|${dport}`) ? 'udp/1900' : `${name}/${Math.min(sport, dport)}`;
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
