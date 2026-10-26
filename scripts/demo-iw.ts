#!/usr/bin/env node
// An iw for the demo (pnpm demo) and the tests that play it: `iw dev <iface> link` says the made-up Wi-Fi's name, as
// the demo's tshark writes it to ARGUS_DEMO_SSID_FILE (the café's, then the house's). It never asks the real Wi-Fi.

import { readFileSync } from 'node:fs';

let ssid = '';
try {
  ssid = readFileSync(process.env.ARGUS_DEMO_SSID_FILE ?? '', 'utf8').trim();
} catch {
  // Not joined yet.
}
if (!ssid) console.log('Not connected.');
else console.log(`Connected to 02:00:5e:00:00:01 (on ${process.argv[3] ?? 'wlan0'})\n\tSSID: ${ssid}\n\tfreq: 5180`);
