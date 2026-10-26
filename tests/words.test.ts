// What a device is doing, in a verb (shared/words.ts), and what it is (shared/identify.ts) when its clues disagree.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Classification } from '../shared/classify.ts';
import { identify } from '../shared/identify.ts';
import { doing, doingList, fromKey, keyOf } from '../shared/words.ts';

const w = (category: Classification['category'], app?: string, company?: string): Classification => ({
  category,
  label: category,
  activity: '',
  tracking: false,
  by: 'name',
  rule: '',
  ...(app ? { app } : {}),
  ...(company ? { company } : {}),
});

test('Doing, in a verb: now and in the past; a CDN names who carries, not the app', () => {
  assert.equal(doing(w('video', 'Netflix')), 'Watching Netflix');
  assert.equal(doing(w('video', 'Netflix'), 'past'), 'watched Netflix');
  assert.equal(doing(w('calls', 'WhatsApp')), 'On a WhatsApp call');
  assert.equal(doing(w('updates', 'Windows Update')), 'Updating Windows');
  assert.equal(doing({ ...w('cdn', undefined, 'Akamai'), carrier: true }), 'Downloading from Akamai');
  assert.equal(doing(undefined), 'Moving data (unknown)');
  assert.equal(doingList([w('calls', 'Google Meet'), w('work', 'npm')]), 'On a Google Meet call, using npm');
  const k = keyOf(w('music', 'Spotify', 'Spotify'));
  assert.equal(fromKey(k, (c) => c)?.app, 'Spotify');
  assert.equal(doing(fromKey(k, (c) => c)), 'Listening to Spotify');
});

test('Identity: clues that disagree leave only what they share; one weak clue is "possibly"', () => {
  // An Apple maker, but a name that says Android: the names win over the maker only if stronger; here the name is strong.
  const mixed = identify({ vendor: 'Apple, Inc.', names: [{ name: 'android-1234abcd', source: 'DHCP' }] });
  assert.equal(mixed?.os, 'Android');
  // Only the maker: an Apple device, possibly.
  const apple = identify({ vendor: 'Apple, Inc.', names: [] });
  assert.equal(apple?.label, 'Apple device');
  assert.equal(apple?.confidence, 'possibly');
  // Two strong clues that disagree on the product: neither is said.
  const both = identify({ names: [{ name: 'iPhone', source: 'DHCP' }, { name: 'Galaxy-S24', source: 'mDNS' }] });
  assert.equal(both?.product, undefined);
  // Nothing: nothing said.
  assert.equal(identify({ names: [] }), undefined);
});

test('Harmless in the clear only by the name asked for and the authorities\' own hosts (the red team\'s spoofs fail)', async () => {
  const { harmless } = await import('../shared/security.ts');
  assert.equal(harmless('HTTP', ['ocsp.attacker.example']), false);
  assert.equal(harmless('HTTP', ['pki.mybank.example']), false);
  assert.equal(harmless('HTTP', ['status.example.org']), false);
  // Nothing asked for (only DNS names for the address): never harmless.
  assert.equal(harmless('HTTP', []), false);
  assert.equal(harmless('HTTP', ['ocsp.digicert.com']), true);
  assert.equal(harmless('HTTP', ['r3.o.lencr.org']), true);
  assert.equal(harmless('HTTP', ['captive.apple.com']), true);
  // An update by the dictionary's name rule; but not a category said only by the address's network.
  assert.equal(harmless('HTTP', ['dl.google.com'], { category: 'updates', activity: 'updating', by: 'name' }), true);
  assert.equal(harmless('HTTP', ['login.example.com'], { category: 'updates', activity: 'updating', by: 'network' }), false);
  assert.equal(harmless('FTP', ['ocsp.digicert.com']), false);
});

test('Identity, the red team\'s cases: no product from a stray word, disputes never "sure", a maker alone never more than "possibly"', () => {
  const id = (f: Parameters<typeof identify>[0]) => {
    const i = identify(f);
    return i ? `${i.label} [${i.confidence}]` : 'none';
  };
  assert.equal(id({ names: [{ name: 'office-switch', source: 'DHCP' }] }), 'none');
  assert.equal(id({ names: [{ name: 'PC-Gonzalo-Techo', source: 'DHCP' }] }), 'none');
  assert.equal(id({ names: [{ name: 'Samsung-Fridge', source: 'DHCP' }], vendor: 'Samsung Electronics' }), 'Samsung device [possibly]');
  assert.equal(id({ names: [], clues: { userAgents: ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'] } }), 'Apple device [sure]');
  assert.equal(
    id({ names: [], clues: { dhcpClass: ['dhcpcd-9.4.1:Linux-6.1'], userAgents: ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'] } }),
    'iPhone [likely]',
  );
  assert.equal(id({ names: [], vendor: 'Raspberry Pi Foundation', clues: { userAgents: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)'] } }), 'Windows computer [sure]');
});

test('Identity, from a real network: a TV that offers Google Cast and AirPlay is still the LG TV it says; this PC is what its system says', () => {
  const tv = identify({
    names: [{ name: 'Living-Room-webOS-TV', source: 'mDNS' }],
    clues: { services: ['_googlecast._tcp', '_airplay._tcp'] },
  });
  assert.equal(`${tv?.label} [${tv?.confidence}]`, 'TV, LG webOS [sure]');
  const me = identify({ role: 'self', self: { os: 'Linux', laptop: true }, names: [], clues: { userAgents: ['Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'] } });
  assert.equal(`${me?.label} [${me?.confidence}]`, 'Linux laptop [sure]');
});
