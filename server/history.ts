// The day, kept: what each device did, minute by minute, as aggregates (never a packet), so that a reload or a restart
// does not lose it and the diary can say "22:14 the TV started Netflix, 2.3 GB in an hour".
//
// Every few seconds `observe` is given what the live session adds up to (server/interpret.ts has read it): each
// conversation's bytes so far. What grew since the last look is this moment's traffic, under the device that spoke and
// what the dictionary says it is (shared/words.ts keyOf). That gives what each device is doing now (the last minute),
// and each minute is appended to the day's file, data/history/YYYY-MM-DD.jsonl (local time):
//
//   {"t":1761400000,"a":[["device:3c:…","video|Google|YouTube|watching video||",120034,5320], …]}   a minute
//   {"t":1761400013,"e":"clear","d":"device:…","w":"remote:198.51.100.77","p":"HTTP","c":1}           an event
//
// Events: a device seen for the first time ever, a conversation in the clear (once a day each), a server that agreed
// old TLS. Past days are gzipped; past ARGUS_HISTORY_DAYS days or ARGUS_HISTORY_MB, the oldest are removed. The
// devices' names and what they are, as last seen, are kept beside (devices.json), so a day can name a device that
// has since been forgotten.
//
// A session that began again counts from zero; a conversation whose total went down lost a flow past the tally's
// ceiling and counts nothing (the red team found it counted twice); one forgotten whole and heard again counts whole. After a restart, what began before it is the baseline at the first look: what happened while the server
// was down is not made up, and what began since is not lost.

import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Store } from '@organon/core/server/store';
import { isObject } from '@organon/core/server/store';
import { CATEGORIES } from '../shared/dictionary/apps.ts';
import type { Classification } from '../shared/classify.ts';
import { isOldTls } from '../shared/security.ts';
import type { Conversation, DayEvent, DayView, Device, Doing, Episode, Remote } from '../shared/types.ts';
import { BACKGROUND, fromKey, groupOf, keyOf } from '../shared/words.ts';

export interface HistoryOptions {
  dir: string;
  store: Store;
  /** Days kept (31), and at most this many MB on disk (200). */
  days?: number;
  mb?: number;
  /** For tests: what time it is (epoch seconds). */
  now?: () => number;
}

/** A device's name, and what it is, as last seen. */
interface Known {
  name: string;
  label?: string;
  kind?: string;
  first: number;
  last: number;
}

/** A minute counts as "doing" something from this many bytes (calls are light: a third). */
const ACTIVE = 30_000;
/** Pauses shorter than this keep one episode going (seconds). */
const GAP = 300;
/** What "now" looks back on (seconds). */
const NOW = 60;
/**
 * Ceilings against a neighbour that floods the network with made-up MACs (the red team filled 500 MB a day without
 * them): devices remembered, "new device" events a day (past it, one line says how many more), events a day in all.
 */
const KNOWN = 2000;
const NEW_A_DAY = 30;
const EVENTS_A_DAY = 500;

const label = (c: string) => CATEGORIES[c as keyof typeof CATEGORIES]?.label ?? c;
const isKnown = (v: unknown): v is Record<string, Known> => isObject(v);

export class History {
  private readonly o: Required<Omit<HistoryOptions, 'now'>> & { now: () => number };
  /** Each conversation's bytes at the last look. */
  private prev = new Map<string, number>();
  /** When the session being looked at began: another means it was reset. */
  private began: number | undefined;
  private baseline = true;
  /** This minute's bytes by device and key: [sent, received]. */
  private minute = new Map<string, [number, number]>();
  private minuteT = 0;
  /** The last minutes, per device: [t, key, bytes] of each look that moved something, for "now". */
  private recent = new Map<string, [number, string, number][]>();
  /** Per device and group: since when it has been going (no pause longer than GAP). */
  private streaks = new Map<string, { start: number; last: number }>();
  /** What each key was last said to be, whole (the history keeps only its words). */
  private words = new Map<string, Classification>();
  private known: Record<string, Known> = {};
  /** Today's events already written, so each is said once a day. */
  private said = new Set<string>();
  /** Today's events written, "new device" ones apart, and those not written past the ceiling. */
  private counted = { all: 0, fresh: 0, dropped: 0 };
  /** What today's file holds on disk; past the ceiling nothing more is written today (`full`). */
  private todayBytes = 0;
  full = false;
  private day = '';
  private loaded = false;
  /** When this history began looking (epoch seconds). */
  private started = 0;
  /** Until when a history that knew no device is learning the house (no "new device" events). */
  private learning = 0;
  /** The names of whom conversations were with, at the last look. */
  private others = new Map<string, string>();

  constructor(options: HistoryOptions) {
    this.o = { days: 31, mb: 200, now: () => Date.now() / 1000, ...options };
  }

  async load(): Promise<this> {
    await mkdir(this.o.dir, { recursive: true });
    this.known = await this.o.store.loadJson(path.join(this.o.dir, 'devices.json'), isKnown, {});
    this.day = dateOf(this.o.now());
    this.started = this.o.now();
    this.learning = Object.keys(this.known).length ? 0 : this.started + 600;
    // Today's events already said (before a restart) are not said again.
    this.todayBytes = (await stat(this.file(this.day)).catch(() => undefined))?.size ?? 0;
    for (const line of await this.lines(this.day)) if (line.e) this.count(line.e), this.said.add(eventKey(line.e, line.d ?? '', line.w ?? '', `${line.p ?? ''}${line.c ? '+login' : ''}`));
    this.loaded = true;
    // A day that ended while the server was down is gzipped now.
    for (const d of await this.days()) if (d !== this.day) await this.gzip(d);
    await this.prune();
    return this;
  }

  /** A look at what the live session adds up to: what grew since the last one is now's traffic. */
  async observe(view: { devices: Device[]; conversations: Conversation[]; remotes?: Remote[]; session?: { started?: number } }): Promise<void> {
    if (!this.loaded) return;
    const now = this.o.now();
    const t = Math.floor(now / 60) * 60;
    if (this.minuteT && t !== this.minuteT) await this.flush();
    this.minuteT = t;
    // The session began again (a reset): every counter starts from zero, so everything there now is new.
    const began = view.session?.started;
    if (began !== undefined && this.began !== undefined && began !== this.began) this.prev = new Map();
    if (began !== undefined) this.began = began;
    const names = new Map(view.devices.map((d) => [`device:${d.id}`, d]));
    this.others = new Map((view.remotes ?? []).map((r) => [`remote:${r.id}`, r.name]));
    for (const [k, d] of names) this.others.set(k, d.name);
    const next = new Map<string, number>();
    const events: Record<string, unknown>[] = [];
    for (const c of view.conversations) {
      const total = c.sent + c.received;
      next.set(c.id, total);
      // The first look: what began before this server did is the baseline (counted before a restart); what began
      // since is all new.
      if (this.baseline && c.first < this.started) continue;
      const before = this.baseline ? undefined : this.prev.get(c.id);
      // A total that went down is a flow of it forgotten past the tally's ceiling (the rest of it goes on): nothing new.
      // Only a conversation not seen at the last look (new, or forgotten whole and heard again) counts whole.
      const delta = before === undefined ? total : Math.max(0, total - before);
      if (!delta) continue;
      // Who did it: the device that spoke first (between two here, the one that asked).
      const device = c.a;
      const key = keyOf(c.app);
      if (c.app) this.words.set(key, c.app);
      const share = c.sent / (total || 1);
      const m = this.minute.get(`${device}\t${key}`) ?? [0, 0];
      m[0] += Math.round(delta * share);
      m[1] += delta - Math.round(delta * share);
      this.minute.set(`${device}\t${key}`, m);
      const r = this.recent.get(device) ?? [];
      r.push([now, key, delta]);
      this.recent.set(device, r);
      if (c.clear && !c.clear.harmless) events.push(this.event('clear', device, c.b, c.clear.proto, now, c.clear.credentials, c.b.startsWith('device:')));
      if (c.tls && isOldTls(c.tls)) events.push(this.event('old-tls', device, c.b, `TLS ${c.tls}`, now));
    }
    // Devices seen for the first time ever: said once. A history that knew nobody learns the house first (ten minutes):
    // everyone there is not news.
    for (const [key, d] of names) {
      const k = this.known[key];
      if (!k && now > this.learning && !this.baseline) events.push(this.event('new', key, '', '', now));
      this.known[key] = { name: d.name, label: d.identity?.label, kind: d.identity?.kind, first: k?.first ?? d.firstSeen, last: Math.max(k?.last ?? 0, d.lastSeen) };
    }
    this.prev = next;
    this.baseline = false;
    const fresh = events.filter(Boolean);
    if (fresh.length) await this.append(fresh);
    // Forget what "now" no longer looks at.
    for (const [d, r] of this.recent) {
      const kept = r.filter((x) => x[0] > now - NOW);
      if (kept.length) this.recent.set(d, kept);
      else this.recent.delete(d);
    }
    for (const [device, r] of this.recent) {
      const groups = new Set(r.map((x) => groupOf(this.words.get(x[1]))));
      for (const g of groups) {
        const k = `${device}\t${g}`;
        const s = this.streaks.get(k);
        this.streaks.set(k, s && now - s.last <= GAP ? { start: s.start, last: now } : { start: now, last: now });
      }
    }
  }

  /** What each device is doing now: the last minute's traffic by what it is, busiest first, background last. */
  doing(device: string): Doing[] | undefined {
    const r = this.recent.get(device);
    if (!r) return undefined;
    const by = new Map<string, { what?: Classification; bytes: number }>();
    for (const [, key, bytes] of r) {
      const what = this.words.get(key);
      const g = groupOf(what);
      const e = by.get(g) ?? { what, bytes: 0 };
      // The group says what its busiest key says.
      if (what && (!e.what || bytes > e.bytes)) e.what = what;
      e.bytes += bytes;
      by.set(g, e);
    }
    const out = [...by]
      .filter(([, e]) => e.bytes >= 2_000)
      .map(([g, e]) => ({ what: e.what as Classification, bytes: e.bytes, since: this.streaks.get(`${device}\t${g}`)?.start ?? this.o.now() }))
      .sort((a, b) => weight(b) - weight(a));
    return out.length ? out : undefined;
  }

  /** Writes the minute that is over. */
  async flush(): Promise<void> {
    if (!this.minute.size || !this.minuteT) return;
    const a = [...this.minute].map(([k, [s, r]]) => {
      const [device, key] = k.split('\t');
      return [device, key, s, r];
    });
    this.minute = new Map();
    await this.append([{ t: this.minuteT, a }], this.minuteT);
    // The devices remembered, at most KNOWN: the ones heard longest ago go first.
    const ids = Object.keys(this.known);
    if (ids.length > KNOWN) for (const id of ids.sort((a, b) => this.known[a]!.last - this.known[b]!.last).slice(0, ids.length - KNOWN)) delete this.known[id];
    await this.o.store.writeJson(path.join(this.o.dir, 'devices.json'), this.known).catch(() => {});
  }

  /** A day as it was kept: by hour and category, by device, the diary and the events. */
  async dayView(date = dateOf(this.o.now()), device?: string): Promise<DayView> {
    const lines = await this.lines(date);
    if (date === dateOf(this.o.now()) && this.minute.size) {
      // The minute going on, too: a reload shows what is happening.
      lines.push({ t: this.minuteT, a: [...this.minute].map(([k, [s, r]]) => [...k.split('\t'), s, r] as [string, string, number, number]) });
    }
    const hours: Record<string, number>[] = Array.from({ length: 24 }, () => ({}));
    const cats = new Map<string, number>();
    const devs = new Map<string, { bytes: number; keys: Map<string, number> }>();
    const minutes = new Map<string, Map<number, number>>(); // device\tgroup → minute → bytes
    const groupKey = new Map<string, Map<string, number>>(); // device\tgroup → key → bytes
    const events: DayEvent[] = [];
    let total = 0;
    let first: number | undefined;
    let last: number | undefined;
    for (const l of lines) {
      if (l.e) {
        if (device && l.d !== device) continue;
        events.push({
          t: l.t,
          type: l.e as DayEvent['type'],
          device: l.d ?? '',
          deviceName: this.known[l.d ?? '']?.name ?? l.n ?? l.d ?? '',
          ...(l.w ? { with: l.w, withName: l.wn ?? l.w.replace(/^\w+:/, '') } : {}),
          ...(l.p ? { proto: l.p } : {}),
          ...(l.c ? { credentials: true } : {}),
          ...(l.l ? { local: true } : {}),
        });
        continue;
      }
      for (const [d, key, s, r] of l.a ?? []) {
        if (device && d !== device) continue;
        const bytes = s + r;
        total += bytes;
        first = Math.min(first ?? l.t, l.t);
        last = Math.max(last ?? l.t, l.t);
        const cat = key.split('|')[0] ?? '';
        const h = hours[new Date(l.t * 1000).getHours()]!;
        h[cat] = (h[cat] ?? 0) + bytes;
        cats.set(cat, (cats.get(cat) ?? 0) + bytes);
        const dv = devs.get(d) ?? { bytes: 0, keys: new Map() };
        dv.bytes += bytes;
        dv.keys.set(key, (dv.keys.get(key) ?? 0) + bytes);
        devs.set(d, dv);
        const g = `${d}\t${groupOf(fromKey(key, label))}`;
        const m = minutes.get(g) ?? new Map<number, number>();
        m.set(l.t, (m.get(l.t) ?? 0) + bytes);
        minutes.set(g, m);
        const gk = groupKey.get(g) ?? new Map<string, number>();
        gk.set(key, (gk.get(key) ?? 0) + bytes);
        groupKey.set(g, gk);
      }
    }
    const now = this.o.now();
    const diary: Episode[] = [];
    for (const [g, m] of minutes) {
      const [d = ''] = g.split('\t');
      const keys = [...(groupKey.get(g) ?? [])].sort((a, b) => b[1] - a[1]);
      const what = fromKey(keys[0]?.[0] ?? '', label);
      const enough = what?.category === 'calls' ? ACTIVE / 3 : ACTIVE;
      const ts = [...m].filter(([, b]) => b >= enough).map(([t]) => t).sort((a, b) => a - b);
      let ep: Episode | undefined;
      const close = () => {
        if (!ep) return;
        // Its bytes: every minute of the group within it, the quiet ones too.
        const { start, end } = ep;
        ep.bytes = [...m].filter(([t]) => t >= start && t < end).reduce((n, [, b]) => n + b, 0);
        if (worth(ep)) diary.push(ep);
        ep = undefined;
      };
      for (const t of ts) {
        if (ep && t - ep.end > GAP) close();
        if (!ep) ep = { start: t, end: t + 60, device: d, deviceName: this.known[d]?.name ?? d, ...(this.known[d]?.label ? { deviceLabel: this.known[d]!.label } : {}), ...(what ? { what } : {}), bytes: 0 };
        ep.end = t + 60;
      }
      close();
    }
    const stories = merge(diary);
    for (const e of stories) if (e.end >= now - 120) e.ongoing = true;
    stories.sort((a, b) => b.start - a.start);
    return {
      date,
      days: await this.days(),
      hours,
      categories: [...cats].sort((a, b) => b[1] - a[1]).map(([category, bytes]) => ({ category, label: category ? label(category) : 'Not named', bytes })),
      devices: [...devs]
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .map(([id, v]) => ({
          id,
          name: this.known[id]?.name ?? id,
          ...(this.known[id]?.label ? { label: this.known[id]!.label } : {}),
          ...(this.known[id]?.kind ? { kind: this.known[id]!.kind } : {}),
          bytes: v.bytes,
          top: [...v.keys].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, bytes]) => ({ ...(fromKey(k, label) ? { what: fromKey(k, label) } : {}), bytes })),
        })),
      diary: stories,
      events: once(events).sort((a, b) => b.t - a.t),
      bytes: total,
      ...(date === this.day && this.counted.dropped ? { dropped: this.counted.dropped } : {}),
      ...(date === this.day && this.full ? { full: true } : {}),
      ...(first !== undefined ? { first, last: (last ?? first) + 60 } : {}),
    };
  }

  /** The days kept, newest first. */
  async days(): Promise<string[]> {
    const files = await readdir(this.o.dir).catch(() => [] as string[]);
    const days = new Set(files.map((f) => /^(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/.exec(f)?.[1]).filter((d): d is string => Boolean(d)));
    return [...days].sort().reverse();
  }

  /** A device known to the history, by its id, MAC or name (whole, then a part of it), newest first on a tie. */
  find(q: string): { key: string; known: Known; alike: number } | undefined {
    const s = q.trim().toLowerCase();
    const all = Object.entries(this.known).sort((a, b) => b[1].last - a[1].last);
    const hit =
      all.find(([k, v]) => k.toLowerCase() === s || k.toLowerCase() === `device:${s}` || v.name.toLowerCase() === s) ??
      all.find(([, v]) => v.name.toLowerCase().includes(s) || (v.label ?? '').toLowerCase().includes(s));
    if (!hit) return undefined;
    const alike = all.filter(([k, v]) => k !== hit[0] && v.name.toLowerCase() === hit[1].name.toLowerCase()).length;
    return { key: hit[0], known: hit[1], alike };
  }

  /** The devices known, with their names as last seen. */
  device(id: string): Known | undefined {
    return this.known[id];
  }

  private event(type: DayEvent['type'], device: string, other: string, proto: string, t: number, credentials?: boolean, local?: boolean): Record<string, unknown> {
    // A login seen later in the same conversation is news again: it upgrades the event (dayView keeps the one with it).
    const key = eventKey(type, device, other, `${proto}${credentials ? '+login' : ''}`);
    if (this.said.has(key)) return undefined as unknown as Record<string, unknown>;
    this.said.add(key);
    if (this.counted.all >= EVENTS_A_DAY || (type === 'new' && this.counted.fresh >= NEW_A_DAY)) {
      this.counted.dropped++;
      return undefined as unknown as Record<string, unknown>;
    }
    this.count(type);
    return { t: Math.round(t), e: type, d: device, n: this.known[device]?.name, ...(other ? { w: other, wn: this.others.get(other) } : {}), ...(proto ? { p: proto } : {}), ...(credentials ? { c: 1 } : {}), ...(local ? { l: 1 } : {}) };
  }

  private count(type: string) {
    this.counted.all++;
    if (type === 'new') this.counted.fresh++;
  }

  private async append(lines: Record<string, unknown>[], t = this.o.now()) {
    const date = dateOf(t);
    if (date !== this.day) await this.rollover(date);
    const text = lines.map((l) => `${JSON.stringify(l)}\n`).join('');
    // One day may not take the whole ceiling: past it, the day stops being written (and says so).
    if (this.todayBytes + text.length > this.o.mb * 1024 * 1024) {
      this.full = true;
      return;
    }
    this.todayBytes += text.length;
    await appendFile(this.file(date), text).catch(() => {});
  }

  /** A new day: yesterday's file gzipped, today's events said afresh, the oldest days removed past the ceilings. */
  private async rollover(date: string) {
    const before = this.day;
    this.day = date;
    this.said.clear();
    this.counted = { all: 0, fresh: 0, dropped: 0 };
    this.todayBytes = 0;
    this.full = false;
    await this.gzip(before);
    await this.prune();
  }

  private async gzip(date: string) {
    const plain = this.file(date);
    try {
      const raw = await readFile(plain);
      await writeFile(`${plain}.gz`, gzipSync(raw));
      await rm(plain, { force: true });
    } catch {
      // Nothing kept that day, or already gzipped.
    }
  }

  private async prune() {
    const days = await this.days();
    const sizes: [string, number][] = [];
    for (const d of days) {
      let size = 0;
      for (const f of [this.file(d), `${this.file(d)}.gz`]) size += (await stat(f).catch(() => undefined))?.size ?? 0;
      sizes.push([d, size]);
    }
    let total = sizes.reduce((n, [, s]) => n + s, 0);
    // Newest first: past the days kept, or past the megabytes, the oldest go (never today).
    for (let i = sizes.length - 1; i >= 1; i--) {
      const [d, s] = sizes[i]!;
      if (i >= this.o.days || total > this.o.mb * 1024 * 1024) {
        await rm(this.file(d), { force: true });
        await rm(`${this.file(d)}.gz`, { force: true });
        total -= s;
      }
    }
  }

  private async lines(date: string): Promise<Line[]> {
    let text = '';
    try {
      text = (await readFile(this.file(date))).toString();
    } catch {
      try {
        text = gunzipSync(await readFile(`${this.file(date)}.gz`)).toString();
      } catch {
        return [];
      }
    }
    const out: Line[] = [];
    for (const l of text.split('\n')) {
      if (!l) continue;
      try {
        out.push(JSON.parse(l));
      } catch {
        // A line cut short by a crash: the rest of the day still reads.
      }
    }
    return out;
  }

  private file(date: string) {
    return path.join(this.o.dir, `${date}.jsonl`);
  }
}

interface Line {
  t: number;
  a?: [string, string, number, number][];
  e?: string;
  d?: string;
  n?: string;
  w?: string;
  wn?: string;
  p?: string;
  c?: number;
  l?: number;
}

/** One event per kind, device, other end and protocol: the one with a login if there is one, else the first. */
function once(events: DayEvent[]): DayEvent[] {
  const by = new Map<string, DayEvent>();
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const k = eventKey(e.type, e.device, e.with ?? '', e.proto ?? '');
    const had = by.get(k);
    if (!had || (e.credentials && !had.credentials)) by.set(k, had ? { ...e, t: had.t } : e);
  }
  return [...by.values()];
}

const eventKey = (type: string, device: string, other: string, proto: string) => `${type}\t${device}\t${other}\t${proto}`;

/** YYYY-MM-DD in local time. */
export function dateOf(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One device doing several things at once is one story: episodes of a device that overlap (or nearly) become one,
 * headed by the call if there is one, else by the busiest, with the rest as `also`.
 */
function merge(episodes: Episode[]): Episode[] {
  const out: Episode[] = [];
  const byDevice = new Map<string, Episode[]>();
  for (const e of episodes) byDevice.set(e.device, [...(byDevice.get(e.device) ?? []), e]);
  for (const list of byDevice.values()) {
    list.sort((a, b) => a.start - b.start);
    let group: Episode[] = [];
    let end = 0;
    const close = () => {
      if (!group.length) return;
      const head = [...group].sort((a, b) => weight({ what: b.what, bytes: b.bytes }) - weight({ what: a.what, bytes: a.bytes }))[0]!;
      const also = group.filter((e) => e !== head).sort((a, b) => b.bytes - a.bytes);
      out.push({
        ...head,
        start: Math.min(...group.map((e) => e.start)),
        end: Math.max(...group.map((e) => e.end)),
        bytes: group.reduce((n, e) => n + e.bytes, 0),
        ...(also.length ? { also: also.map((e) => e.what).filter((w): w is Classification => Boolean(w)) } : {}),
      });
      group = [];
    };
    for (const e of list) {
      if (group.length && e.start > end + GAP) close();
      group.push(e);
      end = Math.max(group.length > 1 ? end : 0, e.end);
    }
    close();
  }
  return out;
}

/** Calls first (light but what someone is doing), then by bytes; the network's own chatter last. */
function weight(d: { what?: Classification; bytes: number }): number {
  if (!d.what) return d.bytes / 4;
  if (BACKGROUND.has(d.what.category)) return d.bytes / 100;
  // A call is light but it is what someone is doing: ahead of any download.
  return d.what.category === 'calls' && d.bytes >= 10_000 ? 1e12 + d.bytes : d.bytes;
}

/** Worth a line in the diary: someone doing something for a while, or a lot of it; never the network's own chatter. */
function worth(e: Episode): boolean {
  const minutes = (e.end - e.start) / 60;
  const cat = e.what?.category;
  if (!cat) return e.bytes >= 100 * 1024 * 1024;
  if (cat === 'cdn') return e.bytes >= 50 * 1024 * 1024;
  if (BACKGROUND.has(cat)) return false;
  if (cat === 'calls') return minutes >= 2;
  return e.bytes >= 2 * 1024 * 1024 || (minutes >= 5 && e.bytes >= 1024 * 1024);
}
