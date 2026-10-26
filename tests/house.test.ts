// Who counts as the house on the home page (ui/src/lib/house.ts): the sentence and the list count the same devices.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Device, Interface } from '../shared/types.ts';
import { house } from '../ui/src/lib/house.ts';

const d = (id: string, extra: Partial<Device> = {}) => ({ kind: 'device', id, name: id, mac: id, ips: [], names: [], interfaces: ['wlan0'], ...extra }) as unknown as Device;
const IFACES = [
  { id: 'wlan0', type: 'wifi' },
  { id: 'wg0', type: 'vpn' },
] as Interface[];

test('The house: not the router, not the Docker bridge, not a peer heard only through the VPN', () => {
  const devices = [
    d('router', { role: 'gateway' }),
    d('pc', { role: 'self' }),
    d('bridge', { role: 'self', mac: '02:42:ac:11:00:01' }),
    d('tv'),
    d('peer', { interfaces: ['wg0'] }),
    d('both', { interfaces: ['wlan0', 'wg0'] }),
  ];
  assert.deepEqual(
    house(devices, IFACES).map((x) => x.id),
    ['pc', 'tv', 'both'],
  );
  // Interfaces not known yet: no device is taken for a VPN peer.
  assert.ok(house(devices, []).some((x) => x.id === 'peer'));
});
