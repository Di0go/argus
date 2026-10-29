// Runs a command with a temporary folder of its own as TMPDIR and removes it afterwards, however the command ends
// (it passes, fails, times out or is interrupted): everything the tests, their helpers and the servers they start
// make with mkdtemp lives under it, so a run leaves nothing in /tmp. Nested, the outer one's folder is used.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Usage: node scripts/with-tmp.ts <command> [args...]');
  process.exit(2);
}

const nested = !!process.env.ARGUS_RUN_TMP;
const dir = nested ? process.env.ARGUS_RUN_TMP! : mkdtempSync(path.join(tmpdir(), 'argus-run-'));
const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, TMPDIR: dir, ARGUS_RUN_TMP: dir } });

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => {
  if (!nested) rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? (signal ? 128 : 1));
});
child.on('error', (err) => {
  if (!nested) rmSync(dir, { recursive: true, force: true });
  console.error(err.message);
  process.exit(127);
});
