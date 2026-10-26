// Hosts that never said a name (docs/dicionario.md, "Hosts with no name"): Tailscale's relays by how they are talked
// to, the public resolvers by their address, a peer by its port, a host by its named neighbours. Every address here is
// made up, from the documentation ranges, in made-up networks (AS64500–64502, as tests/fixtures/geo.tsv).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../server/dictionary.ts';
import { interpret } from '../server/interpret.ts';
import type { Classification } from '../shared/classify.ts';
import { doing } from '../shared/words.ts';

/** A geo table of three made-up networks: 198.51.100.0/24 and 2001:db8::/32 are a host's, 203.0.113.0/24 another's. */
const geo = {
  where: (ip: string) => (ip.startsWith('198.51.100.') || ip.startsWith('2001:db8:') ? { asn: 64501, org: 'DOC-NET' } : ip.startsWith('203.0.113.') ? { asn: 64500, org: 'EXAMPLE-NET' } : undefined),
} as never;

type Read = { remotes: { ip: string; app?: Classification }[]; conversations: { b: string; app?: Classification }[] };

const remote = (ip: string, names: string[] = [], source = 'TLS') => ({ kind: 'remote', id: ip, ip, names: names.map((name) => ({ name, source })), bytesSent: 1, bytesReceived: 1, packets: 1, firstSeen: 0, lastSeen: 0 });
const talk = (a: string, ip: string, service?: string, protocol?: string) => ({
  id: `${a} remote:${ip} ${service ?? ''}`,
  a,
  b: `remote:${ip}`,
  ...(service ? { service } : {}),
  ...(protocol ? { protocol } : {}),
  interfaces: [],
  sent: 100,
  received: 100,
  packets: 2,
  first: 0,
  last: 0,
});
const read = (remotes: object[], conversations: object[]) => interpret({ devices: [], remotes, conversations } as never, { geo }) as unknown as Read;
const host = (v: Read, ip: string) => v.remotes.find((h) => h.ip === ip)?.app;

test("Tailscale's relay by its name: the VPN's relay, surely", () => {
  const c = classify({ names: ['derp4c.tailscale.com'] });
  assert.equal(c?.app, 'Tailscale');
  assert.equal(c?.activity, 'through a relay of the VPN (DERP)');
  assert.equal(c?.confidence, undefined);
  // Its other names are Tailscale, not a relay.
  assert.equal(classify({ names: ['controlplane.tailscale.com'] })?.activity, 'through the VPN');
  assert.equal(classify({ names: ['log.tailscale.com'] })?.category, 'telemetry');
});

test("A relay that never said its name: STUN from a device running Tailscale, in a network where its named relay is, is likely Tailscale's", () => {
  const PC = 'device:pc';
  const v = read(
    [remote('198.51.100.10', ['derp99a.tailscale.com']), remote('198.51.100.20'), remote('2001:db8:5::20'), remote('198.51.100.30'), remote('203.0.113.40'), remote('198.51.100.50')],
    [
      talk(PC, '198.51.100.10', 'tcp/443', 'tls'),
      // The relay asked the way through the router, how far it is (HTTP on 80), and a ping with no service.
      talk(PC, '198.51.100.20', 'udp/3478', 'stun'),
      talk(PC, '198.51.100.20', 'tcp/80', 'http'),
      talk(PC, '198.51.100.20'),
      talk(PC, '2001:db8:5::20', 'udp/3478', 'stun'),
      // In the same network, but not only that way: something else on that host, not said.
      talk(PC, '198.51.100.30', 'udp/3478', 'stun'),
      talk(PC, '198.51.100.30', 'tcp/22'),
      // STUN in another network, where no relay of Tailscale's was named: a call's, a game's; not said.
      talk(PC, '203.0.113.40', 'udp/3478', 'stun'),
      // A device that does not run Tailscale: its STUN is not Tailscale's.
      talk('device:tv', '198.51.100.50', 'udp/3478', 'stun'),
    ],
  );
  for (const ip of ['198.51.100.20', '2001:db8:5::20']) {
    const app = host(v, ip);
    assert.equal(app?.app, 'Tailscale', ip);
    assert.equal(app?.activity, 'through a relay of the VPN (DERP)');
    assert.equal(app?.confidence, 'likely');
    assert.match(app?.rule ?? '', /derp99a\.tailscale\.com/);
    assert.equal(doing(app), 'Through Tailscale');
  }
  const stun = v.conversations.find((c) => c.b === 'remote:198.51.100.20' && c.app?.activity.includes('STUN'));
  assert.equal(stun?.app?.app, 'Tailscale');
  assert.equal(stun?.app?.confidence, 'likely');
  // Not by how they are talked to; beside the named relay, possibly (the neighbours' rule, below).
  for (const ip of ['198.51.100.30', '198.51.100.50']) {
    assert.equal(host(v, ip)?.by, 'neighbour', ip);
    assert.equal(host(v, ip)?.confidence, 'possibly', ip);
  }
  assert.equal(host(v, '203.0.113.40'), undefined);
  // No relay of Tailscale's named at all: nothing to say where its relays are, so nothing is said.
  const none = read([remote('198.51.100.20'), remote('203.0.113.60', ['controlplane.tailscale.com'])], [talk(PC, '203.0.113.60', 'tcp/443'), talk(PC, '198.51.100.20', 'udp/3478', 'stun')]);
  assert.equal(host(none, '198.51.100.20'), undefined);
});

test("A netcheck: STUN to a great many hosts with no name in the same seconds is Tailscale's relays, likely, whoever asks", () => {
  const many = Array.from({ length: 24 }, (_, i) => `203.0.113.${100 + i}`);
  const at = (c: object, first: number) => ({ ...c, first, last: first + 1 });
  const v = read(
    [...many.map((ip) => remote(ip)), remote('198.51.100.200'), remote('198.51.100.201')],
    [
      ...many.map((ip, i) => at(talk('device:pc', ip, 'udp/3478', 'stun'), 1000 + (i % 3))),
      // A call's relay, by address, minutes later: not part of it.
      at(talk('device:pc', '198.51.100.200', 'udp/3478', 'stun'), 1400),
      // A host asked in the same seconds, but also for something else: not a relay.
      at(talk('device:pc', '198.51.100.201', 'udp/3478', 'stun'), 1001),
      at(talk('device:pc', '198.51.100.201', 'tcp/8443'), 1001),
    ],
  );
  for (const ip of many) {
    assert.equal(host(v, ip)?.activity, 'through a relay of the VPN (DERP)', ip);
    assert.equal(host(v, ip)?.confidence, 'likely');
    assert.match(host(v, ip)?.rule ?? '', /to 24 hosts with no name in the same seconds/);
  }
  assert.equal(host(v, '198.51.100.200'), undefined);
  assert.equal(host(v, '198.51.100.201'), undefined);
  // A few at once, from a device not known to run Tailscale: a call or a game; nothing said.
  const few = read(many.slice(0, 10).map((ip) => remote(ip)), many.slice(0, 10).map((ip) => at(talk('device:pc', ip, 'udp/3478', 'stun'), 1000)));
  assert.equal(host(few, many[0]!), undefined);
  // The same few from a device that runs Tailscale (a peer on its port): its netcheck.
  const ours = read([...many.slice(0, 10).map((ip) => remote(ip)), remote('203.0.113.250')], [talk('device:pc', '203.0.113.250', 'udp/41641'), ...many.slice(0, 10).map((ip) => at(talk('device:pc', ip, 'udp/3478', 'stun'), 1000))]);
  assert.equal(host(ours, many[0]!)?.app, 'Tailscale');
});

test('The public resolvers by their address: DNS, and over 443 or 853 encrypted DNS', () => {
  const plain = classify({ ip: '94.140.14.14', service: 'udp/53' });
  assert.equal(plain?.app, 'AdGuard DNS');
  assert.equal(plain?.company, 'AdGuard');
  assert.equal(plain?.activity, 'looking up names (DNS)');
  assert.equal(classify({ ip: '9.9.9.9', service: 'tcp/853' })?.activity, 'looking up names (encrypted DNS)');
  assert.equal(classify({ ip: '8.8.8.8', service: 'tcp/443' })?.app, 'Google DNS');
  // The host itself, with no service: the resolver.
  assert.equal(classify({ ip: '1.1.1.1' })?.app, 'Cloudflare DNS');
  // Its name, when one was seen, still says it first.
  assert.equal(classify({ names: ['one.one.one.one'], ip: '1.1.1.1', service: 'tcp/443' })?.app, 'Cloudflare DNS');
});

test("A host with no name whose every conversation says one company's app by its port: that app, a peer of Tailscale", () => {
  const v = read(
    [remote('203.0.113.60'), remote('203.0.113.61'), remote('203.0.113.62')],
    [
      talk('device:pc', '203.0.113.60', 'udp/41641'),
      talk('device:pc', '203.0.113.60'),
      // One says Tailscale, another nothing: not said.
      talk('device:pc', '203.0.113.61', 'udp/41641'),
      talk('device:pc', '203.0.113.61', 'tcp/8443'),
      // A service alone is not whose it is.
      talk('device:pc', '203.0.113.62', 'udp/3478', 'stun'),
    ],
  );
  assert.equal(host(v, '203.0.113.60')?.app, 'Tailscale');
  assert.equal(host(v, '203.0.113.60')?.activity, 'the VPN, peer to peer');
  assert.equal(host(v, '203.0.113.61'), undefined);
  assert.equal(host(v, '203.0.113.62'), undefined);
  // STUN on a cloud's address is said with the cloud's name ("AWS · STUN"): still a service, not whose the host is.
  const cloud = read([remote('3.5.0.1')], [talk('device:tv', '3.5.0.1', 'udp/3478', 'stun')]);
  assert.equal(host(cloud, '3.5.0.1')?.carrier, true);
});

test("Spotify's own port, on a cloud: likely Spotify, and its company, not the cloud's", () => {
  const c = classify({ ip: '35.190.0.1', service: 'tcp/4070' });
  assert.equal(c?.app, 'Spotify');
  assert.equal(c?.company, 'Spotify');
  assert.equal(c?.confidence, 'likely');
});

test('A host with no name beside named hosts of one company, in the same /24 or /64 and network: possibly theirs', () => {
  const v = read(
    [
      remote('203.0.113.70', ['api.spotify.com']),
      remote('203.0.113.71'),
      remote('2001:db8:7:1::a', ['log.tailscale.com'], 'DNS'),
      remote('2001:db8:7:1:0:0:0:b'),
      // Another /64: not a neighbour.
      remote('2001:db8:7:2::c'),
    ],
    [talk('device:pc', '203.0.113.71', 'tcp/443', 'tls'), talk('device:pc', '2001:db8:7:1::b', 'tcp/443'), talk('device:pc', '2001:db8:7:2::c', 'tcp/443')],
  );
  const spotify = host(v, '203.0.113.71');
  assert.equal(spotify?.company, 'Spotify');
  assert.equal(spotify?.confidence, 'possibly');
  assert.equal(spotify?.by, 'neighbour');
  assert.match(spotify?.rule ?? '', /203\.0\.113\.70 \(api\.spotify\.com\)/);
  assert.equal(host(v, '2001:db8:7:1:0:0:0:b')?.company, 'Tailscale');
  assert.equal(host(v, '2001:db8:7:2::c'), undefined);
  // Its conversations are not given a "possibly": the history keeps only what is surer.
  assert.notEqual(v.conversations[0]?.app?.company, 'Spotify');

  // Neighbours of two companies: nothing said.
  const two = read([remote('203.0.113.80', ['api.spotify.com']), remote('203.0.113.81', ['www.netflix.com']), remote('203.0.113.82')], []);
  assert.equal(host(two, '203.0.113.82'), undefined);
  // A network the geo table does not know: no neighbours said.
  const unknown = read([remote('192.0.2.90', ['api.spotify.com']), remote('192.0.2.91')], []);
  assert.equal(host(unknown, '192.0.2.91'), undefined);
});
