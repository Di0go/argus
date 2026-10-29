// Each network apart: the fixture of a move (tests/fixtures/move.pcapng: home by Wi-Fi, a café by Wi-Fi, home again by
// cable; both networks 192.168.88.0/24 with the router at .1 and a device at .20) is read as the server reads it, and
// what each network holds is checked against move.truth.json, which the fixture's maker worked out from the frames it
// built for each place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dissect } from '../server/dissect.ts';
import { interpret } from '../server/interpret.ts';
import type { Conversation, Device, Segment } from '../shared/types.ts';
import { ROOT, TSHARK } from './helpers.ts';

const MOVE = path.join(ROOT, 'tests/fixtures/move.pcapng');
const truth = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/move.truth.json'), 'utf8'));
const H = truth.hosts;
const r = interpret(await dissect(MOVE, { tshark: TSHARK, ownMacs: truth.own }));
type Net = { id: string; name: string; interfaces: string[]; routers: string[] };
const nets = ((r as { networks?: Net[] }).networks ?? []) as Net[];
const netOf = (router: string) => nets.find((n) => n.routers.includes(router));
const devicesOn = (router: string) =>
  r.devices
    .filter((d) => netOf(router) && (d as { networks?: string[] }).networks?.includes(netOf(router)!.id))
    .map((d) => d.mac)
    .sort();

test('Two networks over one Wi-Fi, of the same addresses: each holds only its own devices, the house by cable and Wi-Fi one', () => {
  assert.equal(nets.length, 2, `two networks, home and the café, not one Wi-Fi: got ${JSON.stringify(nets.map((n) => n.name))}`);
  const home = netOf(H.homeRouter.mac);
  const cafe = netOf(H.cafeRouter.mac);
  assert.ok(home && cafe && home.id !== cafe.id);
  assert.deepEqual(home.interfaces.sort(), ['eth0', 'wlan0'], 'home by Wi-Fi and by cable is one network');
  assert.deepEqual(cafe.interfaces, ['wlan0']);
  // Every MAC each place's frames came from or went to, this PC's three among them, and no other.
  assert.deepEqual(devicesOn(H.homeRouter.mac), truth.places.home.macs);
  assert.deepEqual(devicesOn(H.cafeRouter.mac), truth.places.cafe.macs);
  // 192.168.88.20 is two devices: the TV at home, the till at the café.
  const at20 = r.devices.filter((d) => d.ips.includes('192.168.88.20'));
  assert.deepEqual(at20.map((d) => d.mac).sort(), [H.till.mac, H.tv.mac].sort());
  // Named by its router when there is no SSID, each its own.
  assert.notEqual(home.name, cafe.name);
});

test('This PC’s traffic, and its conversation with a host it reached from both, said per network', () => {
  const home = netOf(H.homeRouter.mac)!;
  const cafe = netOf(H.cafeRouter.mac)!;
  const self = r.devices.filter((d) => d.role === 'self');
  assert.deepEqual(self.map((d) => d.mac).sort(), [...truth.own].sort());
  const sum = (net: string) =>
    self.reduce(
      (n, d) => {
        const p = d.perNetwork?.[net] ?? (d.networks?.length === 1 && d.networks[0] === net ? { bytesSent: d.bytesSent, bytesReceived: d.bytesReceived } : undefined);
        return { sent: n.sent + (p?.bytesSent ?? 0), received: n.received + (p?.bytesReceived ?? 0) };
      },
      { sent: 0, received: 0 },
    );
  assert.deepEqual(sum(home.id), truth.places.home.me);
  assert.deepEqual(sum(cafe.id), truth.places.cafe.me);
  for (const [net, place] of [
    [home, 'home'],
    [cafe, 'cafe'],
  ] as const) {
    const web = r.conversations.filter((c) => c.b === `remote:${H.web.ip}` && c.network === net.id);
    assert.equal(web.reduce((n, c) => n + c.sent, 0), truth.places[place].web.sent, place);
    assert.equal(web.reduce((n, c) => n + c.received, 0), truth.places[place].web.received, place);
  }
  // Every conversation is on one network, and none mixes the two places' ends.
  for (const c of r.conversations) assert.ok(c.network === home.id || c.network === cafe.id, c.id);
});

// ---- The stays, frame by frame (server/tally.ts), and the rule over them (shared/networks.ts).

const { Tally, FIELDS } = await import('../server/tally.ts');
const { byNetwork, tell, within } = await import('../shared/networks.ts');
const row = (f: Record<string, string>) => FIELDS.map((k) => f[k] ?? '').join('\t');
const ME = '3c:a9:f4:00:00:01';
/** This PC sends a frame for a host out there through `router`, on `iface`. */
const out = (t: number, router: string, host: string, iface = 'wlan0', ipv6 = false) =>
  row({
    'frame.time_epoch': String(t),
    'frame.len': '600',
    'frame.interface_name': iface,
    'eth.src': ME,
    'eth.dst': router,
    ...(ipv6 ? { 'ipv6.src': '2001:db8:1::10', 'ipv6.dst': host } : { 'ip.src': '192.168.88.10', 'ip.dst': host }),
    'ip.proto': '6',
    'tcp.srcport': '50000',
    'tcp.dstport': '443',
  });
/** A device here announcing itself by broadcast (ARP). */
const arp = (t: number, mac: string, ip: string, iface = 'wlan0') =>
  row({ 'frame.time_epoch': String(t), 'frame.len': '60', 'frame.interface_name': iface, 'eth.src': mac, 'eth.dst': 'ff:ff:ff:ff:ff:ff', 'arp.src.hw_mac': mac, 'arp.src.proto_ipv4': ip });
const browse = (t0: number, router: string, n = 6, iface = 'wlan0') => Array.from({ length: n }, (_, i) => out(t0 + i, router, `203.0.113.${10 + i}`, iface));
const read = (t: InstanceType<typeof Tally>, listening?: string[]) => byNetwork(t.view(), { listening, now: t.last + 1 });

test('Another SSID begins another stay without a restart, and names each network; the same SSID at two routers is two', () => {
  const t = new Tally({ ownMacs: [ME] });
  const [home, cafe, other] = ['50:c7:bf:00:00:01', 'f0:9f:c2:00:00:01', '00:1d:aa:00:00:01'];
  t.ssid('wlan0', 'Willow House', 1000);
  t.addText([...browse(1000, home), arp(1003, 'f4:f5:d8:00:00:20', '192.168.88.20')].join('\n'));
  // He walks to the café: the system says another SSID before this PC sends anything there (no DHCP in sight).
  t.ssid('wlan0', 'Harbour Café', 2000);
  t.addText([...browse(2001, cafe), arp(2002, '00:1b:21:00:00:20', '192.168.88.20')].join('\n'));
  // Another café of the same chain: the same SSID, another router.
  t.addText(row({ 'frame.time_epoch': '2999', 'frame.len': '342', 'frame.interface_name': 'wlan0', 'eth.src': ME, 'eth.dst': 'ff:ff:ff:ff:ff:ff', 'ip.src': '0.0.0.0', 'ip.dst': '255.255.255.255', 'udp.srcport': '68', 'udp.dstport': '67' }));
  t.ssid('wlan0', 'Harbour Café', 3000);
  t.addText(browse(3001, other).join('\n'));
  const v = read(t, ['wlan0']);
  const names = v.networks!.map((n) => n.name);
  assert.equal(v.networks!.length, 3, JSON.stringify(names));
  assert.ok(names.includes('Willow House'));
  assert.deepEqual(names.filter((n) => n.startsWith('Harbour Café')).length, 2, 'two of one SSID, each its own');
  assert.notEqual(names.filter((n) => n.startsWith('Harbour Café'))[0], names.filter((n) => n.startsWith('Harbour Café'))[1]);
  // The one being listened on now is the latest.
  assert.deepEqual(v.networks!.filter((n) => n.now).map((n) => n.routers[0]), [other]);
  const on = (mac: string) => v.devices.find((d) => d.mac === mac)?.networks;
  assert.deepEqual(on('f4:f5:d8:00:00:20'), [v.networks!.find((n) => n.name === 'Willow House')!.id]);
  assert.notDeepEqual(on('00:1b:21:00:00:20'), on('f4:f5:d8:00:00:20'));
});

test('Two routers within one stay (IPv4 through one, IPv6 through another) are one network; a move with a fixed address is two', () => {
  const [v4, v6, next] = ['50:c7:bf:00:00:02', '24:5a:4c:00:00:02', 'f0:9f:c2:00:00:02'];
  const t = new Tally({ ownMacs: [ME] });
  const lines: string[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(out(1000 + i * 2, v4, `203.0.113.${10 + (i % 4)}`));
    lines.push(out(1001 + i * 2, v6, `2001:db8:ffff::${10 + (i % 4)}`, 'wlan0', true));
  }
  // Then, after a minute without a frame out, another router: a move, though no DHCP and no SSID said so.
  lines.push(...browse(1100, next));
  t.addText(lines.join('\n'));
  const v = read(t);
  assert.equal(v.networks!.length, 2);
  assert.deepEqual([...v.networks!.find((n) => n.routers.includes(v4))!.routers].sort(), [v4, v6].sort());
  assert.ok(!v.networks!.find((n) => n.routers.includes(next))!.routers.includes(v4));
});

test('A neighbour with a public address, sent one host’s frames, is no way out and begins no stay', () => {
  const [router, neighbour] = ['50:c7:bf:00:00:03', '3c:22:fb:00:00:03'];
  const t = new Tally({ ownMacs: [ME] });
  t.addText([...browse(1000, router), ...Array.from({ length: 30 }, (_, i) => out(1100 + i, neighbour, '198.51.100.21')), ...browse(1200, router)].join('\n'));
  const v = read(t);
  assert.equal(v.networks!.length, 1);
  assert.deepEqual(v.networks![0]!.routers, [router]);
  assert.notEqual(v.devices.find((d) => d.mac === neighbour)?.role, 'gateway');
});

test('A stay just joined, with no way out yet, says so: its traffic waits for its network', () => {
  const t = new Tally({ ownMacs: [ME] });
  t.addText([...browse(1000, '50:c7:bf:00:00:04'), row({ 'frame.time_epoch': '2000', 'frame.len': '342', 'frame.interface_name': 'wlan0', 'eth.src': ME, 'eth.dst': 'ff:ff:ff:ff:ff:ff', 'ip.src': '0.0.0.0', 'ip.dst': '255.255.255.255', 'udp.srcport': '68', 'udp.dstport': '67' }), arp(2001, '00:1b:21:00:00:44', '192.168.88.44')].join('\n'));
  const told = tell(t.view().segments!, { listening: ['wlan0'], now: 2010 });
  assert.equal(told.pending.size, 1);
  assert.ok(told.networks.find((n) => n.pending));
  // Two minutes on, still without one: a network of the Wi-Fi's own (a network without internet), no longer waited for.
  assert.equal(tell(t.view().segments!, { listening: ['wlan0'], now: 2200 }).pending.size, 0);
});

test('A session kept before stays were reads back told apart by its routers: the devices of each where they were heard', () => {
  const t = new Tally({ ownMacs: [ME] });
  const [home, office] = ['50:c7:bf:00:00:05', 'f0:9f:c2:00:00:05'];
  const lines: string[] = [];
  // Hours at home, with the TV; then the office, with a printer; the router of each sent frames for many hosts.
  for (let i = 0; i < 40; i++) lines.push(out(1000 + i * 60, home, `203.0.113.${10 + (i % 10)}`));
  lines.push(arp(1500, 'f4:f5:d8:00:00:55', '192.168.88.20'));
  for (let i = 0; i < 40; i++) lines.push(out(9000 + i * 60, office, `198.51.100.${10 + (i % 10)}`));
  lines.push(arp(9500, '00:01:e6:00:00:55', '192.168.88.20'));
  t.addText(lines.join('\n'));
  const saved = JSON.parse(JSON.stringify(t.save()));
  // As it was written before: no stays, no stay in the flows, no device's stays.
  for (const k of ['segments', 'current', 'counts', 'own']) delete saved[k];
  for (const f of saved.flows) delete f.segment;
  for (const d of saved.devices) delete d.heard;
  const v = byNetwork(Tally.load(saved, { ownMacs: [ME] }).view(), {});
  assert.equal(v.networks!.length, 2);
  const net = (router: string) => v.networks!.find((n) => n.routers.includes(router))!.id;
  assert.deepEqual(v.devices.find((d) => d.mac === 'f4:f5:d8:00:00:55')?.networks, [net(home)]);
  assert.deepEqual(v.devices.find((d) => d.mac === '00:01:e6:00:00:55')?.networks, [net(office)]);
  assert.deepEqual([...(v.devices.find((d) => d.mac === ME)?.networks ?? [])].sort(), [net(home), net(office)].sort());
  // And frames that come after it go on in the stay it was in last.
  const later = Tally.load(saved, { ownMacs: [ME] }).addText(browse(12000, office).join('\n'));
  assert.equal(byNetwork(later.view(), {}).networks!.length, 2);
});

test('One network’s view: its devices with their traffic there, its conversations, the hosts it reached with what went there', () => {
  const home = netOf(H.homeRouter.mac)!;
  const v = within(r, new Set([home.id]));
  assert.deepEqual(v.devices.map((d) => d.mac).sort(), truth.places.home.macs);
  const self = v.devices.filter((d) => d.role === 'self');
  assert.equal(self.reduce((n, d) => n + d.bytesSent, 0), truth.places.home.me.sent);
  assert.ok(!v.remotes.some((h) => h.ip === H.shop.ip), 'the café’s till paid elsewhere');
  const web = v.remotes.find((h) => h.ip === H.web.ip)!;
  assert.equal(web.bytesSent, truth.places.home.web.received);
  assert.ok(v.links.every((l) => v.devices.some((d) => `device:${d.id}` === l.from)));
});

test('One network’s view says where else a device was heard: a device is on every network it was heard on', () => {
  const home = netOf(H.homeRouter.mac)!;
  const cafe = netOf(H.cafeRouter.mac)!;
  const v = within(r, new Set([home.id]));
  for (const d of v.devices) {
    assert.deepEqual(d.networks, [home.id], `${d.mac} was listed under ${home.name} with another network`);
    assert.ok(!d.elsewhere?.includes(home.id), 'the network shown is not also one it is elsewhere on');
  }
  // In the fixture this PC changes MAC with the network: no device was at both, so none is elsewhere.
  assert.ok(v.devices.every((d) => d.elsewhere === undefined));
  // A device that was at both (the same MAC): listed at home with its home share, the café said as elsewhere.
  const p = (packets: number, bytesSent: number) => ({ packets, bytesSent, bytesReceived: 0, firstSeen: 1, lastSeen: 2 });
  const both: Device = { ...v.devices[0]!, id: 'both', networks: [cafe.id, home.id], perNetwork: { [home.id]: p(3, 300), [cafe.id]: p(5, 500) } };
  const one = within({ devices: [both], remotes: [], links: [], conversations: [] }, new Set([home.id])).devices[0]!;
  assert.deepEqual(one.elsewhere, [cafe.id]);
  assert.deepEqual(one.networks, [home.id]);
  assert.equal(one.bytesSent, 300);
  assert.equal(one.packets, 3);
  // The TV never left the house: nothing elsewhere.
  assert.equal(v.devices.find((d) => d.mac === H.tv.mac)?.elsewhere, undefined);
});

test('A device heard far outside every stay is left with no network, not guessed into one', () => {
  const dev = (id: string, lastSeen: number): Device => ({
    kind: 'device',
    id,
    name: id,
    ips: [],
    randomMac: true,
    names: [],
    interfaces: ['wlan0'],
    packets: 1,
    bytesSent: 10,
    bytesReceived: 20,
    firstSeen: lastSeen,
    lastSeen,
  });
  const segments: Segment[] = [
    { id: 'wlan0#1', iface: 'wlan0', first: 1000, last: 1100, packets: 0, bytes: 0, vias: [{ mac: '50:c7:bf:00:00:09', frames: 10, last: 1100 }] },
  ];
  const v = byNetwork({ devices: [dev('inside', 1100), dev('near', 1030), dev('far', 2000)], conversations: [], segments }, { now: 2000 });
  const net = v.networks![0]!.id;
  assert.deepEqual(v.devices.find((d) => d.id === 'inside')!.networks, [net]);
  assert.deepEqual(v.devices.find((d) => d.id === 'near')!.networks, [net], 'a minute outside a stay is near enough');
  assert.deepEqual(v.devices.find((d) => d.id === 'far')!.networks, [], 'a device heard long after is not put on the wrong network');
});

test('The day of one network: its minutes and diary only; what was kept before networks were told apart is said, not split', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createStore } = await import('@organon/core/server/store');
  const { Warnings } = await import('@organon/core/server/warnings');
  const { History } = await import('../server/history.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'argus-nets-'));
  let now = new Date(2026, 9, 25, 9, 0, 0).getTime() / 1000;
  await mkdir(path.join(dir, 'history'), { recursive: true });
  // 08:00, kept the old way: a minute without its network.
  await writeFile(path.join(dir, 'history', '2026-10-25.jsonl'), `${JSON.stringify({ t: now - 3600, a: [['device:aa', 'video|Google|YouTube|watching video||', 1000, 4_000_000]] })}\n`);
  const h = await new History({ dir: path.join(dir, 'history'), store: createStore({ dataDir: dir, warnings: new Warnings() }), now: () => now }).load();
  const VIDEO = { company: 'Google', app: 'YouTube', category: 'video', label: 'Video', activity: 'watching video', tracking: false, by: 'name', rule: 'x' } as const;
  const WORK = { company: 'Microsoft', app: 'GitHub', category: 'work', label: 'Work', activity: 'working', tracking: false, by: 'name', rule: 'x' } as const;
  const dev = (id: string, networks: string[]) => ({ kind: 'device', id, name: id, ips: [], randomMac: false, names: [], interfaces: ['wlan0'], packets: 0, bytesSent: 0, bytesReceived: 0, firstSeen: 0, lastSeen: 0, networks }) as unknown as Device;
  const talk = (a: string, network: string, n: number, app: typeof VIDEO | typeof WORK, pending = false) =>
    ({ id: `device:${a} remote:203.0.113.1 tcp/443 ${network}`, a: `device:${a}`, b: 'remote:203.0.113.1', service: 'tcp/443', interfaces: ['wlan0'], sent: n, received: 4 * n, packets: 1, first: now, last: now, app, network, ...(pending ? { pending } : {}) }) as Conversation;
  const nets = [
    { id: 'net:home', name: 'Willow House', routers: [], interfaces: ['wlan0'], first: now, last: now, bytes: 0 },
    { id: 'net:cafe', name: 'Harbour Café', routers: [], interfaces: ['wlan0'], first: now, last: now, bytes: 0 },
  ];
  // This PC at home for ten minutes on YouTube, then at the café on GitHub; the café's first look is just joined.
  await h.observe({ devices: [dev('pc', ['net:home'])], conversations: [], networks: nets });
  for (let i = 1; i <= 10; i++) {
    now += 60;
    await h.observe({ devices: [dev('pc', ['net:home'])], conversations: [talk('pc', 'net:home', i * 200_000, VIDEO)], networks: nets });
  }
  now += 60;
  await h.observe({ devices: [dev('pc', ['net:cafe'])], conversations: [talk('pc', 'net:home', 2_000_000, VIDEO), talk('pc', 'net:cafe', 300_000, WORK, true)], networks: nets });
  for (let i = 1; i <= 10; i++) {
    now += 60;
    await h.observe({ devices: [dev('pc', ['net:cafe'])], conversations: [talk('pc', 'net:home', 2_000_000, VIDEO), talk('pc', 'net:cafe', 300_000 + i * 300_000, WORK)], networks: nets });
  }
  now += 60;
  await h.flush();
  const all = await h.dayView('2026-10-25');
  const home = await h.dayView('2026-10-25', undefined, new Set(['net:home']));
  const cafe = await h.dayView('2026-10-25', undefined, new Set(['net:cafe']));
  // Each network's bytes are what grew there; together with the old minute they are the whole day.
  assert.equal(home.bytes, 10_000_000);
  assert.equal(cafe.bytes, 16_500_000, 'the café’s, its just-joined minute counted once it was known');
  assert.equal(all.bytes, home.bytes + cafe.bytes + 4_001_000);
  assert.deepEqual(all.networks.map((n) => [n.id, n.name]), [['net:cafe', 'Harbour Café'], ['net:home', 'Willow House']]);
  assert.deepEqual(home.untold?.bytes, 4_001_000);
  assert.deepEqual(home.diary.map((e) => e.what?.app), ['YouTube']);
  assert.deepEqual(cafe.diary.map((e) => e.what?.app), ['GitHub']);
  // And after a restart the names are still known.
  const again = await new History({ dir: path.join(dir, 'history'), store: createStore({ dataDir: dir, warnings: new Warnings() }), now: () => now }).load();
  assert.equal((await again.dayView('2026-10-25')).networks.find((n) => n.id === 'net:home')?.name, 'Willow House');
});
