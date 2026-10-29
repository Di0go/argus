// The captures saved: each one a file (data/captures/<id>.pcapng: what the live session's ring buffer held when he
// saved it, or a recording brought in) and a record of when and where (<id>.json, through the core's store). What a capture shows (its devices and hosts) is worked out from the file
// by tshark when first asked, and kept in memory: the file is the truth, the rest is a reading of it.

import { interpret, type Reading } from './interpret.ts';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from '@organon/core/server/store';
import { isObject } from '@organon/core/server/store';
import type { Capture, HostsView } from '../shared/types.ts';
import { type CaptureTools, ownMacs } from './capture.ts';
import { type Dissected, dissect } from './dissect.ts';

const isCapture = (v: unknown): v is Capture =>
  isObject(v) && typeof v.id === 'string' && typeof v.started === 'number' && Array.isArray(v.interfaces) && typeof v.status === 'string';

export class Captures {
  private list: Capture[] = [];
  private readings = new Map<string, Promise<Dissected>>();

  private readonly dir: string;
  private readonly store: Store;
  private readonly tools: CaptureTools & { tshark: string; reading?: Reading; own?: () => string[]; keylog?: string };

  /** `own`: MACs that were this machine's before (the live session keeps them: a Wi-Fi's made-up one, at a café). */
  constructor(dir: string, store: Store, tools: CaptureTools & { tshark: string; reading?: Reading; own?: () => string[]; keylog?: string }) {
    this.dir = dir;
    this.store = store;
    this.tools = tools;
  }

  async load(): Promise<this> {
    await mkdir(this.dir, { recursive: true });
    const found: Capture[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const c = await this.store.loadJson(path.join(this.dir, f), isCapture, undefined as unknown as Capture);
      if (!c) continue;
      // A capture that was running when the server stopped did not finish: say so, keep what was written.
      if (c.status === 'running') {
        c.status = 'failed';
        c.error = 'The server stopped in the middle of the capture';
        await this.save(c);
      }
      found.push(c);
    }
    this.list = found.sort((a, b) => b.started - a.started);
    return this;
  }

  all(): Capture[] {
    return this.list;
  }

  get(id: string): Capture | undefined {
    return this.list.find((c) => c.id === id);
  }

  /** The newest capture that finished, the one the pages show unless told another. */
  latest(): Capture | undefined {
    return this.list.find((c) => c.status === 'done');
  }

  file(c: Capture): string {
    return path.join(this.dir, `${c.id}.${c.ext ?? (c.source === 'file' ? 'pcap' : 'pcapng')}`);
  }

  /** Brings in a recording (the demo, a fixture, what the live session's ring buffer held) as a capture of its own. */
  async import(file: string, interfaces: string[] = ['recording'], source: Capture['source'] = 'file'): Promise<Capture> {
    const s = await stat(file);
    const c: Capture = { id: newId(), started: s.mtimeMs / 1000, seconds: 0, interfaces, status: 'done', source, ext: file.endsWith('.pcapng') ? 'pcapng' : 'pcap' };
    await copyFile(file, this.file(c));
    const r = await this.read(c);
    Object.assign(c, { packets: r.packets, bytes: r.bytes });
    if (r.devices.length) c.started = Math.min(...r.devices.map((d) => d.firstSeen));
    if (r.devices.length) c.seconds = Math.max(1, Math.round(Math.max(...r.devices.map((d) => d.lastSeen)) - Math.min(...r.devices.map((d) => d.firstSeen))));
    this.list.push(c);
    this.list.sort((a, b) => b.started - a.started);
    await this.save(c);
    return c;
  }

  /** What the captures' files take on disk, together. */
  async diskBytes(): Promise<number> {
    let n = 0;
    for (const c of this.list) n += (await stat(this.file(c)).catch(() => undefined))?.size ?? 0;
    return n;
  }

  async remove(id: string): Promise<boolean> {
    const c = this.get(id);
    if (!c) return false;
    await rm(this.file(c), { force: true });
    await rm(path.join(this.dir, `${c.id}.json`), { force: true });
    this.list = this.list.filter((x) => x.id !== id);
    this.readings.delete(id);
    return true;
  }

  /** The capture's devices and hosts, from its file. */
  read(c: Capture): Promise<Dissected> {
    let r = this.readings.get(c.id);
    if (r) {
      // The most recently read last: the readings kept are the last few looked at.
      this.readings.delete(c.id);
      this.readings.set(c.id, r);
      return r;
    }
    // The sensor's facts, read by the server (interpret.ts).
    const own = [...new Set([...ownMacs(this.tools.sysNet), ...(this.tools.own?.() ?? [])])];
    r = dissect(this.file(c), { tshark: this.tools.tshark, ownMacs: own, keylog: this.tools.keylog }).then((v) => interpret(v, this.tools.reading));
    this.readings.set(c.id, r);
    r.catch(() => this.readings.delete(c.id));
    while (this.readings.size > 4) this.readings.delete(this.readings.keys().next().value!);
    return r;
  }

  async hosts(c: Capture): Promise<HostsView> {
    const r = await this.read(c);
    return { capture: c, devices: r.devices, remotes: r.remotes, links: r.links, conversations: r.conversations, networks: r.networks ?? [], requests: r.requests ?? [] };
  }

  private save(c: Capture) {
    return this.store.writeJson(path.join(this.dir, `${c.id}.json`), c);
  }
}

/** "2026-10-25T18-00-00-123": sorts by time, safe in a path. */
function newId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}
