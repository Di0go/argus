// The HTTP requests that went by, and their answers: part of the sensor (docs/sensor.md), fed the same tshark line per
// frame as the tally (server/tally.ts), which hands each one here with what it decided (the interface's stay, the
// devices at each end).
//
// What is read: plain HTTP/1 from any device heard; inside TLS only where tshark had the session's keys (a key log
// file, tls.keylog_file: the programs on this PC that write one, docs/requests.md), HTTP/1.1 and HTTP/2. HTTP/3 (QUIC)
// is decrypted by tshark with the same keys, but its requests are not read here yet. What is kept is metadata: the
// request line, a few headers by name, the status, the size, the time it took. Never a body; of Cookie, Set-Cookie and
// Authorization only that they went by; of every other header only its name.
//
// HTTP/1: one message per frame (the first, when tshark put two pipelined in one), the answer matched to its request
// by the frame tshark says it answers (http.request_in, known in a single pass). HTTP/2: a frame holds many of its own
// frames, and tshark lists their fields in order: the header names and values of every HEADERS frame one after the
// other, and the type, stream and length of every frame. So the header list is cut into blocks (each begins with its
// pseudo-headers), the blocks matched in order to the HEADERS frames, and so to their streams: a request opens its
// stream, the answer comes on it, its DATA frames add up its size. A frame whose blocks and HEADERS frames do not agree
// in number (a header block tshark could not decode, after it lost the connection's start) is passed over, not guessed.
//
// Bounded: the newest `max` requests are kept (ARGUS_MAX_REQUESTS), and at most PENDING awaiting an answer, the
// oldest forgotten; a URL is cut at URL_LENGTH characters and a header value at VALUE_LENGTH.

import type { HttpRequest, HttpResponse } from '../shared/types.ts';

/** The fields of tshark's line this reads (server/tally.ts asks for them with its own). */
export const REQUEST_FIELDS = [
  'frame.number',
  'tcp.stream',
  'http.request.method',
  'http.request.full_uri',
  'http.request.version',
  'http.request.line',
  'http.response.code',
  'http.response.phrase',
  'http.response.line',
  'http.request_in',
  'http.chunk_size',
  'http2.type',
  'http2.streamid',
  'http2.length',
  'http2.header.name',
  'http2.header.value',
] as const;

type Get = (field: string) => string[];

/** What the tally decided of a frame: where it was heard, and the devices at each end. */
export interface FrameContext {
  time: number;
  iface: string;
  segment?: string;
  sender?: string;
  receiver?: string;
  ipSrc?: string;
  ipDst?: string;
  srcPort?: number;
  dstPort?: number;
  /** The frame's layers (frame.protocols), split. */
  layers: string[];
}

const URL_LENGTH = 2000;
const VALUE_LENGTH = 300;
const NAMES = 40;
const PENDING = 1000;
/** The request headers whose values are kept, and the answer's. */
const REQUEST_HEADERS = ['user-agent', 'referer', 'content-type', 'content-length', 'accept', 'origin'];
const RESPONSE_HEADERS = ['content-type', 'content-length', 'server', 'location', 'content-encoding', 'cache-control'];

export class Requests {
  readonly max: number;
  /** Oldest first, by id. */
  private readonly kept = new Map<string, HttpRequest>();
  /** Awaiting an answer: HTTP/1 by the request's frame, HTTP/2 by its stream (and on, for its DATA). */
  private readonly pending = new Map<string, HttpRequest>();
  /** The ids that changed since `changed()` was last asked. */
  private readonly touched = new Set<string>();
  private count = 0;

  constructor(max = 2000) {
    this.max = max;
  }

  /** Reads one frame's HTTP, if it carries any. */
  add(get: Get, c: FrameContext): void {
    const tls = c.layers.includes('tls');
    if (c.layers.includes('http2')) this.http2(get, c, tls);
    else if (c.layers.includes('http')) this.http1(get, c, tls);
  }

  /** Every request kept, oldest first. */
  all(): HttpRequest[] {
    return [...this.kept.values()];
  }

  /** The requests new or answered since the last time this was asked. */
  changed(): HttpRequest[] {
    const out = [...this.touched].map((id) => this.kept.get(id)).filter((r): r is HttpRequest => Boolean(r));
    this.touched.clear();
    return out;
  }

  /** Kept on disk with the session (no answer is awaited across a restart: its connection is gone). */
  save(): HttpRequest[] {
    return this.all();
  }

  load(list: HttpRequest[]) {
    for (const r of list.slice(-this.max)) if (r && typeof r.id === 'string' && typeof r.url === 'string') this.kept.set(r.id, r);
    this.count = list.length;
  }

  private http1(get: Get, c: FrameContext, tls: boolean) {
    const method = get('http.request.method')[0];
    if (method) {
      const lines = headerLines(get('http.request.line'));
      const value = (n: string) => lines.find(([k]) => k === n)?.[1];
      const uri = get('http.request.full_uri')[0] ?? '';
      const host = hostOf(get('http.host')[0]) || hostOf(safeHost(uri));
      const r = this.request(c, {
        host,
        method: cut(method, 16),
        url: cut(uri || `${tls ? 'https' : 'http'}://${host}`, URL_LENGTH),
        version: cut(get('http.request.version')[0] ?? 'HTTP/1.1', 16),
        tls,
        headers: kept(lines, REQUEST_HEADERS),
        names: names(lines.map(([k]) => k)),
        ...(value('cookie') !== undefined ? { cookie: true } : {}),
        ...(value('authorization') !== undefined || get('http.authorization').length ? { authorization: true } : {}),
      });
      const frame = get('frame.number')[0];
      if (frame) this.await(`${c.iface}|f${frame}`, r);
    }
    const code = Number(get('http.response.code')[0]);
    if (Number.isInteger(code) && code > 0) {
      const asked = get('http.request_in')[0];
      const r = asked ? this.pending.get(`${c.iface}|f${asked}`) : undefined;
      // 1xx is not the answer: the real one follows, answering the same request.
      if (!r || code < 200) return;
      this.pending.delete(`${c.iface}|f${asked}`);
      const lines = headerLines(get('http.response.line'));
      const length = lines.find(([k]) => k === 'content-length')?.[1];
      const chunks = get('http.chunk_size').reduce((n, s) => n + (Number(s) || 0), 0);
      this.answer(r, {
        status: code,
        ...(get('http.response.phrase')[0] ? { phrase: cut(get('http.response.phrase')[0]!, 64) } : {}),
        time: c.time,
        headers: kept(lines, RESPONSE_HEADERS),
        names: names(lines.map(([k]) => k)),
        ...(length !== undefined && Number(length) >= 0 ? { size: Number(length) } : chunks ? { size: chunks } : {}),
        ...(lines.some(([k]) => k === 'set-cookie') ? { setCookie: true } : {}),
      });
    }
  }

  private http2(get: Get, c: FrameContext, tls: boolean) {
    const stream = get('tcp.stream')[0] ?? '';
    const types = get('http2.type');
    const ids = get('http2.streamid');
    const lengths = get('http2.length');
    const key = (id: string) => `${c.iface}|s${stream}|${id}`;
    const headersOn = types.flatMap((t, i) => (t === '1' ? [ids[i] ?? ''] : []));
    const blocks = headerBlocks(get('http2.header.name'), get('http2.header.value'));
    if (blocks && blocks.length === headersOn.length) {
      blocks.forEach((b, i) => {
        const id = headersOn[i]!;
        const pseudo = (n: string) => b.find(([k]) => k === n)?.[1];
        const regular = b.filter(([k]) => !k.startsWith(':')).map(([k, v]): [string, string] => [k.toLowerCase(), v]);
        const value = (n: string) => regular.find(([k]) => k === n)?.[1];
        const method = pseudo(':method');
        const status = Number(pseudo(':status'));
        if (method) {
          const authority = pseudo(':authority') ?? value('host') ?? '';
          const scheme = pseudo(':scheme') ?? (tls ? 'https' : 'http');
          const r = this.request(c, {
            host: hostOf(authority),
            method: cut(method, 16),
            url: cut(`${scheme}://${withoutDefaultPort(scheme, authority)}${pseudo(':path') ?? ''}`, URL_LENGTH),
            version: 'HTTP/2',
            tls,
            headers: kept(regular, REQUEST_HEADERS),
            names: names(regular.map(([k]) => k)),
            ...(value('cookie') !== undefined ? { cookie: true } : {}),
            ...(value('authorization') !== undefined ? { authorization: true } : {}),
          });
          this.await(key(id), r);
        } else if (Number.isInteger(status) && status > 0) {
          const r = this.pending.get(key(id));
          // 1xx is not the answer: the real one comes after it on the same stream.
          if (!r || status < 200) return;
          const length = Number(value('content-length'));
          this.answer(r, {
            status,
            time: c.time,
            headers: kept(regular, RESPONSE_HEADERS),
            names: names(regular.map(([k]) => k)),
            ...(Number.isFinite(length) && length >= 0 && value('content-length') !== undefined ? { size: length } : {}),
            ...(value('set-cookie') !== undefined ? { setCookie: true } : {}),
          });
        }
      });
    }
    // DATA frames: the answer's body as it comes, when it did not say its length.
    types.forEach((t, i) => {
      if (t !== '0') return;
      const r = this.pending.get(key(ids[i] ?? ''));
      const n = Number(lengths[i]);
      if (!r?.response || !(n > 0) || r.response.headers['content-length'] !== undefined) return;
      r.response.size = (r.response.size ?? 0) + n;
      this.touched.add(r.id);
    });
  }

  private request(c: FrameContext, what: Pick<HttpRequest, 'host' | 'method' | 'url' | 'version' | 'tls' | 'headers' | 'names' | 'cookie' | 'authorization'>): HttpRequest {
    const id = `${Math.round(c.time * 1000)}-${++this.count}`;
    const r: HttpRequest = {
      id,
      time: c.time,
      iface: c.iface,
      ...(c.segment ? { segment: c.segment } : {}),
      // The one who asked is the sender; a device here is named, a host out there by its address.
      ...(c.sender ? { device: c.sender } : {}),
      ...(c.receiver ? { server: c.receiver } : {}),
      ...(c.ipDst ? { ip: c.ipDst } : {}),
      ...(c.dstPort ? { port: c.dstPort } : {}),
      ...what,
    };
    this.kept.set(id, r);
    this.touched.add(id);
    while (this.kept.size > this.max) {
      const oldest = this.kept.keys().next().value!;
      this.kept.delete(oldest);
      this.touched.delete(oldest);
    }
    return r;
  }

  private answer(r: HttpRequest, response: HttpResponse) {
    r.response = response;
    if (this.kept.has(r.id)) this.touched.add(r.id);
  }

  private await(key: string, r: HttpRequest) {
    this.pending.delete(key);
    this.pending.set(key, r);
    if (this.pending.size > PENDING) this.pending.delete(this.pending.keys().next().value!);
  }
}

/**
 * HTTP/2's header list cut into its blocks: one begins at a pseudo-header after a regular one, at one the block already
 * has, or at an answer's (:status) after a request's or the other way. Undefined when names and values do not pair up.
 */
export function headerBlocks(names: string[], values: string[]): [string, string][][] | undefined {
  if (names.length !== values.length) return undefined;
  const out: [string, string][][] = [];
  let block: [string, string][] | undefined;
  names.forEach((n, i) => {
    const pseudo = n.startsWith(':');
    // A request's pseudo-headers and an answer's never share a block, nor does one name come twice.
    const other = (k: string) => (n === ':status') !== (k === ':status');
    const restart = !block || (pseudo && (!block.at(-1)![0].startsWith(':') || block.some(([k]) => k === n || (k.startsWith(':') && other(k)))));
    if (restart) out.push((block = []));
    block!.push([n, values[i]!]);
  });
  return out;
}

/** HTTP/1's header lines as tshark gives them ("Name: value\\r\\n"), as [name in lower case, value]. */
function headerLines(lines: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const l of lines) {
    const m = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*?)(?:\\r\\n|\r\n)?$/.exec(l);
    if (m) out.push([m[1]!.toLowerCase(), m[2]!]);
  }
  return out;
}

/** The values of the headers worth keeping, by name; every other value is left behind. */
function kept(headers: [string, string][], wanted: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of wanted) {
    const v = headers.find(([k]) => k === n)?.[1];
    if (v) out[n] = cut(v, VALUE_LENGTH);
  }
  return out;
}

function names(list: string[]): string[] {
  const out: string[] = [];
  for (const n of list) {
    const k = n.toLowerCase().slice(0, 64);
    if (!out.includes(k) && out.length < NAMES) out.push(k);
  }
  return out;
}

/** An authority without the scheme's own port, as a browser writes it (shop.example:443 → shop.example). */
function withoutDefaultPort(scheme: string, authority: string): string {
  return authority.replace(scheme === 'https' ? /:443$/ : scheme === 'http' ? /:80$/ : /$^/, '');
}

/** A Host as asked, without its port and in lower case. */
function hostOf(host: string | undefined): string {
  if (!host) return '';
  const h = host.trim().toLowerCase();
  const v6 = /^\[([^\]]+)\]/.exec(h);
  return cut(v6 ? v6[1]! : h.replace(/:\d+$/, ''), 253);
}

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
}

/** At most `n` characters, control characters and bidirectional overrides out (what came in off the network). */
function cut(s: string, n: number): string {
  const clean = s.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '');
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}
