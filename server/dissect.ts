// A capture file read into the devices and hosts it shows: tshark does the dissection and reports fields (one line per
// frame, server/tally.ts says which), and the tally adds them up. The same tally adds up the live capture
// (server/live.ts), one frame at a time.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { type Dissected, fieldArgs, parseLine, Tally } from './tally.ts';

export { type Dissected, isLocal, isRandomMac, isUnicastIp, isUnicastMac, shortVendor, tally } from './tally.ts';

export interface DissectOptions {
  tshark: string;
  /** This machine's own MAC addresses: the device with one of them is "this PC". */
  ownMacs?: string[];
  /** The TLS key log file to read HTTPS with (server/requests.ts), if any. */
  keylog?: string;
}

export class DissectError extends Error {}

/**
 * Runs tshark over `file` and adds up what it saw, a line at a time as tshark prints it: a ring of 200 MB is millions
 * of lines, which as one string would not fit (the red team's finding), and as a stream cost no more than the tally.
 */
export function dissect(file: string, options: DissectOptions): Promise<Dissected> {
  const tally = new Tally({ ownMacs: options.ownMacs ?? [] });
  return new Promise((resolve, reject) => {
    const child = spawn(options.tshark, ['-r', file, ...fieldArgs(options.keylog)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let lines = 0;
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      lines++;
      tally.add(parseLine(line));
    });
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    child.on('error', (e) => reject(new DissectError(`tshark could not run (${options.tshark}): ${e.message}`)));
    child.on('close', (code) => {
      // tshark exits 2 on a capture cut short (the last packet half written): what it read is still good.
      if (code !== 0 && !(code === 2 && lines)) return reject(new DissectError(`tshark failed (${code}): ${err.trim().slice(0, 500)}`));
      try {
        resolve(tally.view());
      } catch (e) {
        reject(e);
      }
    });
  });
}
