// The dissection, on the fixture: what it says is checked against tests/fixtures/lan.truth.json, which the fixture's
// maker worked out from the packets it built, never from what tshark or this code say.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classify, parseDumpcapList } from '../server/capture.ts';
import { dissect, isLocal, isRandomMac, isUnicastIp, shortVendor } from '../server/dissect.ts';
import { FIXTURE, fakeCapture, ROOT, TSHARK } from './helpers.ts';

const truth = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lan.truth.json'), 'utf8'));
const H = truth.hosts;
const r = await dissect(FIXTURE, { tshark: TSHARK, ownMacs: [H.me.mac] });
const byMac = (mac: string) => r.devices.find((d) => d.mac === mac);

test('Every packet and byte is counted, and each device sent exactly what the truth says', () => {
  assert.equal(r.packets, truth.packets);
  assert.equal(r.bytes, truth.bytes);
  for (const [mac, sent] of Object.entries(truth.sentByMac as Record<string, { bytes: number }>)) {
    assert.equal(byMac(mac)?.bytesSent, sent.bytes, mac);
  }
  // The broadcast and multicast addresses are not devices.
  assert.equal(r.devices.length, 7);
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
  assert.match(quiet?.name ?? '', /^Dispositivo privado/);
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

test('Addresses: local, unicast, random MACs, and makers shortened', () => {
  assert.ok(isLocal('192.168.50.5') && isLocal('10.0.0.1') && isLocal('100.101.1.1') && isLocal('fe80::1'));
  assert.ok(!isLocal('142.250.184.14') && !isLocal('2a00:1450::1') && !isLocal('172.32.0.1'));
  assert.ok(!isUnicastIp('224.0.0.251') && !isUnicastIp('192.168.50.255') && !isUnicastIp('ff02::fb') && isUnicastIp('8.8.8.8'));
  assert.ok(isRandomMac('9a:11:22:33:44:55') && !isRandomMac('3c:22:fb:ab:cd:ef'));
  assert.equal(shortVendor('Tp-Link Technologies Co.,Ltd.'), 'Tp-Link');
  assert.equal(shortVendor('Apple, Inc.'), 'Apple');
});

test('Interfaces named as he would: Wi-Fi, Cabo, Docker, VPN, Loopback, Todas; dumpcap’s list read as it prints it', async () => {
  const { sysNet } = await fakeCapture();
  assert.equal(classify('wlan0', sysNet).label, 'Wi-Fi');
  assert.deepEqual(classify('enp3s0', sysNet), { type: 'cable', label: 'Cabo', up: false });
  assert.equal(classify('docker0', sysNet).label, 'Docker');
  assert.equal(classify('tailscale0', sysNet).label, 'VPN');
  assert.equal(classify('lo', sysNet).type, 'loopback');
  assert.equal(classify('any', sysNet).label, 'Todas');
  assert.deepEqual(parseDumpcapList('1. wlan0\n5. any (Pseudo-device that captures on all interfaces)\n'), [
    { name: 'wlan0', description: undefined },
    { name: 'any', description: 'Pseudo-device that captures on all interfaces' },
  ]);
});

test('Frames one at a time add up to the same as the file read whole, and a saved session reads back the same', async () => {
  const { execFileSync } = await import('node:child_process');
  const { Tally, fieldArgs } = await import('../server/tally.ts');
  const text = execFileSync(TSHARK, ['-r', FIXTURE, ...fieldArgs()], { encoding: 'utf8' });
  const t = new Tally({ ownMacs: [H.me.mac] });
  for (const line of text.split('\n').filter(Boolean)) t.addText(line);
  assert.deepEqual(t.view(), r);
  const back = Tally.load(JSON.parse(JSON.stringify(t.save())), { ownMacs: [H.me.mac] });
  // As JSON both: on disk a missing maker and an undefined one are the same.
  assert.deepEqual(JSON.parse(JSON.stringify(back.view())), JSON.parse(JSON.stringify(r)));
  assert.deepEqual(back.fine.tail(), t.fine.tail());
});

test('Bounded: past the ceilings the conversations and devices quiet longest are forgotten', async () => {
  const { execFileSync } = await import('node:child_process');
  const { Tally, fieldArgs } = await import('../server/tally.ts');
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
