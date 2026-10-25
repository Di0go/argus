// The live session: listening, without stopping, on the interfaces he turned on (several at once, each on or off on
// its own), and what they add up to, sent to the page as it changes.
//
// Per interface, one tshark: `tshark -i <iface> -w <ring> -b … -P -T fields`. tshark has dumpcap (the one program
// with the capture capabilities, scripts/install-capture.sh) write the packets into a ring buffer of files on disk,
// and prints each packet's fields as it comes in; the tally (tally.ts) adds them up here. The ring keeps the last
// minutes on disk, bounded (files × size), so they can be saved as a capture; nothing older is kept. -M resets
// tshark's own dissection state every so many packets, so a capture that runs for days does not grow it without end.
// It only listens: no monitor mode, nothing sent.
//
// What the page gets is the aggregate (devices, hosts, how much, the bandwidth over time), never packets, at most once
// a second. The session is written to data/live/ every minute and when the server stops, so a reload of the page (or
// a restart of the server, a release) picks up where it was; the interfaces that were on are listened on again.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { EventHub } from '@organon/core/server/events';
import type { Store } from '@organon/core/server/store';
import { isObject } from '@organon/core/server/store';
import type { Link } from '@organon/core/shared/entities';
import type { Device, LiveEvent, LiveView, Listening, Remote, Session } from '../shared/types.ts';
import { fieldArgs, parseLine, Tally, type TallyData, type TallyOptions } from './tally.ts';

export interface LiveOptions {
  tshark: string;
  /** data/live: the ring buffers, the session and what was on. */
  dir: string;
  store: Store;
  events: EventHub;
  ownMacs: () => string[];
  /** The ring buffer per interface: how many files, how big each may grow, how many seconds each covers at most. */
  ringFiles?: number;
  ringFileMB?: number;
  ringSeconds?: number;
  tally?: Pick<TallyOptions, 'maxFlows' | 'maxDevices'>;
  /** Milliseconds between events to the page (1000), and between writes of the session to disk (60 000). */
  emitEvery?: number;
  saveEvery?: number;
}

export class LiveError extends Error {}

interface Listener {
  state: Listening;
  child?: ChildProcess;
  retry?: ReturnType<typeof setTimeout>;
  /** Seconds to wait before trying again after it stopped (doubling, up to a minute). */
  backoff: number;
  stderr: string;
}

const isState = (v: unknown): v is { on: string[]; started?: number } => isObject(v) && Array.isArray(v.on);
const isTally = (v: unknown): v is TallyData => isObject(v) && Array.isArray(v.devices) && Array.isArray(v.flows);

export class Live {
  private tally: Tally;
  private started: number | undefined;
  private readonly listeners = new Map<string, Listener>();
  private readonly o: Required<Omit<LiveOptions, 'tally'>> & { tally: LiveOptions['tally'] };
  private timer: ReturnType<typeof setInterval> | undefined;
  private saver: ReturnType<typeof setInterval> | undefined;
  /** What the page was last sent, to send only what changed: hosts by their bytes and last time, links by weight. */
  private sentRemotes = new Map<string, string>();
  private sentLinks = new Map<string, number>();
  private lastPackets = -1;
  private dirty = false;
  private stopping = false;

  constructor(options: LiveOptions) {
    this.o = { ringFiles: 20, ringFileMB: 10, ringSeconds: 30, emitEvery: 1000, saveEvery: 60_000, tally: undefined, ...options };
    this.tally = this.newTally();
  }

  /** Reads the session back and listens again on what was on. */
  async load(): Promise<this> {
    await mkdir(this.o.dir, { recursive: true });
    const saved = await this.o.store.loadJson(this.file('session.json'), isTally, undefined as unknown as TallyData);
    if (saved) {
      try {
        this.tally = Tally.load(saved, this.tallyOptions());
      } catch {
        this.tally = this.newTally();
      }
    }
    const state = await this.o.store.loadJson(this.file('state.json'), isState, { on: [] as string[] });
    this.started = state.started;
    for (const id of state.on) this.listen(id);
    this.timer = setInterval(() => this.emit(), this.o.emitEvery);
    this.saver = setInterval(() => void this.save(), this.o.saveEvery);
    return this;
  }

  /** Turns listening on `id` on or off. `known` are the interfaces this user can capture on. */
  async set(id: string, on: boolean, known: string[]): Promise<Session> {
    if (on && !known.includes(id)) throw new LiveError(`Interface desconhecida: ${id}`);
    if (on) this.listen(id);
    else this.unlisten(id);
    await this.saveState();
    this.emit(true);
    return this.session();
  }

  /** Begins the session again: what was seen is forgotten, the interfaces stay as they are. */
  async reset(): Promise<void> {
    this.tally = this.newTally();
    this.started = this.on().length ? Date.now() / 1000 : undefined;
    this.sentRemotes.clear();
    this.sentLinks.clear();
    for (const l of this.listeners.values()) l.state.packets = 0;
    await this.save();
    this.o.events.send({ type: 'reset' });
  }

  /** The ring buffer's files, oldest first, of the interfaces given (all by default): what "save" merges. */
  async ringFiles(ids?: string[]): Promise<string[]> {
    const out: { file: string; mtime: number }[] = [];
    for (const id of ids ?? (await this.ringIds())) {
      const dir = this.ringDir(id);
      for (const f of await safeReaddir(dir)) {
        if (!f.endsWith('.pcapng')) continue;
        const s = await stat(path.join(dir, f)).catch(() => undefined);
        if (s && s.size > 0) out.push({ file: path.join(dir, f), mtime: s.mtimeMs });
      }
    }
    return out.sort((a, b) => a.mtime - b.mtime).map((x) => x.file);
  }

  view(): LiveView {
    this.tally.tick(Date.now() / 1000);
    const v = this.tally.view();
    return {
      session: this.session(),
      devices: this.withRates(v.devices),
      remotes: v.remotes,
      links: v.links,
      total: { fine: this.tally.fine.tail(), coarse: this.tally.coarse.tail() },
      byDevice: Object.fromEntries(v.devices.map((d) => [d.id, this.tally.deviceSeries(d.id).fine!]).filter(([, s]) => s)),
    };
  }

  /** What a capture view is for the agent: the session's devices and hosts. */
  hosts(): { devices: Device[]; remotes: Remote[]; links: Link[] } {
    const v = this.tally.view();
    return { devices: this.withRates(v.devices), remotes: v.remotes, links: v.links };
  }

  deviceSeries(id: string) {
    return this.tally.deviceSeries(id);
  }

  session(): Session {
    return {
      started: this.started,
      packets: this.tally.packets,
      bytes: this.tally.bytes,
      listening: [...this.listeners.values()].map((l) => ({ ...l.state })),
      limits: {
        ringFiles: this.o.ringFiles,
        ringFileMB: this.o.ringFileMB,
        ringSeconds: this.o.ringSeconds,
        maxFlows: this.o.tally?.maxFlows ?? 100_000,
        maxDevices: this.o.tally?.maxDevices ?? 2_000,
      },
      rate: rateOf(this.tally.fine, Date.now() / 1000),
    };
  }

  /** The interfaces turned on. */
  on(): string[] {
    return [...this.listeners.values()].filter((l) => l.state.on).map((l) => l.state.id);
  }

  /** Stops every tshark and writes the session. */
  async stop(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    clearInterval(this.saver);
    const exits = [...this.listeners.values()].map((l) => this.kill(l));
    await Promise.all(exits);
    await this.save();
  }

  private listen(id: string) {
    let l = this.listeners.get(id);
    if (!l) {
      l = { state: { id, on: true, status: 'off', packets: 0, ringBytes: 0 }, backoff: 2, stderr: '' };
      this.listeners.set(id, l);
    }
    l.state.on = true;
    if (l.child || l.retry) return;
    this.started ??= Date.now() / 1000;
    void this.spawn(l);
  }

  private unlisten(id: string) {
    const l = this.listeners.get(id);
    if (!l) return;
    l.state.on = false;
    clearTimeout(l.retry);
    l.retry = undefined;
    void this.kill(l);
    l.state.status = 'off';
    l.state.error = undefined;
    l.state.since = undefined;
  }

  private async spawn(l: Listener) {
    const id = l.state.id;
    const dir = this.ringDir(id);
    // A new run of this interface starts a new ring: what the last one left is not this session's.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    if (!l.state.on || this.stopping) return;
    const args = [
      '-i',
      id,
      '-w',
      path.join(dir, 'ring.pcapng'),
      '-b',
      `files:${this.o.ringFiles}`,
      '-b',
      `filesize:${this.o.ringFileMB * 1024}`,
      '-b',
      `duration:${this.o.ringSeconds}`,
      '-P',
      '-l',
      '-M',
      '100000',
      ...fieldArgs(),
    ];
    l.state.status = 'starting';
    l.state.error = undefined;
    l.stderr = '';
    const child = spawn(this.o.tshark, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    l.child = child;
    child.stderr.on('data', (d: Buffer) => (l.stderr = (l.stderr + d.toString()).slice(-2000)));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      let row: ReturnType<typeof parseLine>;
      try {
        row = parseLine(line);
      } catch {
        return;
      }
      // The interface's name, always: a single-interface capture leaves it out on some versions.
      if (!row['frame.interface_name'].length) row['frame.interface_name'] = [id];
      this.tally.add(row);
      l.state.packets++;
      if (l.state.status !== 'listening') {
        l.state.status = 'listening';
        l.state.since ??= Date.now() / 1000;
        l.backoff = 2;
      }
      this.dirty = true;
    });
    child.on('spawn', () => {
      l.state.since = Date.now() / 1000;
      // A quiet network can take a while to show its first frame: once tshark says it is capturing, it is listening.
      setTimeout(() => {
        if (l.child === child && l.state.status === 'starting' && !/error|denied|permission/i.test(l.stderr)) l.state.status = 'listening';
      }, 1500);
    });
    child.on('error', (e) => {
      l.stderr += (e as NodeJS.ErrnoException).code === 'ENOENT' ? `${this.o.tshark} não está instalado (scripts/install-capture.sh)` : e.message;
    });
    child.on('close', (code) => {
      if (l.child === child) l.child = undefined;
      if (!l.state.on || this.stopping) return;
      // It stopped on its own: the interface went away, permission, tshark missing. Said, and tried again later.
      l.state.status = 'failed';
      l.state.error = said(l.stderr) || `tshark saiu com ${code}`;
      l.retry = setTimeout(() => {
        l.retry = undefined;
        if (l.state.on) void this.spawn(l);
      }, l.backoff * 1000);
      l.backoff = Math.min(60, l.backoff * 2);
      this.emit(true);
    });
  }

  private kill(l: Listener): Promise<void> {
    const child = l.child;
    l.child = undefined;
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const done = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('close', () => {
        clearTimeout(done);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  /** Once a second: to the page, what changed. */
  private emit(force = false) {
    void this.measureRings();
    const now = Date.now() / 1000;
    const quiet = !this.dirty && this.tally.packets === this.lastPackets;
    // Even quiet, the rates fall to zero and the series move on: a beat every few seconds while listening.
    if (!force && quiet && !(this.on().length && Math.floor(now) % 3 === 0)) return;
    this.dirty = false;
    this.lastPackets = this.tally.packets;
    this.tally.tick(now);
    if (!this.o.events.size) return;
    const v = this.tally.view();
    const remotes: Remote[] = [];
    const seen = new Set<string>();
    for (const r of v.remotes) {
      seen.add(r.id);
      const mark = `${r.bytesSent + r.bytesReceived}:${r.lastSeen}:${r.names.length}`;
      if (this.sentRemotes.get(r.id) !== mark) {
        this.sentRemotes.set(r.id, mark);
        remotes.push(r);
      }
    }
    const gone = [...this.sentRemotes.keys()].filter((id) => !seen.has(id));
    for (const id of gone) this.sentRemotes.delete(id);
    const links: Link[] = [];
    for (const l of v.links) {
      const key = `${l.from}>${l.to}`;
      if (this.sentLinks.get(key) !== l.weight) {
        this.sentLinks.set(key, l.weight ?? 0);
        links.push(l);
      }
    }
    const recent = this.tally.recentByDevice(5);
    const event: LiveEvent = {
      type: 'live',
      session: this.session(),
      devices: this.withRates(v.devices),
      remotes,
      links,
      gone,
      total: { fine: this.tally.fine.tail(5), coarse: this.tally.coarse.tail(2) },
      byDevice: recent,
    };
    this.o.events.send(event);
  }

  private withRates(devices: Device[]): Device[] {
    const now = Date.now() / 1000;
    return devices.map((d) => {
      const s = this.tally.deviceSeries(d.id).fine;
      return s ? { ...d, rate: { sent: rateOf(s, now, 'sent'), received: rateOf(s, now, 'received') } } : d;
    });
  }

  private async measureRings() {
    for (const l of this.listeners.values()) {
      let total = 0;
      for (const f of await safeReaddir(this.ringDir(l.state.id))) {
        const s = await stat(path.join(this.ringDir(l.state.id), f)).catch(() => undefined);
        total += s?.size ?? 0;
      }
      l.state.ringBytes = total;
    }
  }

  private async save() {
    try {
      await this.o.store.writeJson(this.file('session.json'), this.tally.save());
      await this.saveState();
    } catch {
      // The store says it in the warnings; the session goes on in memory.
    }
  }

  private saveState() {
    return this.o.store.writeJson(this.file('state.json'), { on: this.on(), started: this.started });
  }

  private async ringIds(): Promise<string[]> {
    return safeReaddir(path.join(this.o.dir, 'ring'));
  }

  private ringDir(id: string) {
    return path.join(this.o.dir, 'ring', id.replace(/[^\w.-]/g, '_'));
  }

  private file(name: string) {
    return path.join(this.o.dir, name);
  }

  private tallyOptions(): TallyOptions {
    return { ownMacs: this.o.ownMacs(), ...this.o.tally };
  }

  private newTally() {
    return new Tally(this.tallyOptions());
  }
}

/**
 * Bytes a second over the last three whole seconds (the one going on is not over yet). As a meter's: what was, not
 * what a single busy instant was; the page smooths it on top (quick to rise, slow to fall).
 */
function rateOf(s: { step: number; end: number; sent: number[]; received: number[] }, now: number, which?: 'sent' | 'received'): number {
  const current = Math.floor(now / s.step);
  let sum = 0;
  for (let k = 1; k <= 3; k++) {
    const idx = s.sent.length - 1 - (s.end - (current - k));
    if (idx < 0 || idx >= s.sent.length) continue;
    sum += which === 'received' ? s.received[idx]! : which === 'sent' ? s.sent[idx]! : s.sent[idx]! + s.received[idx]!;
  }
  return Math.round(sum / (3 * s.step));
}

/** What tshark said that matters, without its chatter. */
function said(stderr: string): string {
  const text = stderr
    .split('\n')
    .filter((l) => l.trim() && !/^Capturing on|^File:|packets? captured|^\d+ packets? dropped/i.test(l))
    .join(' ')
    .slice(0, 400);
  return /permission|not permitted|You don't have permission/i.test(text) ? `Sem permissão para capturar: ${text}` : text;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
