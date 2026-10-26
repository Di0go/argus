// What the pages say of privacy (ui/src/lib/privacy.ts), from a source made up here: one host is one line per device,
// however many addresses or connections it answered on.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation, Device, Remote } from '../shared/types.ts';
import { privacy } from '../ui/src/lib/privacy.ts';

const device = (id: string, name: string) => ({ kind: 'device', id, name, mac: id, ips: [], names: [], interfaces: ['wlan0'] }) as unknown as Device;
const remote = (ip: string, name: string) => ({ kind: 'remote', id: ip, ip, name, names: [{ name, source: 'HTTP' }] }) as unknown as Remote;
const talk = (a: string, b: string, last: number, extra: Partial<Conversation> = {}): Conversation => ({
  id: `device:${a} remote:${b} tcp/80`,
  a: `device:${a}`,
  b: `remote:${b}`,
  service: 'tcp/80',
  interfaces: ['wlan0'],
  sent: 100,
  received: 100,
  packets: 2,
  first: last,
  last,
  clear: { proto: 'HTTP' },
  ...extra,
});

test('Without encryption: a host on two addresses (IPv4 and IPv6) is one line per device, the newest, a login first', () => {
  const pc = device('aa:aa:aa:aa:aa:01', 'laptop');
  const tv = device('aa:aa:aa:aa:aa:02', 'TV');
  const src = {
    kind: 'live',
    devices: [pc, tv],
    remotes: [remote('192.0.2.1', 'neverssl.com'), remote('2001:db8::1', 'neverssl.com'), remote('192.0.2.2', 'example.com'), remote('192.0.2.3', 'example.com')],
    sites: [],
    links: [],
    conversations: [
      talk(pc.id, '192.0.2.1', 10),
      talk(pc.id, '2001:db8::1', 20),
      talk(pc.id, '192.0.2.2', 30),
      talk(pc.id, '192.0.2.3', 5, { clear: { proto: 'HTTP', credentials: true } }),
      talk(tv.id, '192.0.2.1', 15),
    ],
  } as never;
  const p = privacy(src);
  assert.deepEqual(
    p.clear.map((l) => `${l.device?.name} ${l.other} ${l.c.last}${l.c.clear?.credentials ? ' login' : ''}`),
    ['laptop example.com 5 login', 'laptop neverssl.com 20', 'TV neverssl.com 15'],
  );
});
