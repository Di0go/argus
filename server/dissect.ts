// A capture file read into the devices and hosts it shows: tshark does the dissection and reports fields (one line per
// frame, server/tally.ts says which), and the tally adds them up. The same tally adds up the live capture
// (server/live.ts), one frame at a time.

import { spawn } from 'node:child_process';
import { type Dissected, fieldArgs, Tally } from './tally.ts';

export { type Dissected, isLocal, isRandomMac, isUnicastIp, isUnicastMac, shortVendor, tally } from './tally.ts';

export interface DissectOptions {
  tshark: string;
  /** This machine's own MAC addresses: the device with one of them is "this PC". */
  ownMacs?: string[];
}

export class DissectError extends Error {}

/** Runs tshark over `file` and adds up what it saw. */
export async function dissect(file: string, options: DissectOptions): Promise<Dissected> {
  const out = await run(options.tshark, ['-r', file, ...fieldArgs()]);
  return new Tally({ ownMacs: options.ownMacs ?? [] }).addText(out).view();
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => reject(new DissectError(`tshark could not run (${cmd}): ${e.message}`)));
    child.on('close', (code) => {
      // tshark exits 2 on a capture cut short (the last packet half written): what it read is still good.
      if (code !== 0 && !(code === 2 && out.length)) return reject(new DissectError(`tshark failed (${code}): ${err.trim().slice(0, 500)}`));
      resolve(Buffer.concat(out).toString('utf8'));
    });
  });
}
