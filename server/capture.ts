// The network interfaces this machine has, named as he would name them, and whether this user can capture on them
// (dumpcap lists them only if it can open them: it is the one program with the capture capabilities,
// scripts/install-capture.sh). The listening itself is live.ts.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Interface } from '../shared/types.ts';

export interface CaptureTools {
  dumpcap: string;
  /** Where the kernel lists the interfaces (/sys/class/net); tests point it elsewhere. */
  sysNet?: string;
}

/** What `dumpcap -D` lists: "1. wlan0", "5. any (Pseudo-device that captures on all interfaces)". */
export function parseDumpcapList(text: string): { name: string; description?: string }[] {
  const out: { name: string; description?: string }[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*\d+\.\s+(\S+)(?:\s+\((.*)\))?\s*$/.exec(line);
    if (m?.[1]) out.push({ name: m[1], description: m[2] });
  }
  return out;
}

/** What kind of interface `name` is, from the kernel's own description of it. */
export function classify(name: string, sysNet = '/sys/class/net'): Pick<Interface, 'type' | 'label' | 'up'> {
  const dir = path.join(sysNet, name);
  const read = (f: string) => {
    try {
      return readFileSync(path.join(dir, f), 'utf8').trim();
    } catch {
      return '';
    }
  };
  const state = read('operstate');
  const up = state ? state === 'up' || state === 'unknown' : undefined;
  if (name === 'any') return { type: 'any', label: 'Todas', up: true };
  if (name === 'lo' || read('type') === '772') return { type: 'loopback', label: 'Loopback (este PC)', up };
  if (existsSync(path.join(dir, 'wireless')) || existsSync(path.join(dir, 'phy80211'))) return { type: 'wifi', label: 'Wi-Fi', up };
  if (/^(docker|br-|veth)/.test(name)) return { type: 'docker', label: name.startsWith('veth') ? 'Docker (contentor)' : 'Docker', up };
  // No Ethernet header (type 65534 "none", PPP 512) or a tunnel driver: a VPN.
  if (/^(tun|tap|wg|tailscale|ppp|vpn)/.test(name) || ['65534', '512'].includes(read('type'))) return { type: 'vpn', label: 'VPN', up };
  if (read('type') === '1' && existsSync(path.join(dir, 'device'))) return { type: 'cable', label: 'Cabo', up };
  return { type: 'other', label: name, up };
}

/** The interfaces, with dumpcap's list when it can be run (then this user can capture), else the kernel's. */
export async function listInterfaces(tools: CaptureTools): Promise<{ interfaces: Interface[]; problem?: string }> {
  const sysNet = tools.sysNet ?? '/sys/class/net';
  let listed: { name: string; description?: string }[] | undefined;
  let problem: string | undefined;
  try {
    listed = parseDumpcapList(await run(tools.dumpcap, ['-D']));
  } catch (err) {
    problem = (err as Error).message;
  }
  const names = listed?.map((l) => l.name) ?? safeReaddir(sysNet);
  const interfaces = names
    // dumpcap also lists capture sources that are not network interfaces (USB, D-Bus, the journal…).
    .filter((n) => n === 'any' || existsSync(path.join(sysNet, n)))
    .map((name): Interface => {
      const c = classify(name, sysNet);
      const sameKind = names.filter((n) => classify(n, sysNet).label === c.label).length > 1;
      return {
        kind: 'interface',
        id: name,
        name: sameKind && c.type !== 'any' ? `${c.label} (${name})` : c.label,
        aka: [name],
        summary: `${c.label}: ${name}${c.up === false ? ', desligada' : ''}`,
        label: c.label,
        type: c.type,
        capturable: Boolean(listed),
        up: c.up,
      };
    });
  const order: Interface['type'][] = ['wifi', 'cable', 'vpn', 'docker', 'loopback', 'any', 'other'];
  interfaces.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || Number(b.up) - Number(a.up) || a.id.localeCompare(b.id));
  return { interfaces, problem };
}

/** This machine's own MAC addresses, so the capture can say which device is this PC. */
export function ownMacs(sysNet = '/sys/class/net'): string[] {
  return safeReaddir(sysNet)
    .map((n) => {
      try {
        return readFileSync(path.join(sysNet, n, 'address'), 'utf8').trim().toLowerCase();
      } catch {
        return '';
      }
    })
    .filter((m) => m && m !== '00:00:00:00:00:00');
}

function run(cmd: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) =>
      reject(new Error((e as NodeJS.ErrnoException).code === 'ENOENT' ? `${cmd} não está instalado (scripts/install-capture.sh)` : e.message)),
    );
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      const said = err.trim().split('\n').filter((l) => !/^Capturing on|^File:|^Packets/.test(l)).join(' ').slice(0, 400);
      reject(new Error(/permission|not permitted|You don't have permission/i.test(said) ? `Sem permissão para capturar: ${said}` : said || `${cmd} saiu com ${code}`));
    });
  });
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
