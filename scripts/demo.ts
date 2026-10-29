// pnpm demo: Argus with a made-up house instead of a capture (scripts/demo-tshark.ts), for a look without the
// capture permissions, and for the README's pictures. Its own data in .demo/, its own port (4950), the Wi-Fi and
// Docker's bridge turned on at start; on the Wi-Fi a café first, then the house (two networks, each its own, named by
// a made-up SSID that scripts/demo-iw.ts says); the neighbour table, a scan of the LAN and the router made up too
// (scripts/demo-ip.ts, scripts/demo-nmap.ts, tests/fake-router.ts, whose password is DEMO_ROUTER_PASSWORD below): nothing
// touches the network.
//
//   pnpm demo          then http://localhost:4950

import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fakeRouter } from '../tests/fake-router.ts';
import { fakeCapture } from '../tests/helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = process.env.ARGUS_DEMO_PORT ?? '4950';
const DEMO = path.join(ROOT, '.demo');
const tshark = path.join(ROOT, 'scripts/demo-tshark.ts');
const iw = path.join(ROOT, 'scripts/demo-iw.ts');
const ip = path.join(ROOT, 'scripts/demo-ip.ts');
const nmap = path.join(ROOT, 'scripts/demo-nmap.ts');
for (const f of [tshark, iw, ip, nmap]) chmodSync(f, 0o755);
const ssidFile = path.join(DEMO, 'ssid');
rmSync(ssidFile, { force: true });
rmSync(`${ssidFile}.scanned`, { force: true });
rmSync(path.join(DEMO, 'router-keys.json'), { force: true });
mkdirSync(path.join(DEMO, 'data'), { recursive: true });
mkdirSync(path.join(DEMO, 'state'), { recursive: true });
// A key log as the browsers write one, made up: the demo's HTTPS is read (scripts/demo-tshark.ts), and the page says from where.
const keys = path.join(DEMO, 'tls-keys.log');
writeFileSync(keys, '# made up for the demo: no real key\n');
const fake = await fakeCapture();
/** The made-up router's password, to type on the Scan page. */
const DEMO_ROUTER_PASSWORD = 'willow-demo';
const router = await fakeRouter({ password: DEMO_ROUTER_PASSWORD });

const server = spawn(process.execPath, ['server/index.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ARGUS_INSTANCE: 'dev',
    ARGUS_PORT: PORT,
    ARGUS_DATA_DIR: path.join(DEMO, 'data'),
    ARGUS_STATE_DIR: path.join(DEMO, 'state'),
    ARGUS_TSHARK: tshark,
    ARGUS_DUMPCAP: fake.dumpcap,
    ARGUS_SYS_NET: fake.sysNet,
    // Where the data goes, for the made-up hosts: a made-up table of networks (documentation ranges and AS numbers).
    ARGUS_GEO_FILE: path.join(ROOT, 'scripts/demo-geo.tsv'),
    // The Wi-Fi's name, made up: the café's, then the house's (never the real one's).
    ARGUS_IW: iw,
    ARGUS_DEMO_SSID_FILE: ssidFile,
    // The other sources (server/sources.ts), on the made-up house: its neighbour table, and a scan when asked.
    ARGUS_IP: ip,
    ARGUS_NMAP: nmap,
    ARGUS_NEIGH: '1',
    ARGUS_SCAN: '1',
    ARGUS_ROUTER: '1',
    ARGUS_ROUTER_URL: router.base,
    ARGUS_ROUTER_KEYS: path.join(DEMO, 'router-keys.json'),
    ARGUS_LEASES: 'none',
    ARGUS_TLS_KEYLOG: keys,
    ARGUS_SOURCES_MS: '3000',
  },
});
for (const iface of ['wlan0', 'docker0'])
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/live/${iface}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: true }),
      });
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
console.log(`\n  Argus, the demo: http://localhost:${PORT}  (a made-up house; its router's password: ${DEMO_ROUTER_PASSWORD}; Ctrl+C stops it)\n`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => server.kill('SIGTERM'));
server.on('exit', (code) => process.exit(code ?? 0));
