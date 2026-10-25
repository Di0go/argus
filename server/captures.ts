// The captures: each one a file dumpcap wrote (data/captures/<id>.pcapng) and a record of when, where and how it
// went (<id>.json, through the core's store). What a capture shows (its devices and hosts) is worked out from the file
// by tshark when first asked, and kept in memory: the file is the truth, the rest is a reading of it.

import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from '@organon/core/server/store';
import { isObject } from '@organon/core/server/store';
import type { Capture, HostsView } from '../shared/types.ts';
import { capture, type CaptureTools, ownMacs } from './capture.ts';
import { type Dissected, dissect } from './dissect.ts';

export const MAX_SECONDS = 300;

export class CaptureError extends Error {}

const isCapture = (v: unknown): v is Capture =>
  isObject(v) && typeof v.id === 'string' && typeof v.started === 'number' && Array.isArray(v.interfaces) && typeof v.status === 'string';

export class Captures {
  private list: Capture[] = [];
  private readings = new Map<string, Promise<Dissected>>();
  private running = new Map<string, Promise<unknown>>();

  private readonly dir: string;
  private readonly store: Store;
  private readonly tools: CaptureTools & { tshark: string };

  constructor(dir: string, store: Store, tools: CaptureTools & { tshark: string }) {
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
        c.error = 'O servidor parou a meio da captura';
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
    return path.join(this.dir, `${c.id}.${c.source === 'file' ? 'pcap' : 'pcapng'}`);
  }

  /** Starts a capture on `interfaces` for `seconds`; resolves at once with it running. */
  async start(interfaces: string[], seconds: number, known: string[]): Promise<Capture> {
    if (!interfaces.length) throw new CaptureError('Escolhe pelo menos uma interface');
    const unknown = interfaces.filter((i) => !known.includes(i));
    if (unknown.length) throw new CaptureError(`Interface desconhecida: ${unknown.join(', ')}`);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) throw new CaptureError(`Duração de 1 a ${MAX_SECONDS} segundos`);
    if ([...this.running.keys()].length) throw new CaptureError('Já há uma captura a decorrer');
    const c: Capture = { id: newId(), started: Date.now() / 1000, seconds, interfaces, status: 'running', source: 'live' };
    this.list.unshift(c);
    await this.save(c);
    const job = capture(this.tools, interfaces, seconds, this.file(c))
      .then(async () => {
        const r = await this.read(c);
        Object.assign(c, { status: 'done', packets: r.packets, bytes: r.bytes });
      })
      .catch((err: Error) => Object.assign(c, { status: 'failed', error: err.message }))
      .finally(async () => {
        this.running.delete(c.id);
        await this.save(c);
      });
    this.running.set(c.id, job);
    return c;
  }

  /** Brings in a recording (the demo, a fixture) as a capture of its own. */
  async import(file: string, interfaces: string[] = ['gravação']): Promise<Capture> {
    const s = await stat(file);
    const c: Capture = { id: newId(), started: s.mtimeMs / 1000, seconds: 0, interfaces, status: 'done', source: 'file' };
    await copyFile(file, this.file(c));
    const r = await this.read(c);
    Object.assign(c, { packets: r.packets, bytes: r.bytes });
    if (r.devices.length) c.seconds = Math.max(1, Math.round(Math.max(...r.devices.map((d) => d.lastSeen)) - Math.min(...r.devices.map((d) => d.firstSeen))));
    this.list.push(c);
    this.list.sort((a, b) => b.started - a.started);
    await this.save(c);
    return c;
  }

  async remove(id: string): Promise<boolean> {
    const c = this.get(id);
    if (!c || c.status === 'running') return false;
    await rm(this.file(c), { force: true });
    await rm(path.join(this.dir, `${c.id}.json`), { force: true });
    this.list = this.list.filter((x) => x.id !== id);
    this.readings.delete(id);
    return true;
  }

  /** The capture's devices and hosts, from its file. */
  read(c: Capture): Promise<Dissected> {
    let r = this.readings.get(c.id);
    if (!r) {
      r = dissect(this.file(c), { tshark: this.tools.tshark, ownMacs: ownMacs(this.tools.sysNet) });
      this.readings.set(c.id, r);
      r.catch(() => this.readings.delete(c.id));
    }
    return r;
  }

  async hosts(c: Capture): Promise<HostsView> {
    const r = await this.read(c);
    return { capture: c, devices: r.devices, remotes: r.remotes, links: r.links };
  }

  idle(): Promise<unknown> {
    return Promise.all(this.running.values());
  }

  private save(c: Capture) {
    return this.store.writeJson(path.join(this.dir, `${c.id}.json`), c);
  }
}

/** "2026-10-25T18-00-00-123": sorts by time, safe in a path. */
function newId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}
