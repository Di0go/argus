// What the tests share: the app's root, the fixture, tshark, and a pretend dumpcap and /sys/class/net, so the whole
// capture flow runs here without root and without touching the network.

import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const FIXTURE = path.join(ROOT, 'tests/fixtures/lan.pcap');
/** tshark, from ARGUS_TSHARK (a copy not installed yet) or the system's. The tests need it: without it they fail. */
export const TSHARK = process.env.ARGUS_TSHARK ?? 'tshark';
try {
  execFileSync(TSHARK, ['-v'], { stdio: 'ignore' });
} catch {
  throw new Error(`No tshark (${TSHARK}): install it (scripts/install-capture.sh) or set ARGUS_TSHARK`);
}

/**
 * A folder standing in for /sys/class/net (a Wi-Fi, a cable unplugged, Docker's bridge, a VPN) and a dumpcap that
 * lists them and "captures" by copying the fixture, after `seconds` of its own (the -a duration:N it is given, cut to
 * a tenth so the tests stay quick). Its arguments are written beside it, to check what Argus asked for.
 */
export async function fakeCapture(): Promise<{ dumpcap: string; sysNet: string; argsFile: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'argus-fake-'));
  const sysNet = path.join(dir, 'net');
  const iface = async (name: string, files: Record<string, string>, dirs: string[] = []) => {
    await mkdir(path.join(sysNet, name), { recursive: true });
    for (const [f, v] of Object.entries(files)) await writeFile(path.join(sysNet, name, f), `${v}\n`);
    for (const d of dirs) await mkdir(path.join(sysNet, name, d));
  };
  await iface('wlan0', { type: '1', operstate: 'up', address: '3c:a9:f4:10:20:30' }, ['wireless', 'device']);
  await iface('enp3s0', { type: '1', operstate: 'down', address: '3c:a9:f4:10:20:31' }, ['device']);
  await iface('docker0', { type: '1', operstate: 'up', address: '02:42:5a:11:22:33' });
  await iface('tailscale0', { type: '65534', operstate: 'unknown' });
  await iface('lo', { type: '772', operstate: 'unknown', address: '00:00:00:00:00:00' });
  const argsFile = path.join(dir, 'args');
  const dumpcap = path.join(dir, 'dumpcap');
  await writeFile(
    dumpcap,
    `#!/usr/bin/env bash
echo "$@" >> ${argsFile}
if [[ "$1" == "-D" ]]; then
  printf '1. wlan0\\n2. enp3s0\\n3. docker0\\n4. tailscale0\\n5. any (Pseudo-device that captures on all interfaces)\\n6. lo (Loopback)\\n7. dbus-system (D-Bus system bus)\\n'
  exit 0
fi
out=""; dur=1
while [[ $# -gt 0 ]]; do
  case "$1" in -w) out="$2"; shift;; -a) dur="\${2#duration:}"; shift;; esac; shift
done
sleep "$(awk "BEGIN{print $dur/10}")"
cp ${FIXTURE} "$out"
`,
  );
  await chmod(dumpcap, 0o755);
  return { dumpcap, sysNet, argsFile };
}
