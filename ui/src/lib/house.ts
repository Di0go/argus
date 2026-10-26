// Who the home page counts as the house: the devices that can be someone using the network. Not the router (it
// carries everyone's traffic: the way out), nor this PC's Docker bridge (its containers show themselves), nor a peer
// heard only through a VPN (it is not in the house). The sentence on top and the list under it count these alike.

import type { Device, Interface } from '../../../shared/types.ts';

export function house(devices: Device[], interfaces: Interface[]): Device[] {
  const vpn = new Set(interfaces.filter((i) => i.type === 'vpn').map((i) => i.id));
  return devices.filter(
    (d) => d.role !== 'gateway' && !(d.role === 'self' && d.mac?.startsWith('02:42:')) && !(d.interfaces.length && d.interfaces.every((i) => vpn.has(i))),
  );
}
