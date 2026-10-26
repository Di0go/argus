// The live session: listening, without stopping, on the interfaces he turned on (several at once, each on or off on
// its own), and what they add up to, sent to the page as it changes.
//
// Per interface, one tshark: `tshark -i <iface> -w <ring> -b … -P -T fields`. tshark has dumpcap (the one program
// with the capture capabilities, scripts/install-capture.sh) write the packets into a ring buffer of files on disk,
// and prints each packet's fields as it comes in; the tally (tally.ts) adds them up here. -M resets tshark's own
// dissection state every so many packets, so a capture that runs for days does not grow it without end. It only
// listens: no monitor mode, nothing sent.
//
// One process per interface, whatever is clicked: turning one on while it starts, or off and on again at once, waits
// for the one before to be gone (two at a time counted every packet twice, and one was left running; found by the red
// team). The ring is ours to bound: each interface keeps at most `ringFiles` files of `ringFileMB`, across restarts
// and retries, so the last minutes survive a release or a Wi-Fi blip; an interface turned off keeps its files until
// the session begins again, and an interface not on when the server starts has its files removed.
//
// What the page gets is the aggregate (devices, hosts, how much, the bandwidth over time), never packets, at most once
// a second, numbered, and only what changed. The session is written to data/live/ every minute and when the server
// stops, so a reload of the page (or a restart of the server, a release) picks up where it was.

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { EventHub } from '@organon/core/server/events';
import type { Store } from '@organon/core/server/store';
import { isObject } from '@organon/core/server/store';
import type { Link } from '@organon/core/shared/entities';
import type { Conversation, Device, LiveEvent, LiveView, Listening, Network, Remote, Session } from '../shared/types.ts';
import { type Dissected, fieldArgs, parseLine, Tally, type TallyData, type TallyOptions } from './tally.ts';

export interface LiveOptions {
  tshark: string;
  /** editcap cuts a saved capture at the session's start. */
  editcap?: string;
  /** data/live: the ring buffers, the session and what was on. */
  dir: string;
  store: Store;
  events: EventHub;
  ownMacs: () => string[];
  /**
   * The SSID a Wi-Fi interface is associated with now, as the system says it (server/capture.ts ssidOf); nothing for
   * another kind, or when it cannot say. Asked every few seconds of each interface listened on: another SSID is another
   * stay (tally.ts).
   */
  ssid?: (iface: string) => Promise<string | undefined>;
  /** Milliseconds between those looks, and at the MACs this machine has now (5000). */
  pollEvery?: number;
  /**
   * How the server reads the facts before they go to the page and the agent (server/index.ts: interpret.ts, and what
   * each device is doing from the history). The sensor never interprets: this is where the line runs (docs/sensor.md).
   */
  read?: <V extends Dissected>(facts: V) => V;
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
  /** A tshark is being started: no other may start meanwhile. */
  starting?: boolean;
  /** The one before, being stopped: the next waits for it. */
  exiting?: Promise<void>;
  retry?: ReturnType<typeof setTimeout>;
  /** Seconds to wait before trying again after it stopped (doubling, up to a minute). */
  backoff: number;
  stderr: string;
}

/** What an interface may be called: dumpcap's names (wlan0, br-1a2b, veth9f@if3, enp0s20f0u1). */
const IFACE = /^[\w.:@-]{1,64}$/;
const isState = (v: unknown): v is { on: string[]; started?: number; since?: Record<string, number> } => isObject(v) && Array.isArray(v.on);
const isTally = (v: unknown): v is TallyData => isObject(v) && Array.isArray(v.devices) && Array.isArray(v.flows);

export class Live {
  private tally: Tally;
  private started: number | undefined;
  private readonly listeners = new Map<string, Listener>();
  private readonly o: Required<Omit<LiveOptions, 'tally'>> & { tally: LiveOptions['tally'] };
  private timer: ReturnType<typeof setInterval> | undefined;
  private saver: ReturnType<typeof setInterval> | undefined;
  private poller: ReturnType<typeof setInterval> | undefined;
  /** What the page was last sent, to send only what changed: devices and hosts by a mark of what they show, links by weight. */
  private sentDevices = new Map<string, string>();
  private sentRemotes = new Map<string, string>();
  private sentLinks = new Map<string, number>();
  private sentConversations = new Map<string, string>();
  /** The number of the last event sent: a page that loads the view learns which events it already includes. */
  private seq = 0;
  private lastPackets = -1;
  private dirty = false;
  private stopping = false;

  constructor(options: LiveOptions) {
    this.o = {
      editcap: 'editcap',
      read: (v) => v,
      ssid: async () => undefined,
      ringFiles: 20,
      ringFileMB: 10,
      ringSeconds: 30,
      emitEvery: 1000,
      saveEvery: 60_000,
      pollEvery: 5000,
      tally: undefined,
      ...options,
    };
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
    const on = state.on.filter((id) => IFACE.test(id));
    // The rings of interfaces not on are from another time: what they hold is not this run's to save.
    for (const dir of await safeReaddir(path.join(this.o.dir, 'ring'))) {
      if (!on.some((id) => ringName(id) === dir)) await rm(path.join(this.o.dir, 'ring', dir), { recursive: true, force: true });
    }
    for (const id of on) this.listen(id, state.since?.[id]);
    this.timer = setInterval(() => this.emit(), this.o.emitEvery);
    this.saver = setInterval(() => void this.save(), this.o.saveEvery);
    this.poller = setInterval(() => void this.poll(), this.o.pollEvery);
    void this.poll();
    return this;
  }

  /**
   * What the system says now: the MACs this machine has (a Wi-Fi makes one up per network, a dock is plugged in), and
   * the SSID of each interface listened on. Facts for the tally: where this PC joined another network.
   */
  private polling = false;
  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      this.tally.addOwn(this.o.ownMacs());
      for (const id of this.on()) {
        const ssid = await this.o.ssid(id).catch(() => undefined);
        this.tally.ssid(id, ssid, Date.now() / 1000);
      }
    } finally {
      this.polling = false;
    }
  }

  /** Turns listening on `id` on or off. `known` are the interfaces this user can capture on. */
  async set(id: string, on: boolean, known: string[]): Promise<Session> {
    if (!IFACE.test(id) || (on && !known.includes(id))) throw new LiveError(`Unknown interface: ${id}`);
    if (on) this.listen(id);
    else this.unlisten(id);
    if (on) void this.poll();
    await this.saveState();
    this.emit(true);
    return this.session();
  }

  /** Begins the session again: what was seen is forgotten, and the rings of what is off; what is on goes on. */
  async reset(): Promise<void> {
    this.tally = this.newTally();
    this.started = this.on().length ? Date.now() / 1000 : undefined;
    this.sentDevices.clear();
    this.sentRemotes.clear();
    this.sentLinks.clear();
    this.sentConversations.clear();
    for (const [id, l] of this.listeners) {
      l.state.packets = 0;
      if (!l.state.on) {
        await rm(this.ringDir(id), { recursive: true, force: true });
        this.listeners.delete(id);
      }
    }
    await this.save();
    this.o.events.send({ type: 'reset' });
  }

  /**
   * The ring buffer's files, oldest first, of the interfaces given (by default every one listened on in this run, on
   * or turned off since): what "save" merges.
   */
  async ringFiles(ids?: string[]): Promise<string[]> {
    const out: { file: string; mtime: number }[] = [];
    for (const id of ids ?? [...this.listeners.keys()]) {
      if (!IFACE.test(id)) continue;
      for (const f of await this.ring(id)) if (f.size > 0) out.push(f);
    }
    return out.sort((a, b) => a.mtime - b.mtime).map((x) => x.file);
  }

  /** Cuts a merged capture to this session (the ring may hold minutes from before a reset). */
  async cut(file: string, out: string): Promise<void> {
    if (!this.started) return copyFile(file, out);
    await promisify(execFile)(this.o.editcap, ['-A', this.started.toFixed(6), file, out], { timeout: 120_000 });
  }

  view(): LiveView {
    this.tally.tick(Date.now() / 1000);
    const v = this.facts();
    return {
      seq: this.seq,
      session: this.session(),
      devices: this.withRates(v.devices),
      remotes: v.remotes,
      links: v.links,
      conversations: v.conversations,
      networks: v.networks ?? [],
      total: { fine: this.tally.fine.tail(), coarse: this.tally.coarse.tail() },
      byDevice: this.tally.activeByDevice(600),
      byInterface: this.tally.byInterface(),
    };
  }

  /** What the tally adds up to, with what is listened on now, read (interpret.ts). */
  private facts() {
    return this.o.read({ ...this.tally.view(), listening: this.on() });
  }

  /** What a capture view is for the agent: the session's devices and hosts, and the networks they were on. */
  hosts(): { devices: Device[]; remotes: Remote[]; links: Link[]; conversations: Conversation[]; networks: Network[] } {
    const v = this.facts();
    return { devices: this.withRates(v.devices), remotes: v.remotes, links: v.links, conversations: v.conversations, networks: v.networks ?? [] };
  }

  /** This machine's MACs, every one the session saw it have (a capture saved from it is read with them). */
  ownMacs(): string[] {
    return this.tally.ownMacs();
  }

  deviceSeries(id: string) {
    return this.tally.deviceSeries(id);
  }

  session(): Session {
    return {
      started: this.started,
      packets: this.tally.packets,
      bytes: this.tally.bytes,
      listening: [...this.listeners.values()].map((l) => {
        const s = this.tally.byInterface(4)[l.state.id];
        return { ...l.state, rate: s ? rateOf(s, Date.now() / 1000) : 0 };
      }),
      limits: {
        ringFiles: this.o.ringFiles,
        ringFileMB: this.o.ringFileMB,
        ringSeconds: this.o.ringSeconds,
        maxFlows: this.o.tally?.maxFlows ?? 20_000,
        maxDevices: this.o.tally?.maxDevices ?? 500,
      },
      rate: rateOf(this.tally.fine.tail(4), Date.now() / 1000),
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
    clearInterval(this.poller);
    for (const l of this.listeners.values()) clearTimeout(l.retry);
    await Promise.all([...this.listeners.values()].map((l) => this.kill(l)));
    await this.save();
  }

  /** `since`: when it was turned on, before a restart (it has been on since, as far as he is concerned). */
  private listen(id: string, since?: number) {
    let l = this.listeners.get(id);
    if (!l) {
      l = { state: { id, on: true, status: 'off', packets: 0, ringBytes: 0, ...(typeof since === 'number' ? { since } : {}) }, backoff: 2, stderr: '' };
      this.listeners.set(id, l);
    }
    l.state.on = true;
    this.started ??= Date.now() / 1000;
    // One at a time: already running, starting, or waiting to try again.
    if (l.child || l.starting || l.retry) return;
    void this.spawn(l);
  }

  private unlisten(id: string) {
    const l = this.listeners.get(id);
    if (!l) return;
    l.state.on = false;
    clearTimeout(l.retry);
    l.retry = undefined;
    l.exiting = this.kill(l);
    l.state.status = 'off';
    l.state.error = undefined;
    l.state.since = undefined;
  }

  private async spawn(l: Listener) {
    l.starting = true;
    const id = l.state.id;
    try {
      // The one before must be gone: two would count every packet twice and write into the same ring.
      await l.exiting;
      await mkdir(this.ringDir(id), { recursive: true });
    } catch {
      // dumpcap says it below, if the folder can't be had.
    }
    l.starting = false;
    if (!l.state.on || this.stopping || l.child) return;
    const args = [
      '-i',
      id,
      '-w',
      path.join(this.ringDir(id), 'ring.pcapng'),
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
      const row = parseLine(line);
      // The interface's name, always: a single-interface capture leaves it out on some versions.
      if (!row['frame.interface_name'].length) row['frame.interface_name'] = [id];
      this.tally.add(row);
      l.state.packets++;
      if (l.child === child && l.state.status !== 'listening') {
        l.state.status = 'listening';
        l.state.since ??= Date.now() / 1000;
        l.backoff = 2;
      }
      this.dirty = true;
    });
    child.on('spawn', () => {
      // Since it was turned on: a retry, or a restart that listens again, goes on from then.
      l.state.since ??= Date.now() / 1000;
      // A quiet network can take a while to show its first frame: once tshark says it is capturing, it is listening.
      setTimeout(() => {
        if (l.child === child && l.state.status === 'starting' && !/error|denied|permission/i.test(l.stderr)) l.state.status = 'listening';
      }, 1500);
    });
    child.on('error', (e) => {
      l.stderr += (e as NodeJS.ErrnoException).code === 'ENOENT' ? `${this.o.tshark} is not installed (scripts/install-capture.sh)` : e.message;
    });
    child.on('close', (code) => {
      // One that was stopped on purpose (turned off, or replaced) is no failure.
      if (l.child !== child) return;
      l.child = undefined;
      if (!l.state.on || this.stopping) return;
      // It stopped on its own: the interface went away, permission, tshark missing. Said, and tried again later.
      l.state.status = 'failed';
      l.state.error = said(l.stderr) || `tshark exited with ${code}`;
      l.retry = setTimeout(() => {
        l.retry = undefined;
        if (l.state.on && !l.child && !l.starting) void this.spawn(l);
      }, l.backoff * 1000);
      l.backoff = Math.min(60, l.backoff * 2);
      this.emit(true);
    });
  }

  private kill(l: Listener): Promise<void> {
    const child = l.child;
    l.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
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

  /** Once a second: to the page, what changed, numbered. */
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
    const v = this.facts();
    const changed = <T extends { id: string }>(list: T[], sent: Map<string, string>, mark: (x: T) => string) => {
      const out: T[] = [];
      const seen = new Set<string>();
      for (const x of list) {
        seen.add(x.id);
        const m = mark(x);
        if (sent.get(x.id) !== m) {
          sent.set(x.id, m);
          out.push(x);
        }
      }
      const gone = [...sent.keys()].filter((id) => !seen.has(id));
      for (const id of gone) sent.delete(id);
      return { out, gone };
    };
    const devices = changed(
      this.withRates(v.devices),
      this.sentDevices,
      (d) =>
        `${d.bytesSent}:${d.bytesReceived}:${d.lastSeen}:${d.names.length}:${d.ips.length}:${d.role ?? ''}:${d.networks?.join() ?? ''}:${d.rate?.sent ?? 0}:${d.rate?.received ?? 0}:${d.identity?.label ?? ''}:${d.identity?.confidence ?? ''}:${(d.doing ?? []).map((x) => `${x.what?.app ?? x.what?.category}${x.bytes}`).join(',')}:${d.dns?.length ?? 0}`,
    );
    const remotes = changed(v.remotes, this.sentRemotes, (r) => `${r.bytesSent + r.bytesReceived}:${r.lastSeen}:${r.names.length}`);
    const conversations = changed(v.conversations, this.sentConversations, (c) => `${c.sent}:${c.received}:${c.last}:${c.app?.app ?? ''}:${c.app?.activity ?? ''}`);
    const links: Link[] = [];
    const current = new Map<string, number>();
    for (const l of v.links) {
      const key = `${l.from}>${l.to}`;
      current.set(key, l.weight ?? 0);
      if (this.sentLinks.get(key) !== l.weight) links.push(l);
    }
    // Only the links there are now: one forgotten with its host is not remembered here either.
    this.sentLinks = current;
    const event: LiveEvent = {
      type: 'live',
      seq: ++this.seq,
      session: this.session(),
      devices: devices.out,
      goneDevices: devices.gone,
      remotes: remotes.out,
      gone: remotes.gone,
      links,
      conversations: conversations.out,
      goneConversations: conversations.gone,
      networks: v.networks ?? [],
      total: { fine: this.tally.fine.tail(5), coarse: this.tally.coarse.tail(2) },
      byDevice: this.tally.recentByDevice(5),
      byInterface: this.tally.byInterface(5),
    };
    this.o.events.send(event);
  }

  private withRates(devices: Device[]): Device[] {
    const now = Date.now() / 1000;
    return devices.map((d) => {
      const s = this.tally.deviceSeries(d.id, 4).fine;
      return s ? { ...d, rate: { sent: rateOf(s, now, 'sent'), received: rateOf(s, now, 'received') } } : d;
    });
  }

  /** What each ring holds now, its oldest files removed past the ceiling (dumpcap counts only its own run's). */
  private async measureRings() {
    for (const l of this.listeners.values()) {
      const files = (await this.ring(l.state.id)).sort((a, b) => a.mtime - b.mtime);
      for (const f of files.splice(0, Math.max(0, files.length - this.o.ringFiles))) await rm(f.file, { force: true });
      l.state.ringBytes = files.reduce((n, f) => n + f.size, 0);
    }
  }

  private async ring(id: string): Promise<{ file: string; mtime: number; size: number }[]> {
    const dir = this.ringDir(id);
    const out: { file: string; mtime: number; size: number }[] = [];
    for (const f of await safeReaddir(dir)) {
      if (!f.endsWith('.pcapng')) continue;
      const s = await stat(path.join(dir, f)).catch(() => undefined);
      if (s) out.push({ file: path.join(dir, f), mtime: s.mtimeMs, size: s.size });
    }
    return out;
  }

  private async save() {
    try {
      // Compact, not pretty: it is for this file to read back, and at its ceilings it is megabytes.
      await this.o.store.writeFileAtomic(this.file('session.json'), JSON.stringify(this.tally.save()));
      await this.saveState();
    } catch {
      // The store says it in the warnings; the session goes on in memory.
    }
  }

  private saveState() {
    const since = Object.fromEntries([...this.listeners.values()].filter((l) => l.state.on && l.state.since).map((l) => [l.state.id, l.state.since]));
    return this.o.store.writeJson(this.file('state.json'), { on: this.on(), started: this.started, since });
  }

  private ringDir(id: string) {
    return path.join(this.o.dir, 'ring', ringName(id));
  }

  private file(name: string) {
    return path.join(this.o.dir, name);
  }

  private tallyOptions(): TallyOptions {
    return { ownMacs: this.o.ownMacs(), maxDevices: 500, ...this.o.tally };
  }

  private newTally() {
    return new Tally(this.tallyOptions());
  }
}

/** An interface's ring folder: its name, with anything but letters, digits, "." and "-" written as %xx (one to one). */
export function ringName(id: string): string {
  return id.replace(/[^A-Za-z0-9.-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).replace(/^\.+$/, (d) => '%2e'.repeat(d.length));
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
  return /permission|not permitted|You don't have permission/i.test(text) ? `No permission to capture: ${text}` : text;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
