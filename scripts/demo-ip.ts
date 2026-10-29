#!/usr/bin/env node
// An ip for the demo (pnpm demo): `ip neigh show` and `ip -o -4 addr show dev <iface>` for the made-up house, never the
// real ones. At the café the table is empty (the demo's café is over before a look); at home it holds the router, and
// after a scan (scripts/demo-nmap.ts) the devices that answered it, two of them never heard: a smart plug and a NAS.

import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
let ssid = '';
try {
  ssid = readFileSync(process.env.ARGUS_DEMO_SSID_FILE ?? '', 'utf8').trim();
} catch {
  // Not joined yet.
}
const home = ssid && !/caf/i.test(ssid);
if (args.includes('addr')) {
  if (home) console.log('3: wlan0    inet 192.168.50.10/24 brd 192.168.50.255 scope global dynamic wlan0');
} else if (args[0] === 'neigh' && home) {
  const lines = ['192.168.50.1 dev wlan0 lladdr 50:c7:bf:12:34:56 REACHABLE'];
  if (existsSync(`${process.env.ARGUS_DEMO_SSID_FILE}.scanned`))
    lines.push(
      '192.168.50.31 dev wlan0 lladdr f4:f5:d8:c0:ff:ee REACHABLE',
      '192.168.50.61 dev wlan0 lladdr 24:0a:c4:5e:b0:61 REACHABLE',
      '192.168.50.62 dev wlan0 lladdr 00:11:32:5e:b0:62 REACHABLE',
    );
  console.log(lines.join('\n'));
}
