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
