// This instance of Argus: the core's defineApp over app.json (name, ports, loopback, the dev and live folders), and
// what Argus adds of its own: where captures go and which programs read and make them. Each from ARGUS_* in the
// environment, with a default.

import path from 'node:path';
import { defineApp } from '@organon/core/server/app';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const app = defineApp(ROOT);

/** The captures: one pcapng per capture and its record beside it. */
export const CAPTURES_DIR = path.join(app.dataDir, 'captures');
/** tshark reads a capture file (no privileges needed); dumpcap captures (the one with the capabilities). */
export const TSHARK = app.env('TSHARK') ?? 'tshark';
export const DUMPCAP = app.env('DUMPCAP') ?? 'dumpcap';
/** Where the kernel lists the interfaces; tests point it at a folder of their own. */
export const SYS_NET = app.env('SYS_NET') ?? '/sys/class/net';
/** A recording brought in as a capture when there is none yet (pnpm dev uses the fixture). */
export const SEED_PCAP = app.env('SEED_PCAP');
