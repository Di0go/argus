// The dictionary (shared/classify.ts, with its words in shared/dictionary/apps.ts and the open sources beside them):
// what it says of names, networks, ports and how the traffic goes. The names here are the big services' public ones,
// never anything of this house.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Dictionary } from '../shared/classify.ts';
import { CATEGORIES } from '../shared/dictionary/apps.ts';
import { classify, loadHouse, siteOf } from '../server/dictionary.ts';

const what = (names: string[], service?: string, protocol?: string, ip?: string) => classify({ names, service, protocol, ip });

test('The registrable part of a name, by the Public Suffix List: its rules, wildcards and exceptions', () => {
  assert.equal(siteOf('rr3---sn-apo3qxax-hp5e.googlevideo.com'), 'googlevideo.com');
  assert.equal(siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(siteOf('www.portaldasfinancas.gov.pt'), 'portaldasfinancas.gov.pt');
  assert.equal(siteOf('a.b.example.com.'), 'example.com');
  // Private suffixes: each site under one is its own.
  assert.equal(siteOf('someone.github.io'), 'someone.github.io');
  // A wildcard ("*.ck") and its exception ("!www.ck").
  assert.equal(siteOf('foo.bar.ck'), 'foo.bar.ck');
  assert.equal(siteOf('www.ck'), 'www.ck');
  assert.equal(siteOf('a.www.ck'), 'www.ck');
  // Addresses and single labels are no site.
  assert.equal(siteOf('142.250.184.14'), undefined);
  assert.equal(siteOf('2a00:1450::1'), undefined);
  assert.equal(siteOf('localhost'), undefined);
  assert.equal(siteOf('co.uk'), undefined);
});

test('By name: the most particular rule says the app; Google is many apps', () => {
  const video = what(['rr3---sn-apo3qxax-hp5e.googlevideo.com'], 'udp/443');
  assert.deepEqual([video?.company, video?.app, video?.category, video?.activity, video?.tracking], ['Google', 'YouTube', 'video', 'watching video', false]);
  assert.equal(video?.site, 'googlevideo.com');
  assert.equal(video?.by, 'name');
  assert.equal(what(['mail.google.com'])?.app, 'Gmail');
  assert.equal(what(['www.google.com'])?.category, 'search');
  assert.equal(what(['tlu.dl.delivery.mp.microsoft.com'])?.app, 'Windows Update');
  assert.equal(what(['tlu.dl.delivery.mp.microsoft.com'])?.activity, 'updating the system');
  assert.equal(what(['scontent.xx.fbcdn.net'])?.app, 'Facebook');
  assert.equal(what(['web.whatsapp.com'])?.app, 'WhatsApp');
  // Case and the root's dot do not matter.
  assert.equal(what(['WWW.NETFLIX.COM.'])?.app, 'Netflix');
});

test('Advertising, tracking and telemetry say so', () => {
  for (const n of ['www.google-analytics.com', 'securepubads.g.doubleclick.net', 'pagead2.googlesyndication.com', 'incoming.telemetry.mozilla.org', 'static.criteo.net']) {
    const c = what([n]);
    assert.equal(c?.tracking, true, n);
    assert.ok(c?.category === 'ads' || c?.category === 'telemetry', n);
  }
  assert.equal(what(['www.youtube.com'])?.tracking, false);
});

test('From the open lists alone: a service no word here names is still said, its category by the lists that include it', () => {
  // Deezer's own names come from v2fly's "deezer" list; "dzcdn.net" is only there.
  const c = what(['e-cdns-proxy-1.dzcdn.net']);
  assert.equal(c?.app, 'Deezer');
  assert.equal(c?.category, 'music');
  // A list only a category list names: its name as the app, the category from the category.
  const games = what(['www.nexusmods.com']);
  assert.equal(games?.category, 'games');
  assert.ok(games?.app);
});

test('What a particular rule leaves out, the less particular says: a connectivity check is still whose it is', () => {
  const c = what(['ping.archlinux.org']);
  assert.equal(c?.category, 'network');
  assert.equal(c?.activity, 'checking for internet');
  assert.equal(c?.company, 'Arch Linux');
});

test('A CDN or a cloud says who carries the bytes, never the app; unless its name holds its customer', () => {
  const akamai = what(['a1234.dscb.akamai.net']);
  assert.equal(akamai?.carrier, true);
  assert.equal(akamai?.company, 'Akamai');
  assert.equal(akamai?.app, undefined);
  const aws = what(['ec2-3-5-1-2.eu-west-1.compute.amazonaws.com']);
  assert.equal(aws?.carrier, true);
  assert.equal(aws?.app, undefined);
  // Spotify's audio on Akamai: the customer is in the name.
  const spotify = what(['audio-ak-spotify-com.akamaized.net']);
  assert.equal(spotify?.app, 'Spotify');
  assert.equal(spotify?.carrier, undefined);
  // Among a host's names, the one that says the app wins over the carrier's.
  assert.equal(what(['x.cloudfront.net', 'www.primevideo.com'])?.app, 'Prime Video');
});

test("By the address's network, when no name was seen: who runs it; the app only for one app's own network", () => {
  const google = what([], 'tcp/443', undefined, '142.250.184.14');
  assert.equal(google?.company, 'Google');
  assert.equal(google?.app, undefined);
  assert.equal(google?.by, 'network');
  assert.equal(google?.rule, 'AS15169');
  assert.equal(what([], 'tcp/443', undefined, '2a00:1450:4003:80f::200e')?.company, 'Google');
  assert.equal(what([], 'tcp/443', undefined, '149.154.167.51')?.app, 'Telegram');
  // A documentation address is nobody's.
  assert.equal(what([], 'tcp/443', undefined, '198.51.100.7'), undefined);
});

test('By the port, when nothing else says: DNS, NTP, mDNS, printing; and the name still wins over it', () => {
  assert.equal(what([], 'udp/53', undefined, '192.168.50.1')?.app, 'DNS');
  assert.equal(what([], 'udp/123')?.activity, 'setting the clock');
  assert.equal(what([], 'udp/5353')?.app, 'mDNS');
  assert.equal(what([], 'tcp/631')?.activity, 'printing');
  assert.equal(what([], 'tcp/8009')?.app, 'Google Cast');
  assert.equal(what([], 'tcp/49999'), undefined);
  assert.equal(what(['www.google.com'], 'tcp/443')?.app, 'Google Search');
});

test('How the traffic goes: WireGuard on 443 is a VPN; an app that calls, over STUN or UDP off the web, is a call', () => {
  const vpn = what([], 'udp/443', 'wg', '198.51.100.7');
  assert.deepEqual([vpn?.app, vpn?.category, vpn?.by], ['WireGuard', 'vpn', 'pattern']);
  // WireGuard on Tailscale's port is Tailscale.
  assert.equal(what([], 'udp/41641', 'wg')?.app, 'Tailscale');
  const call = what(['e7.whatsapp.net'], 'udp/3478', 'stun');
  assert.deepEqual([call?.app, call?.category, call?.activity], ['WhatsApp', 'calls', 'on a call']);
  assert.equal(what(['e7.whatsapp.net'], 'udp/50000')?.activity, 'on a call');
  // The same app over the web is messages, not a call.
  assert.equal(what(['e7.whatsapp.net'], 'tcp/443')?.category, 'messaging');
  assert.equal(what(['e7.whatsapp.net'], 'udp/443')?.category, 'messaging');
  // STUN with nothing that calls: a way through the router, and it does not pretend to know for what.
  const stun = what([], 'udp/3478', 'stun', '203.0.113.5');
  assert.deepEqual([stun?.app, stun?.category], ['STUN', 'network']);
});

test('Every category has its words; every word names a category', () => {
  for (const [k, c] of Object.entries(CATEGORIES)) assert.ok(c.label && c.activity, k);
  const d = new Dictionary(
    { v2fly: { domains: { 'example.org': ['made-up', 1] }, parents: {} }, psl: { rules: ['org'] }, asn: { v4: [], v6: [] } },
    { lists: { 'made-up': { company: 'Ninguém', app: 'Inventada', category: 'web' } }, domains: {}, asns: {}, ports: {}, protocols: {} },
  );
  // An @ads domain of a list is advertising, whoever the list is.
  const c = d.classify({ names: ['x.example.org'] });
  assert.deepEqual([c?.app, c?.category, c?.tracking], ['Inventada', 'ads', true]);
});

test("The house's own words go on top, checked; a category that is not one is left out and said", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'argus-casa-'));
  const file = path.join(dir, 'dicionario.json');
  writeFileSync(
    file,
    JSON.stringify({
      domains: { 'intranet.example.com': { company: 'O trabalho', app: 'Intranet', category: 'work' }, 'bad.example.com': { category: 'nada' } },
      ports: { 'tcp/8123': { app: 'Home Assistant', category: 'smart-home' } },
    }),
  );
  try {
    const r = loadHouse(file);
    assert.equal(r.entries, 2);
    assert.deepEqual(r.problems, ['domains.bad.example.com: unknown category']);
    assert.equal(what(['vpn.intranet.example.com'])?.app, 'Intranet');
    assert.equal(what([], 'tcp/8123')?.app, 'Home Assistant');
    // The dictionary's own words are still there.
    assert.equal(what(['www.netflix.com'])?.app, 'Netflix');
    // No file: nothing added, nothing said.
    assert.deepEqual(loadHouse(path.join(dir, 'none.json')), { entries: 0, problems: [] });
    assert.equal(what(['vpn.intranet.example.com']), undefined);
  } finally {
    loadHouse(path.join(dir, 'none.json'));
  }
});

test("A conversation the dictionary has no word for, with a host that has a name: its site, to be said by it", async () => {
  const { interpret } = await import('../server/interpret.ts');
  const remote = (id: string, names: string[]) => ({ kind: 'remote', id, ip: id, names: names.map((name) => ({ name, source: 'TLS' })) });
  const talk = (b: string) => ({ id: `device:d remote:${b} tcp/443`, a: 'device:d', b: `remote:${b}`, service: 'tcp/443', interfaces: [], sent: 1, received: 1, packets: 1, first: 0, last: 0 });
  const v = interpret({
    devices: [],
    remotes: [remote('203.0.113.40', ['api.unheard-of-shop.example.org']), remote('203.0.113.41', ['www.youtube.com']), remote('203.0.113.42', [])],
    conversations: [talk('203.0.113.40'), talk('203.0.113.41'), talk('203.0.113.42')],
  } as never) as unknown as { conversations: { app?: unknown; site?: string }[] };
  assert.equal(v.conversations[0]?.app, undefined);
  assert.equal(v.conversations[0]?.site, 'example.org');
  // Named by the dictionary: no site of its own; no name at all: none.
  assert.equal(v.conversations[1]?.site, undefined);
  assert.equal(v.conversations[2]?.site, undefined);
});

test('Datadog intake is telemetry, by name, over the cloud that carries it', () => {
  for (const n of ['http-intake.logs.us5.datadoghq.com', 'browser-intake-datadoghq.com']) {
    const c = what([n]);
    assert.equal(c?.company, 'Datadog', n);
    assert.equal(c?.category, 'telemetry', n);
  }
});

test('A CDN or cloud that this side mostly sent to is uploaded to, not downloaded from', async () => {
  const { interpret } = await import('../server/interpret.ts');
  const { doing } = await import('../shared/words.ts');
  const r = { kind: 'remote', id: '203.0.113.50', ip: '203.0.113.50', names: [{ name: 'd111111abcdef8.cloudfront.net', source: 'TLS' }] };
  const talk = (id: string, sent: number, received: number) => ({ id, a: 'device:d', b: 'remote:203.0.113.50', service: 'tcp/443', interfaces: [], sent, received, packets: 1, first: 0, last: 0 });
  const v = interpret({ devices: [], remotes: [r], conversations: [talk('up', 5_000_000, 100_000)] } as never) as unknown as { conversations: { app?: never }[]; remotes: { app?: never }[] };
  assert.equal(doing(v.conversations[0]?.app), 'Uploading to CloudFront');
  assert.equal(doing(v.remotes[0]?.app, 'past'), 'uploaded to CloudFront');
  const down = interpret({ devices: [], remotes: [{ ...r, names: [...r.names] }], conversations: [talk('down', 100_000, 5_000_000)] } as never) as unknown as { conversations: { app?: never }[] };
  assert.equal(doing(down.conversations[0]?.app), 'Downloading from CloudFront');
});

test("One address of a CDN that served several sites is the CDN's: one site's app is not all its bytes", () => {
  const FASTLY = '151.101.1.140';
  const one = what(['www.reddit.com'], 'tcp/443', undefined, FASTLY);
  assert.equal(one?.app, 'Reddit');
  const shared = what(['www.reddit.com', 'pypi.org', 'shop.unheard-of.example.org'], 'tcp/443', undefined, FASTLY);
  assert.equal(shared?.app, undefined);
  assert.equal(shared?.carrier, true);
  assert.equal(shared?.company, 'Fastly');
  // Several names of one site, or one company's own network: still that app.
  assert.equal(what(['www.reddit.com', 'i.redd.it', 'old.reddit.com'], 'tcp/443', undefined, FASTLY)?.app, 'Reddit');
  assert.equal(what(['www.youtube.com', 'i.ytimg.com'], 'tcp/443', undefined, '142.250.184.14')?.app, 'YouTube');
  // A site and the CDN's own name for it (its CNAME): the site's.
  assert.equal(what(['www.reddit.com', 'reddit.map.fastly.net'], 'tcp/443', undefined, FASTLY)?.app, 'Reddit');
});
