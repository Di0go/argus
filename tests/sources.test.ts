// Where Argus finds devices besides listening (server/sources.ts): the kernel's neighbour table, the router's DHCP
// leases, and a scan of the LAN on demand. Each format is read as the program that writes it writes it; the facts
// meet and become one device (a scan knows an address before the neighbour table gives its MAC); a device the sensor
// heard gains what the router knows of it, and one it never heard is added as found, on the network its interface was
// on when it was found there, or on none: never on the network of now because it is now.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDnsmasq, parseIsc, parseNeigh, parseNmapXml, Sources } from '../server/sources.ts';
import { networkAt, tell, within } from '../shared/networks.ts';
import type { Device, Segment } from '../shared/types.ts';

const TV = 'f4:f5:d8:00:00:20';
const SPEAKER = '00:1b:21:00:00:30';
const HOME_ROUTER = '50:c7:bf:00:00:01';
const CAFE_ROUTER = '00:1b:21:00:00:02';
const NOW = 1_800_000_000;

/** A Sources over what a test gives it: no clock, no commands, no real LAN. */
async function reading(o: {
  neigh?: boolean;
  neighText?: string;
  lease?: string;
  scan?: boolean;
  now?: () => number;
  own?: () => { macs: string[]; ips: string[] };
  run?: (cmd: string, args: string[]) => Promise<string>;
} = {}): Promise<Sources> {
  let leases: string[] = [];
  if (o.lease !== undefined) {
    const dir = await mkdtemp(path.join(tmpdir(), 'argus-sources-'));
    const file = path.join(dir, 'dnsmasq.leases');
    await writeFile(file, o.lease);
    leases = [file];
  }
  const s = await new Sources({
    neigh: o.neigh ?? false,
    scan: o.scan ?? false,
    leases,
    now: o.now ?? (() => NOW),
    own: o.own ?? (() => ({ macs: [], ips: [] })),
    run: o.run ?? (async (cmd, args) => (cmd === 'ip' && args[0] === 'neigh' ? (o.neighText ?? '') : '')),
  }).load();
  s.stop();
  return s;
}

const device = (mac: string, over: Partial<Device> = {}): Device => ({
  kind: 'device',
  id: mac,
  mac,
  name: mac,
  ips: [],
  randomMac: false,
  names: [],
  interfaces: ['wlan0'],
  packets: 0,
  bytesSent: 0,
  bytesReceived: 0,
  firstSeen: NOW - 60,
  lastSeen: NOW,
  ...over,
});

test('A dnsmasq lease file, an ISC one, the neighbour table and an nmap scan: each read as its program writes it', () => {
  assert.deepEqual(
    parseDnsmasq(
      [
        `${NOW + 3600} ${TV} 192.168.88.20 living-room-tv *`,
        `0 ${SPEAKER} 192.168.88.30 * *`,
        'not a lease at all',
        `bad-mac 192.168.88.40 ignored *`,
      ].join('\n'),
    ),
    [
      { mac: TV, ip: '192.168.88.20', hostname: 'living-room-tv', expires: NOW + 3600 },
      { mac: SPEAKER, ip: '192.168.88.30' },
    ],
  );
  assert.deepEqual(
    parseIsc(
      [
        'lease 192.168.88.20 {',
        '  starts 1 2026/10/26 10:00:00;',
        `  hardware ethernet ${TV};`,
        '  client-hostname "living-room-tv";',
        '}',
        'lease 192.168.88.21 {',
        '  starts 1 2026/10/26 10:00:00;',
        '}',
      ].join('\n'),
    ),
    [{ mac: TV, ip: '192.168.88.20', hostname: 'living-room-tv' }],
  );
  assert.deepEqual(
    parseNeigh(
      [
        `192.168.88.20 dev wlan0 lladdr ${TV} REACHABLE`,
        `192.168.88.21 dev wlan0 lladdr ${SPEAKER} STALE`,
        '192.168.88.22 dev wlan0  FAILED',
        `fe80::20 dev wlan0 lladdr ${TV} router`,
        `169.254.1.1 dev eth0 lladdr ${TV} STALE`,
      ].join('\n'),
    ),
    [
      { ip: '192.168.88.20', iface: 'wlan0', mac: TV, state: 'REACHABLE' },
      { ip: '192.168.88.21', iface: 'wlan0', mac: SPEAKER, state: 'STALE' },
    ],
  );
  assert.deepEqual(
    parseNmapXml(
      [
        '<?xml version="1.0"?><nmaprun>',
        '<host><status state="up"/><address addr="192.168.88.20" addrtype="ipv4"/><hostnames><hostname name="living-room-tv.lan"/></hostnames></host>',
        '<host><status state="down"/><address addr="192.168.88.21" addrtype="ipv4"/></host>',
        '<host><status state="up"/><address addr="fe80::20" addrtype="ipv6"/></host>',
        '</nmaprun>',
      ].join(''),
    ),
    [{ ip: '192.168.88.20', hostname: 'living-room-tv.lan' }],
  );
});

test('The neighbour table and a lease that name one address become one device: the MAC, the address and the name', async () => {
  const s = await reading({
    neigh: true,
    neighText: [`192.168.88.20 dev wlan0 lladdr ${TV} REACHABLE`, `192.168.88.21 dev wlan0 lladdr ${SPEAKER} STALE`].join('\n'),
    lease: `${NOW + 3600} ${TV} 192.168.88.20 living-room-tv *`,
  });
  const found = s.devices();
  assert.equal(found.length, 2);
  const tv = found.find((d) => d.mac === TV)!;
  assert.equal(tv.ip, '192.168.88.20');
  assert.equal(tv.hostname, 'living-room-tv');
  assert.deepEqual([...tv.origins].sort(), ['neigh', 'router']);
  const speaker = found.find((d) => d.mac === SPEAKER)!;
  assert.equal(speaker.hostname, undefined);
  assert.deepEqual(speaker.origins, ['neigh']);
  // STALE is a MAC the kernel still remembers, not one it has just used: kept, but older.
  assert.ok(tv.lastSeen > speaker.lastSeen);
  assert.equal(s.status().find((x) => x.id === 'neigh')?.found, 2);
  assert.equal(s.status().find((x) => x.id === 'leases')?.found, 1);
});

const NMAP = (...ips: string[]) =>
  `<?xml version="1.0"?><nmaprun>${ips.map((ip) => `<host><status state="up"/><address addr="${ip}" addrtype="ipv4"/></host>`).join('')}</nmaprun>`;

test('A scan of the LAN: nmap on the interface’s /24 at most, and the MACs its ARP left in the neighbour table; nothing else is sent', async () => {
  const calls: string[] = [];
  const s = await reading({
    scan: true,
    run: async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      // A /16: 65 534 addresses. The scan keeps to the /24 this PC is in.
      if (cmd === 'ip' && args.includes('addr')) return '2: wlan0    inet 10.20.30.10/16 brd 10.20.255.255 scope global wlan0';
      if (cmd === 'nmap') return NMAP('10.20.30.20', '10.20.30.30');
      // Asked of one interface, ip leaves it out of each line, as the real one does.
      if (cmd === 'ip' && args[0] === 'neigh') return [`10.20.30.20 lladdr ${TV} REACHABLE`, `10.20.30.30 lladdr ${SPEAKER} REACHABLE`].join('\n');
      return '';
    },
  });
  const scan = (await s.scan({ iface: 'wlan0' })).find((x) => x.id === 'scan')!;
  assert.equal(scan.last, NOW);
  assert.equal(scan.found, 2);
  assert.equal(scan.error, undefined);
  assert.deepEqual(
    calls.filter((c) => !c.startsWith('ip ')),
    ['nmap -sn -T4 --max-retries 1 --host-timeout 5s -oX - 10.20.30.0/24'],
    'one nmap -sn over the /24, and no other command that sends',
  );
  assert.deepEqual(
    s.devices().map((d) => [d.ip, d.mac]).sort(),
    [
      ['10.20.30.20', TV],
      ['10.20.30.30', SPEAKER],
    ],
  );
  // On a /24 or narrower, the interface's own.
  const narrow = await reading({ scan: true, run: async (cmd, args) => (cmd === 'ip' && args.includes('addr') ? 'inet 192.168.88.10/25 brd' : cmd === 'nmap' ? NMAP() : '') });
  const asked: string[] = [];
  const spy = await reading({
    scan: true,
    run: async (cmd, args) => {
      asked.push(args.at(-1)!);
      return cmd === 'ip' && args.includes('addr') ? 'inet 192.168.88.10/25 brd' : cmd === 'nmap' ? NMAP() : '';
    },
  });
  await narrow.scan({ iface: 'wlan0' });
  await spy.scan({ iface: 'wlan0' });
  assert.ok(asked.includes('192.168.88.10/25'));
});

test('A device the sensor heard gains the lease’s name and the sources’ marks, and keeps its own times: being in a table is not being heard', async () => {
  const s = await reading({
    neigh: true,
    neighText: `192.168.88.20 dev wlan0 lladdr ${TV} REACHABLE`,
    lease: `${NOW + 3600} ${TV} 192.168.88.20 living-room-tv *`,
  });
  const tv = device(TV, { ips: ['192.168.88.20'], packets: 10, bytesSent: 1000, bytesReceived: 2000, firstSeen: NOW - 900, lastSeen: NOW - 600, networks: ['net:x'] });
  s.attach({ devices: [tv] });
  assert.equal(tv.name, 'living-room-tv');
  assert.deepEqual(tv.names, [{ name: 'living-room-tv', source: 'DHCP' }]);
  assert.deepEqual([...tv.origin!].sort(), ['neigh', 'router']);
  assert.equal(tv.foundOnly, undefined);
  assert.equal(tv.lastSeen, NOW - 600, 'quiet for ten minutes is still quiet, whatever the kernel remembers');
  assert.equal(tv.firstSeen, NOW - 900);
  assert.deepEqual(tv.interfaces, ['wlan0']);
});

test('His case: a device found at home is not shown at the café, and one found while nothing was listened on is on no network', async () => {
  // Home on wlan0 until NOW-600, then the café on the same wlan0 from NOW-500.
  const segments: Segment[] = [
    { id: 'wlan0#1', iface: 'wlan0', first: NOW - 2000, last: NOW - 600, packets: 0, bytes: 0, vias: [{ mac: HOME_ROUTER, frames: 10, last: NOW - 600 }] },
    { id: 'wlan0#2', iface: 'wlan0', first: NOW - 500, last: NOW, packets: 0, bytes: 0, vias: [{ mac: CAFE_ROUTER, frames: 10, last: NOW }] },
  ];
  const told = tell(segments);
  const home = told.of.get('wlan0#1')!;
  const cafe = told.of.get('wlan0#2')!;
  assert.notEqual(home, cafe);
  let t = NOW - 700;
  // At home the kernel knew the TV; then the PC moved, the table was flushed, and a scan at the café found the speaker.
  const s = await reading({
    neigh: true,
    scan: true,
    now: () => t,
    run: async (cmd, args) => {
      if (cmd === 'ip' && args[0] === 'neigh') return t < NOW - 600 ? `192.168.88.20 dev wlan0 lladdr ${TV} REACHABLE` : `192.168.88.30 dev wlan0 lladdr ${SPEAKER} REACHABLE`;
      if (cmd === 'ip' && args.includes('addr')) return 'inet 192.168.88.10/24 brd';
      if (cmd === 'nmap') return NMAP('192.168.88.30');
      return '';
    },
  });
  t = NOW;
  await s.scan({ iface: 'wlan0' });
  // And one more, by a lease, on an interface that was never listened on.
  const v = s.attach({ devices: [] as Device[] }, networkAt(segments, told.of));
  const tv = v.devices.find((d) => d.mac === TV)!;
  const speaker = v.devices.find((d) => d.mac === SPEAKER)!;
  assert.deepEqual(tv.networks, [home], 'the TV was found while the PC was at home');
  assert.deepEqual(speaker.networks, [cafe]);
  assert.ok(v.devices.every((d) => d.foundOnly));
  const at = (id: string) => within({ devices: v.devices, remotes: [], links: [], conversations: [] }, new Set([id])).devices.map((d) => d.mac);
  assert.deepEqual(at(cafe), [SPEAKER], 'with the café chosen, the TV of home is not in the list');
  assert.deepEqual(at(home), [TV]);

  // Found where no stay was listened on: no network, so in no network's list and only with every network.
  const away = await reading({ neigh: true, neighText: `192.168.88.40 dev eth0 lladdr ${SPEAKER} REACHABLE` });
  const w = away.attach({ devices: [] as Device[] }, networkAt(segments, told.of));
  assert.deepEqual(w.devices[0]!.networks, []);
  assert.deepEqual(within({ devices: w.devices, remotes: [], links: [], conversations: [] }, new Set([home, cafe])).devices, []);
});

test('This PC is never reported as another device; a scan turned off refuses, and one with no address on the interface says why', async () => {
  const own = { macs: [TV.toUpperCase()], ips: ['192.168.88.10'] };
  const s = await reading({
    neigh: true,
    neighText: [`192.168.88.20 dev wlan0 lladdr ${TV} REACHABLE`, `192.168.88.10 dev wlan0 lladdr ${SPEAKER} REACHABLE`].join('\n'),
    own: () => own,
  });
  assert.deepEqual(s.devices(), []);
  assert.deepEqual(s.attach({ devices: [] as Device[] }).devices, [], 'the MAC and the address of this machine are not devices of the LAN');

  const off = await reading({ neigh: false });
  await assert.rejects(() => off.scan({ iface: 'wlan0' }), /turned off/);

  const noAddress = await reading({ scan: true, run: async () => '' });
  assert.match((await noAddress.scan({ iface: 'wlan0' })).find((x) => x.id === 'scan')!.error ?? '', /No IPv4 address on wlan0/);
});
