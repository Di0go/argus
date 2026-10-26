// The dissection, on the fixture: what it says is checked against tests/fixtures/lan.truth.json, which the fixture's
// maker worked out from the packets it built, never from what tshark or this code say.

import { interpret } from '../server/interpret.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classify, parseDumpcapList } from '../server/capture.ts';
import { dissect, isLocal, isRandomMac, isUnicastIp, shortVendor } from '../server/dissect.ts';
import { DEVICES, FIXTURE, fakeCapture, ROOT, TSHARK } from './helpers.ts';

const truth = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lan.truth.json'), 'utf8'));
const H = truth.hosts;
// The sensor's facts, read as the server reads them.
const r = interpret(await dissect(FIXTURE, { tshark: TSHARK, ownMacs: [H.me.mac] }));
const byMac = (mac: string) => r.devices.find((d) => d.mac === mac);

test('Every packet and byte is counted, and each device sent exactly what the truth says', () => {
  assert.equal(r.packets, truth.packets);
  assert.equal(r.bytes, truth.bytes);
  for (const [mac, sent] of Object.entries(truth.sentByMac as Record<string, { bytes: number }>)) {
    assert.equal(byMac(mac)?.bytesSent, sent.bytes, mac);
  }
  // The broadcast and multicast addresses are not devices.
  assert.equal(r.devices.length, DEVICES);
  assert.ok(!r.devices.some((d) => d.mac?.startsWith('ff:') || d.mac?.startsWith('01:')));
});

test('Each device by the name it gave, through DHCP, mDNS or NetBIOS, with its address', () => {
  const phone = byMac(H.phone.mac);
  assert.equal(phone?.name, H.phone.name);
  assert.deepEqual(phone?.names, [{ name: H.phone.name, source: 'DHCP' }]);
  assert.deepEqual(phone?.ips, [H.phone.ip]);
  assert.equal(byMac(H.pi.mac)?.name, H.pi.name);
  assert.equal(byMac(H.pi.mac)?.names[0]?.source, 'mDNS');
  assert.deepEqual(byMac(H.pi.mac)?.ips, [H.pi.ip]);
  assert.equal(byMac(H.windows.mac)?.name, H.windows.name);
  assert.equal(byMac(H.windows.mac)?.names[0]?.source, 'NetBIOS');
});

test('A Google Cast box by the friendly name in its TXT record, with its model; never a service or a UUID', () => {
  const cast = byMac(H.cast.mac);
  assert.equal(cast?.name, H.cast.name);
  assert.equal(cast?.model, H.cast.model);
  assert.deepEqual(cast?.ips, [H.cast.ip]);
  for (const d of r.devices) assert.ok(!d.names.some((n) => n.name.startsWith('_') || /^[0-9a-f]{8}-/.test(n.name)), d.name);
});

test('An IPv6 address of a device here is its own, not a host out on the internet', () => {
  assert.ok(byMac(H.me.mac)?.ips.includes(H.me6.ip));
  assert.ok(!r.remotes.some((h) => h.ip === H.me6.ip));
  assert.ok(r.remotes.some((h) => h.ip === H.web6.ip));
});

test('The maker from the MAC; a made-up MAC said as private; the router and this PC known by what they do', () => {
  assert.equal(byMac(H.phone.mac)?.vendor, 'Apple, Inc.');
  assert.equal(byMac(H.pi.mac)?.vendor, 'Raspberry Pi Foundation');
  const quiet = byMac(H.quiet.mac);
  assert.equal(quiet?.randomMac, true);
  assert.equal(quiet?.vendor, undefined);
  assert.match(quiet?.name ?? '', /^Private device/);
  assert.deepEqual(quiet?.ips, [H.quiet.ip]);
  assert.equal(byMac(H.router.mac)?.role, 'gateway');
  assert.equal(byMac(H.router.mac)?.name, 'Router Tp-Link');
  assert.equal(byMac(H.me.mac)?.role, 'self');
});

test('The host on the internet, named by the DNS answer, linked to the device that talked to it', () => {
  const web = r.remotes.find((h) => h.ip === H.web.ip);
  assert.equal(web?.ip, H.web.ip);
  assert.equal(web?.name, H.web.name);
  assert.equal(web?.names[0]?.source, 'DNS');
  const link = r.links.find((l) => l.to === `remote:${H.web.ip}`);
  assert.equal(link?.from, `device:${H.me.mac}`);
  // The TCP packets between this PC and the web server: 3 sent (54+54+354) and 3 received (54+1454+1454).
  assert.equal(web?.bytesReceived, 54 + 54 + 354);
  assert.equal(web?.bytesSent, 54 + 1454 + 1454);
});

test('Every conversation, by its two ends and its service, with the bytes each way the truth worked out from the headers', () => {
  // An address is a device's when a device has it, else a host out on the internet's.
  const keyOfIp = (ip: string) => {
    const d = r.devices.find((x) => x.ips.includes(ip));
    return d ? `device:${d.id}` : `remote:${ip}`;
  };
  type Truth = { a: string; b: string; service: string; sent: number; received: number; packets: number };
  const expected = (truth.conversations as Truth[]).map((c) => ({ ...c, a: keyOfIp(c.a), b: keyOfIp(c.b) }));
  const got = r.conversations.map(({ a, b, service, sent, received, packets }) => ({ a, b, service, sent, received, packets }));
  const order = (x: { a: string; b: string; service: string }, y: { a: string; b: string; service: string }) =>
    `${x.a}${x.b}${x.service}`.localeCompare(`${y.a}${y.b}${y.service}`);
  assert.deepEqual(got.sort(order), expected.sort(order));
  // This PC and the web server: HTTPS, by the port, on the fixture's interface.
  const web = r.conversations.find((c) => c.b === `remote:${H.web.ip}`);
  assert.equal(web?.a, `device:${H.me.mac}`);
  assert.equal(web?.service, 'tcp/443');
});

test('Each conversation and host in plain words: YouTube by name, a VPN by how it goes, a call, SSDP answered from any port', () => {
  const to = (ip: string) => r.conversations.find((c) => c.b === `remote:${ip}`);
  const video = to(H.video.ip);
  assert.deepEqual([video?.app?.company, video?.app?.app, video?.app?.activity], ['Google', 'YouTube', 'watching video']);
  assert.equal(r.remotes.find((h) => h.ip === H.video.ip)?.app?.app, 'YouTube');
  // WireGuard on UDP 443, to a host with no name: tshark knows it, and it is a VPN, not QUIC.
  const vpn = to(H.vpn.ip);
  assert.equal(vpn?.service, 'udp/443');
  assert.equal(vpn?.protocol, 'wg');
  assert.deepEqual([vpn?.app?.app, vpn?.app?.category], ['WireGuard', 'vpn']);
  // STUN to WhatsApp's relay is a call; to a host nobody named, only a way through the router.
  assert.deepEqual([to(H.call.ip)?.app?.app, to(H.call.ip)?.app?.activity], ['WhatsApp', 'on a call']);
  assert.deepEqual([to(H.turn.ip)?.app?.app, to(H.turn.ip)?.app?.category], ['STUN', 'network']);
  // The TV box's answer to this PC's SSDP question, from a port of its own: SSDP.
  const ssdp = r.conversations.find((c) => c.service === 'udp/1900');
  assert.equal(ssdp?.app?.app, 'SSDP');
  // DNS with the router is DNS; the web server (www.google.com) is Google's search.
  assert.equal(r.conversations.find((c) => c.service === 'udp/53')?.app?.app, 'DNS');
  assert.equal(to(H.web.ip)?.app?.app, 'Google Search');
});

test('Addresses: local, unicast, random MACs, and makers shortened', () => {
  assert.ok(isLocal('192.168.50.5') && isLocal('10.0.0.1') && isLocal('100.101.1.1') && isLocal('fe80::1'));
  assert.ok(!isLocal('142.250.184.14') && !isLocal('2a00:1450::1') && !isLocal('172.32.0.1'));
  assert.ok(!isUnicastIp('224.0.0.251') && !isUnicastIp('192.168.50.255') && !isUnicastIp('ff02::fb') && isUnicastIp('8.8.8.8'));
  assert.ok(isRandomMac('9a:11:22:33:44:55') && !isRandomMac('3c:22:fb:ab:cd:ef'));
  assert.equal(shortVendor('Tp-Link Technologies Co.,Ltd.'), 'Tp-Link');
  assert.equal(shortVendor('Apple, Inc.'), 'Apple');
});

test('Interfaces named as he would: Wi-Fi, Cable, Docker, VPN, Loopback, All; dumpcap’s list read as it prints it', async () => {
  const { sysNet } = await fakeCapture();
  assert.equal(classify('wlan0', sysNet).label, 'Wi-Fi');
  assert.deepEqual(classify('enp3s0', sysNet), { type: 'cable', label: 'Cable', up: false });
  assert.equal(classify('docker0', sysNet).label, 'Docker');
  assert.equal(classify('tailscale0', sysNet).label, 'VPN');
  assert.equal(classify('lo', sysNet).type, 'loopback');
  assert.equal(classify('any', sysNet).label, 'All');
  assert.deepEqual(parseDumpcapList('1. wlan0\n5. any (Pseudo-device that captures on all interfaces)\n'), [
    { name: 'wlan0', description: undefined },
    { name: 'any', description: 'Pseudo-device that captures on all interfaces' },
  ]);
});

test('Frames one at a time add up to the same as the file read whole, and a saved session reads back the same', async () => {
  const { execFileSync } = await import('node:child_process');
  const { Tally, fieldArgs } = await import('../server/tally.ts');
  const { interpret } = await import('../server/interpret.ts');
  const text = execFileSync(TSHARK, ['-r', FIXTURE, ...fieldArgs()], { encoding: 'utf8' });
  const t = new Tally({ ownMacs: [H.me.mac] });
  for (const line of text.split('\n').filter(Boolean)) t.addText(line);
  assert.deepEqual(interpret(t.view()), r);
  const back = Tally.load(JSON.parse(JSON.stringify(t.save())), { ownMacs: [H.me.mac] });
  // As JSON both: on disk a missing maker and an undefined one are the same.
  assert.deepEqual(JSON.parse(JSON.stringify(interpret(back.view()))), JSON.parse(JSON.stringify(r)));
  assert.deepEqual(back.fine.tail(), t.fine.tail());
});

test('Bounded: past the ceilings the conversations and devices quiet longest are forgotten', async () => {
  const { execFileSync } = await import('node:child_process');
  const { Tally, fieldArgs } = await import('../server/tally.ts');
  const { interpret } = await import('../server/interpret.ts');
  const text = execFileSync(TSHARK, ['-r', FIXTURE, ...fieldArgs()], { encoding: 'utf8' });
  const t = new Tally({ maxFlows: 4, maxDevices: 3 }).addText(text);
  const saved = t.save();
  assert.ok(saved.flows.length <= 4, String(saved.flows.length));
  assert.ok(saved.devices.length <= 3, String(saved.devices.length));
  // What was counted still adds up: the totals are not the ceiling's to change.
  assert.equal(t.packets, truth.packets);
  assert.equal(t.bytes, truth.bytes);
});

test('The bandwidth over time: each byte in the bucket of its second, the oldest dropped as time moves on', async () => {
  const { Series } = await import('../server/tally.ts');
  const s = new Series(1, 5);
  s.add(100.2, 10, 0);
  s.add(100.9, 5, 1);
  s.add(102.5, 0, 7);
  assert.deepEqual(s.tail(), { step: 1, end: 102, sent: [0, 0, 15, 0, 0], received: [0, 0, 1, 0, 7] });
  s.advance(104);
  assert.deepEqual(s.tail().sent, [15, 0, 0, 0, 0]);
  s.advance(200);
  assert.deepEqual(s.tail().sent, [0, 0, 0, 0, 0]);
  // A frame older than what is kept is not counted in the series (it still is in the totals).
  s.add(150, 9, 9);
  assert.deepEqual(s.tail().sent, [0, 0, 0, 0, 0]);
});

test('A neighbour that floods mDNS and ARP with new names and addresses is bounded, and cheap to add up', async () => {
  const { Tally, FIELDS, SEP } = await import('../server/tally.ts');
  const row = (f: Record<string, string>) => FIELDS.map((k) => f[k] ?? '').join('\t');
  const lines: string[] = [];
  const mac = '9a:11:22:33:44:66';
  for (let i = 0; i < 20_000; i++) {
    lines.push(row({ 'frame.time_epoch': String(1000 + i / 100), 'frame.len': '100', 'eth.src': mac, 'eth.dst': '01:00:5e:00:00:fb', 'ip.src': '192.168.50.99', 'ip.dst': '224.0.0.251', 'dns.flags.response': '1', 'dns.resp.name': `h${i}.local`, 'dns.resp.type': '1' }));
    lines.push(row({ 'frame.time_epoch': String(1000 + i / 100), 'frame.len': '60', 'eth.src': mac, 'eth.dst': 'ff:ff:ff:ff:ff:ff', 'arp.src.hw_mac': mac, 'arp.src.proto_ipv4': `10.${(i >> 8) & 255}.${i & 255}.7` }));
  }
  lines.push(row({ 'frame.time_epoch': '1300', 'frame.len': '342', 'eth.src': '9a:11:22:33:44:77', 'eth.dst': 'ff:ff:ff:ff:ff:ff', 'dhcp.hw.mac_addr': '9a:11:22:33:44:77', 'dhcp.option.hostname': `Router ${'x'.repeat(300)}` }));
  void SEP;
  const t0 = performance.now();
  const v = new Tally().addText(lines.join('\n')).view();
  const ms = performance.now() - t0;
  // Before: 13 s for 20 000 names (and four times as long for twice as many), and one device of 1.6 MB.
  assert.ok(ms < 3000, `${Math.round(ms)} ms`);
  const d = v.devices.find((x) => x.mac === mac)!;
  assert.ok(d.names.length <= 12, String(d.names.length));
  assert.ok(d.ips.length <= 16, String(d.ips.length));
  assert.ok(JSON.stringify(d).length < 4000, String(JSON.stringify(d).length));
  // A name of 300 characters is cut at 100; one that says "Router" is told apart from the real one by its MAC.
  const long = v.devices.find((x) => x.mac === '9a:11:22:33:44:77')!;
  assert.ok(long.names[0]!.name.length <= 100);
  assert.match(long.name, /·44:77$/);
});

test('At the ceilings the session kept on disk stays small: 500 devices heard once a minute for a day', async () => {
  const { Tally, FIELDS } = await import('../server/tally.ts');
  const t = new Tally();
  const cols = FIELDS.map(() => [] as string[]);
  const at = (k: string) => FIELDS.indexOf(k as (typeof FIELDS)[number]);
  const day = 86_400;
  for (let m = 0; m < day / 60; m++) {
    for (let n = 0; n < 500; n++) {
      const row = Object.fromEntries(FIELDS.map((k) => [k, [] as string[]])) as Parameters<typeof t.add>[0];
      row['frame.time_epoch'] = [String(1_800_000_000 + m * 60 + (n % 60))];
      row['frame.len'] = ['90'];
      row['eth.src'] = [`9a:00:00:00:${(n >> 8).toString(16).padStart(2, '0')}:${(n & 255).toString(16).padStart(2, '0')}`];
      row['eth.dst'] = ['ff:ff:ff:ff:ff:ff'];
      t.add(row);
    }
  }
  void cols;
  void at;
  const size = JSON.stringify(t.save()).length;
  // Before: 107 MB for 2000 devices; the coarse day per device is now 144 buckets, kept only where heard.
  assert.ok(size < 12_000_000, `${(size / 1e6).toFixed(1)} MB`);
});

test('What each device is, with how sure, from its own words; and nothing made up for one that says nothing', () => {
  const by = (mac: string) => r.devices.find((d) => d.mac === mac)!;
  const id = (mac: string) => by(mac).identity;
  assert.equal(id(H.phone.mac)?.label, 'iPhone, iOS');
  assert.equal(id(H.phone.mac)?.confidence, 'sure');
  assert.ok(id(H.phone.mac)?.clues.some((c) => c.from.startsWith('User-Agent')));
  assert.equal(id(H.tablet.mac)?.label, 'Galaxy Tab, Android');
  assert.equal(id(H.tablet.mac)?.confidence, 'sure');
  assert.deepEqual(by(H.tablet.mac).clues?.dhcpClass, ['android-dhcp-14']);
  assert.equal(by(H.tablet.mac).clues?.dhcpParams, '1,3,6,15,26,28,51,58,59,43,114,108');
  assert.equal(id(H.cast.mac)?.label, 'Chromecast');
  assert.equal(id(H.printer.mac)?.kind, 'printer');
  assert.deepEqual(by(H.printer.mac).clues?.services, ['_ipp._tcp']);
  assert.equal(id(H.windows.mac)?.os, 'Windows');
  assert.equal(id(H.pi.mac)?.label, 'Raspberry Pi, Linux');
  assert.equal(id(H.router.mac)?.label, 'Router');
  // A random MAC and one broadcast: no clue, so no identity.
  assert.equal(id(H.quiet.mac), undefined);
  // This PC's TLS client, by its fingerprint.
  assert.equal(by(H.me.mac).clues?.ja4?.length, 1);
});

test('Without encryption: HTTP and FTP marked, a login seen (never kept), harmless checks not coloured; old TLS; DNS', () => {
  const talk = (ip: string) => r.conversations.find((c) => c.b === `remote:${ip}`)!;
  assert.deepEqual(talk(H.upload.ip).clear, { proto: 'HTTP', credentials: true });
  assert.deepEqual(talk(H.ftp.ip).clear, { proto: 'FTP', credentials: true });
  assert.deepEqual(talk(H.captive.ip).clear, { proto: 'HTTP', harmless: true });
  assert.deepEqual(talk(H.crl.ip).clear, { proto: 'HTTP', harmless: true });
  assert.equal(talk(H.web.ip).clear, undefined);
  assert.equal(talk(H.legacy.ip).tls, '1.0');
  // The password itself is nowhere in what Argus keeps.
  assert.ok(!JSON.stringify(r).includes('ZXhhbXBsZTpleGFtcGxl'));
  // HTTP's Host names the host, as SNI does for TLS.
  assert.ok(r.remotes.find((h) => h.ip === H.upload.ip)?.names.some((n) => n.name === H.upload.name && n.source === 'HTTP'));
  const dns = (mac: string) => r.devices.find((d) => d.mac === mac)!.dns;
  assert.deepEqual(dns(H.tablet.mac)?.map((u) => [u.kind, u.server, u.name]), [['other', '8.8.8.8', 'Google DNS']]);
  assert.deepEqual(
    dns(H.me.mac)?.map((u) => [u.kind, u.name]),
    [
      ['house', 'the router'],
      ['encrypted', 'Cloudflare DNS'],
    ],
  );
});

test('An older tshark without some fields: they are left out, the rest reads the same, and the session still adds up', async () => {
  const { execFileSync } = await import('node:child_process');
  const { FIELDS, fieldArgs, parseLine, Tally, useFields } = await import('../server/tally.ts');
  try {
    const missing = useFields(new Set(FIELDS.filter((f) => f !== 'tls.handshake.ja4' && f !== 'http.host')));
    assert.deepEqual(missing.sort(), ['http.host', 'tls.handshake.ja4']);
    assert.ok(!fieldArgs().includes('tls.handshake.ja4'));
    const text = execFileSync(TSHARK, ['-r', FIXTURE, ...fieldArgs()], { encoding: 'utf8' });
    const t = new Tally({ ownMacs: [H.me.mac] });
    for (const line of text.split('\n').filter(Boolean)) t.add(parseLine(line));
    const v = t.view();
    assert.equal(v.devices.length, DEVICES);
    assert.equal(v.bytes, truth.bytes);
    assert.equal(v.devices.find((d) => d.mac === H.me.mac)?.clues?.ja4, undefined);
  } finally {
    useFields(new Set(FIELDS));
  }
});

test('The sensor gives facts only: no reading in what it adds up, and none of its files imports one (docs/sensor.md)', async () => {
  const raw = await dissect(FIXTURE, { tshark: TSHARK, ownMacs: [H.me.mac] });
  assert.ok(raw.conversations.every((c) => !c.app && !c.clear?.harmless));
  assert.ok(raw.devices.every((d) => !d.identity && !d.dns && !d.doing));
  assert.ok(raw.remotes.every((h) => !h.app && !h.where));
  for (const f of ['server/capture.ts', 'server/live.ts', 'server/tally.ts', 'server/dissect.ts']) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /^import .*(\.\/(interpret|dictionary|history|geo|tools)\.ts|shared\/(identify|classify|words)\.ts)/m, f);
  }
});

test('Moved to another network: the new router is a way out too, not a device that talks to hosts with no name', async () => {
  const { Tally, FIELDS } = await import('../server/tally.ts');
  const row = (f: Record<string, string>) => FIELDS.map((k) => f[k] ?? '').join('\t');
  const me = '3c:22:fb:00:00:01';
  const home = '00:1d:aa:00:00:fe';
  const office = '24:5a:4c:00:00:01';
  // A frame each way between this PC and a host out there, through a router; a dozen hosts, as browsing goes.
  const frames = (t0: number, n: number, router: string, mine: string, net: string) =>
    Array.from({ length: n }, (_, i) => {
      const out = `${net}.${10 + (Math.floor(i / 2) % 12)}`;
      const back = i % 2 === 1;
      return row({
        'frame.time_epoch': String(t0 + i / 10),
        'frame.len': '1200',
        'frame.interface_name': 'wlan0',
        'eth.src': back ? router : me,
        'eth.dst': back ? me : router,
        'ip.src': back ? out : mine,
        'ip.dst': back ? mine : out,
        'ip.proto': '6',
        'tcp.srcport': back ? '443' : '50000',
        'tcp.dstport': back ? '50000' : '443',
      });
    });
  // Hours at home first (the old router far the busiest), then a few minutes at the office.
  const text = [...frames(1000, 6000, home, '192.168.50.20', '203.0.113'), ...frames(2000, 600, office, '172.16.9.20', '198.51.100')].join('\n');
  const v = new Tally({ ownMacs: [me] }).addText(text).view();
  const role = (mac: string) => v.devices.find((d) => d.mac === mac)?.role;
  assert.equal(role(home), 'gateway');
  assert.equal(role(office), 'gateway');
  assert.ok(v.remotes.some((r) => r.ip === '198.51.100.10'), 'the office’s hosts are out on the internet');
  assert.ok(!v.devices.find((d) => d.mac === office)?.ips.includes('198.51.100.10'), 'and not addresses of the office router');
  assert.ok(v.conversations.some((c) => c.a === `device:${me}` && c.b === 'remote:198.51.100.10'));
});

test('A way out is where frames for many hosts go: not a host with a public address, nor a device that makes them up', async () => {
  const { Tally, FIELDS } = await import('../server/tally.ts');
  const row = (f: Record<string, string>) => FIELDS.map((k) => f[k] ?? '').join('\t');
  const me = '3c:22:fb:00:00:02';
  const router = '00:1d:aa:00:00:01';
  const other = '3c:22:fb:00:00:03';
  const liar = '9a:11:22:33:44:88';
  const lines: string[] = [];
  const frame = (t: number, src: string, dst: string, ipSrc: string, ipDst: string) =>
    lines.push(row({ 'frame.time_epoch': String(t), 'frame.len': '800', 'frame.interface_name': 'eth0', 'eth.src': src, 'eth.dst': dst, 'ip.src': ipSrc, 'ip.dst': ipDst, 'ip.proto': '17', 'udp.srcport': '40000', 'udp.dstport': '443' }));
  // A network of public addresses (a university's): this PC and another, each with its own, and the router.
  for (let i = 0; i < 600; i++) {
    const host = `203.0.113.${10 + (i % 20)}`;
    frame(1000 + i, me, router, '198.51.100.20', host);
    frame(1000 + i, router, me, host, '198.51.100.20');
    frame(1000 + i, other, router, '198.51.100.21', host);
    frame(1000 + i, router, other, host, '198.51.100.21');
  }
  // A device that sends 400 frames from made-up public addresses to this PC.
  for (let i = 0; i < 400; i++) frame(2000 + i / 100, liar, me, `203.0.113.${100 + (i % 50)}`, '198.51.100.20');
  const v = new Tally({ ownMacs: [me] }).addText(lines.join('\n')).view();
  const role = (mac: string) => v.devices.find((d) => d.mac === mac)?.role;
  assert.equal(role(router), 'gateway');
  assert.equal(role(me), 'self');
  assert.equal(role(other), undefined, 'the other PC is a device');
  assert.equal(role(liar), undefined, 'the one that makes addresses up is a device');
  assert.ok(!v.remotes.some((r) => r.ip === '198.51.100.21'), 'the other PC’s address is its own, not a host out there');
});

test('A session kept before the way-out rule keeps its router a way out, when a new one gets busier', async () => {
  const { Tally, FIELDS } = await import('../server/tally.ts');
  const row = (f: Record<string, string>) => FIELDS.map((k) => f[k] ?? '').join('\t');
  const me = '3c:22:fb:00:00:04';
  const old = '00:1d:aa:00:00:44';
  const now = '24:5a:4c:00:00:44';
  const frames = (t0: number, n: number, router: string, net: string) =>
    Array.from({ length: n }, (_, i) =>
      row({ 'frame.time_epoch': String(t0 + i / 10), 'frame.len': '900', 'frame.interface_name': 'wlan0', 'eth.src': me, 'eth.dst': router, 'ip.src': '192.168.50.4', 'ip.dst': `${net}.${10 + (i % 12)}`, 'ip.proto': '6', 'tcp.srcport': '50000', 'tcp.dstport': '443' }),
    );
  const before = new Tally({ ownMacs: [me] }).addText(frames(1000, 300, old, '203.0.113').join('\n')).save();
  delete (before as { sentThrough?: unknown }).sentThrough;
  const t = Tally.load(JSON.parse(JSON.stringify(before)), { ownMacs: [me] }).addText(frames(2000, 900, now, '198.51.100').join('\n'));
  const v = t.view();
  assert.equal(v.devices.find((d) => d.mac === old)?.role, 'gateway');
  assert.equal(v.devices.find((d) => d.mac === now)?.role, 'gateway');
  assert.deepEqual(v.devices.find((d) => d.mac === old)?.ips, []);
});
