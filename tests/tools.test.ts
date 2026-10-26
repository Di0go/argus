// What the agent reads (server/tools.ts), from entities made up here: a device's DNS said once per kind, and the
// traffic the dictionary does not know still named by its sites.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation, Device } from '../shared/types.ts';
import { appsLine, deviceLine } from '../server/tools.ts';

test('A device that asks two servers of one resolver, and another, says each resolver once', () => {
  const d = {
    kind: 'device',
    id: 'aa:aa:aa:aa:aa:01',
    name: 'laptop',
    ips: [],
    names: [],
    interfaces: ['wlan0'],
    bytesSent: 0,
    bytesReceived: 0,
    lastSeen: 0,
    dns: [
      { kind: 'other', server: '192.0.2.1', name: 'AdGuard DNS' },
      { kind: 'other', server: '192.0.2.2', name: 'AdGuard DNS' },
      { kind: 'other', server: '192.0.2.3', name: 'Quad9' },
    ],
  } as unknown as Device;
  assert.deepEqual(deviceLine(d).dns, ['asks another resolver in the clear: AdGuard DNS, Quad9']);
});

test('Traffic the dictionary does not know is one line, with the sites it went to, busiest first', () => {
  const c = (id: string, bytes: number, site?: string): Conversation =>
    ({ id, a: 'device:d', b: `remote:${id}`, service: 'tcp/443', interfaces: [], sent: 0, received: bytes, packets: 1, first: 0, last: 0, ...(site ? { site } : {}) }) as Conversation;
  const apps = appsLine([c('1', 500, 'example.org'), c('2', 300, 'example.net'), c('3', 200, 'example.org'), c('4', 100)], 10);
  assert.equal(apps.length, 1);
  const u = apps[0] as { unknown?: string; sites?: { site: string; bytes: number }[]; bytes: number };
  assert.equal(u.bytes, 1100);
  assert.deepEqual(u.sites, [
    { site: 'example.org', bytes: 700 },
    { site: 'example.net', bytes: 300 },
  ]);
});
