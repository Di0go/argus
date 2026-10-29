#!/usr/bin/env node
// An nmap for the demo (pnpm demo): `nmap -sn … -oX -` answers for the made-up house, sends nothing, and leaves a mark
// (ARGUS_DEMO_SSID_FILE.scanned) so the demo's ip (scripts/demo-ip.ts) knows the MACs the scan's ARP would have left.

import { writeFileSync } from 'node:fs';

const UP: [string, string?][] = [['192.168.50.1'], ['192.168.50.31', 'living-room-tv.lan'], ['192.168.50.61', 'plug-hall.lan'], ['192.168.50.62', 'nas.lan']];
writeFileSync(`${process.env.ARGUS_DEMO_SSID_FILE}.scanned`, '');
console.log(
  `<?xml version="1.0"?><nmaprun>${UP.map(([ip, name]) => `<host><status state="up"/><address addr="${ip}" addrtype="ipv4"/>${name ? `<hostnames><hostname name="${name}"/></hostnames>` : ''}</host>`).join('')}</nmaprun>`,
);
