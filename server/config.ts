// This instance of Argus: the core's defineApp over app.json (name, ports, loopback, the dev and live folders), and
// what Argus adds of its own: where the live session and the captures go, which programs listen and read, and the
// ceilings of the live session. Each from ARGUS_* in the
// environment, with a default.

import { homedir } from 'node:os';
import path from 'node:path';
import { defineApp } from '@organon/core/server/app';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const app = defineApp(ROOT);

/** The captures saved: one pcapng per capture and its record beside it. */
export const CAPTURES_DIR = path.join(app.dataDir, 'captures');
/** The live session: the ring buffer per interface, what was seen, and what was on. */
export const LIVE_DIR = path.join(app.dataDir, 'live');
/** tshark reads a capture file (no privileges needed); dumpcap captures (the one with the capabilities). */
export const TSHARK = app.env('TSHARK') ?? 'tshark';
export const DUMPCAP = app.env('DUMPCAP') ?? 'dumpcap';
/** mergecap joins the ring buffer's files into one capture. */
export const MERGECAP = app.env('MERGECAP') ?? 'mergecap';
/** editcap cuts what is saved at the session's start. */
export const EDITCAP = app.env('EDITCAP') ?? 'editcap';
/**
 * The ceilings of the live session. On disk, per interface: ARGUS_RING_FILES files of ARGUS_RING_MB each at most
 * (20 × 10 MB = 200 MB), each covering ARGUS_RING_SECONDS at most (30: the ring holds the last ten minutes when the
 * network is quiet, less when it is busy). In memory: ARGUS_MAX_FLOWS conversations (20 000) and ARGUS_MAX_DEVICES devices (500).
 */
const int = (name: string, fallback: number) => {
  const v = Number(app.env(name));
  return Number.isInteger(v) && v > 0 ? v : fallback;
};
export const RING = {
  ringFiles: int('RING_FILES', 20),
  ringFileMB: int('RING_MB', 10),
  ringSeconds: int('RING_SECONDS', 30),
  emitEvery: int('EMIT_MS', 1000),
  /** How often the system is asked which SSID each Wi-Fi is on, and this machine's MACs (ARGUS_POLL_MS). */
  pollEvery: int('POLL_MS', 5000),
  tally: { maxFlows: int('MAX_FLOWS', 20_000), maxDevices: int('MAX_DEVICES', 500), maxRequests: int('MAX_REQUESTS', 2000) },
};
/** The day kept (server/history.ts): how many days (ARGUS_HISTORY_DAYS), at most how many MB (ARGUS_HISTORY_MB), and
 * how often the session is looked at, in milliseconds (ARGUS_HISTORY_MS). */
export const HISTORY = { days: int('HISTORY_DAYS', 31), mb: int('HISTORY_MB', 200), every: int('HISTORY_MS', 5000) };
/** The captures saved, all together, at most this many MB (ARGUS_CAPTURES_MB): past it, saving is refused and said. */
export const CAPTURES_MB = int('CAPTURES_MB', 2048);
/** Where the kernel lists the interfaces; tests point it at a folder of their own. */
export const SYS_NET = app.env('SYS_NET') ?? '/sys/class/net';
/**
 * iw says which SSID a Wi-Fi is on (server/capture.ts ssidOf): ARGUS_IW, else the system's, but only on the real
 * /sys/class/net. Where the interfaces are made up (the tests, the demo) the real Wi-Fi's name must never be asked.
 */
export const IW = app.env('IW') ?? (SYS_NET === '/sys/class/net' ? 'iw' : undefined);
/**
 * The TLS key log file tshark reads the sessions' keys from, to read HTTPS (server/requests.ts, docs/requests.md):
 * ARGUS_TLS_KEYLOG, else SSLKEYLOGFILE, the variable the browsers and curl write their keys to when it is set (Argus's
 * service gets the session's environment, ~/.config/environment.d, as they do). Only on the real /sys/class/net: the
 * tests and the demo set their own, and the real one must never be read there. Unset: HTTPS is not read.
 */
export const KEYLOG = app.env('TLS_KEYLOG') ?? (SYS_NET === '/sys/class/net' ? process.env.SSLKEYLOGFILE || undefined : undefined);
/** A recording brought in as a capture when there is none yet (pnpm dev uses the fixture). */
export const SEED_PCAP = app.env('SEED_PCAP');

/**
 * Where Argus finds devices besides listening (server/sources.ts): the kernel's neighbour table (ARGUS_NEIGH=0 turns it
 * off), DHCP lease files (ARGUS_LEASES, comma separated; "none" turns them off; unset reads the usual places), both
 * local reads, a scan of the LAN, which sends, only when he presses its button (ARGUS_SCAN=0 takes the button away;
 * it needs nmap), and reading the router, which logs in to it, the same way (ARGUS_ROUTER=0). All four are on only
 * where the interfaces are the real ones (SYS_NET is /sys/class/net): the tests and the demo make them up, and the real
 * LAN must not leak in.
 */
const realNet = (app.env('SYS_NET') ?? '/sys/class/net') === '/sys/class/net';
const flag = (name: string, fallback: boolean) => {
  const v = app.env(name);
  return v === undefined ? fallback : v !== '0';
};
const leases = app.env('LEASES');
export const SOURCES = {
  neigh: flag('NEIGH', realNet),
  scan: flag('SCAN', realNet),
  router: flag('ROUTER', realNet),
  leases: leases === undefined ? (realNet ? undefined : []) : leases === 'none' || leases === '' ? [] : leases.split(',').map((f) => f.trim()).filter(Boolean),
  nmap: app.env('NMAP') ?? 'nmap',
  ip: app.env('IP') ?? 'ip',
  pollEvery: int('SOURCES_MS', 15_000),
};

/**
 * Reading the router (server/routers.ts), only when he presses its button. Its page is the gateway's
 * (`http://<gateway>`), or ARGUS_ROUTER_URL where the router is made up (the tests, the demo). The passwords he types
 * are kept in ARGUS_ROUTER_KEYS, by default ~/.config/argus/routers.json (mode 600): outside the repository and the data
 * folder, shared by every instance of this user, so he types each once. Where the interfaces are made up, beside the
 * instance's data instead: a made-up router's password never reaches his.
 */
export const ROUTER = {
  url: app.env('ROUTER_URL'),
  keys:
    app.env('ROUTER_KEYS') ??
    (realNet ? path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'argus', 'routers.json') : path.join(app.dataDir, 'router-keys.json')),
};
