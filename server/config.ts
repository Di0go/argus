// This instance of Argus: the core's defineApp over app.json (name, ports, loopback, the dev and live folders), and
// what Argus adds of its own: where the live session and the captures go, which programs listen and read, and the
// ceilings of the live session. Each from ARGUS_* in the
// environment, with a default.

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
  tally: { maxFlows: int('MAX_FLOWS', 20_000), maxDevices: int('MAX_DEVICES', 500) },
};
/** The captures saved, all together, at most this many MB (ARGUS_CAPTURES_MB): past it, saving is refused and said. */
export const CAPTURES_MB = int('CAPTURES_MB', 2048);
/** Where the kernel lists the interfaces; tests point it at a folder of their own. */
export const SYS_NET = app.env('SYS_NET') ?? '/sys/class/net';
/** A recording brought in as a capture when there is none yet (pnpm dev uses the fixture). */
export const SEED_PCAP = app.env('SEED_PCAP');
