// pnpm demo: Argus with a made-up house instead of a capture (scripts/demo-tshark.ts), for a look without the
// capture permissions, and for the README's pictures. Its own data in .demo/, its own port (4950), the Wi-Fi turned
// on at start; nothing touches the network.
//
//   pnpm demo          then http://localhost:4950

import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fakeCapture } from '../tests/helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = process.env.ARGUS_DEMO_PORT ?? '4950';
const DEMO = path.join(ROOT, '.demo');
const tshark = path.join(ROOT, 'scripts/demo-tshark.ts');
chmodSync(tshark, 0o755);
mkdirSync(path.join(DEMO, 'data'), { recursive: true });
mkdirSync(path.join(DEMO, 'state'), { recursive: true });
const fake = await fakeCapture();

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
  },
});
for (let i = 0; i < 100; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/live/wlan0`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: true }),
    });
    if (res.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
console.log(`\n  Argus, the demo: http://localhost:${PORT}  (a made-up house; Ctrl+C stops it)\n`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => server.kill('SIGTERM'));
server.on('exit', (code) => process.exit(code ?? 0));
