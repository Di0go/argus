#!/usr/bin/env node
// A tshark for tests/browser.test.ts: asked to listen, it says two devices with names as long as the network allows
// (DHCP and mDNS names are up to 255 characters, cut at 100 by the tally), and waits. Asked anything else, the real one.
import { FIELDS, SEP } from '../../server/tally.ts';
const a = process.argv.slice(2);
if (!a.includes('-i')) { const { spawnSync } = await import('node:child_process'); process.exit(spawnSync('tshark', a, { stdio: 'inherit' }).status ?? 1); }
const row = (f: Record<string, string>) => FIELDS.map((k) => f[k] ?? '').join('\t');
const now = () => String(Date.now() / 1000);
const long = 'A-printer-with-a-name-so-long-that-nobody-would-ever-type-it-' + 'x'.repeat(240);
console.log(row({ 'frame.time_epoch': now(), 'frame.len': '342', 'eth.src': '9a:11:22:33:44:77', 'eth.dst': 'ff:ff:ff:ff:ff:ff', 'dhcp.hw.mac_addr': '9a:11:22:33:44:77', 'dhcp.option.hostname': long }));
console.log(row({ 'frame.time_epoch': now(), 'frame.len': '420', 'eth.src': '00:04:3c:11:22:33', 'eth.dst': '01:00:5e:00:00:fb', 'ip.src': '192.168.50.32', 'ip.dst': '224.0.0.251', 'dns.flags.response': '1', 'dns.resp.name': 'abc.local', 'dns.resp.type': '1', 'dns.txt': ['fn=' + 'Speaker'.repeat(40), 'md=Sonos'].join(SEP) }));
setInterval(() => {}, 1000);
