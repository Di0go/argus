// Reading the router: which devices it knows (name, MAC, address, cable or Wi-Fi), asked of its own web page, one
// model at a time. Like the scan (server/sources.ts), it runs only when he presses its button, on the network this PC
// is on now, and the page says what it does: it logs in to the router as its owner would, reads the list of devices,
// and logs out. It changes nothing on the router.
//
// Each model is an adapter (`RouterAdapter`, in server/routers/, listed in server/routers/all.ts): how to tell its page, how to log in, where
// the list is. The password is his, typed on the page once and kept on this machine only (`RouterKeys`:
// ~/.config/argus/routers.json, mode 600, by the router's MAC), never in the repository, a log or an answer of the API;
// and it is only ever given to the router whose MAC it was saved under. A model whose factory password is public (the
// same on every box) has it in `defaults`, tried first, and the page says when it let Argus in: that is also a warning.

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A device the router knows. */
export interface RouterClient {
  mac: string;
  ip?: string;
  hostname?: string;
  link?: 'cable' | 'wifi';
  /** Where it is plugged or which band: "LAN 2", "5GHz". */
  port?: string;
  ssid?: string;
  /** Connected now, as the router says; the others it only remembers. */
  connected: boolean;
}

/** One model of router: how to tell its page, log in and read its devices. */
export interface RouterAdapter {
  id: string;
  /** The model as he would say it. */
  name: string;
  /** The user its page logs in with, when the page asks only for a password. */
  user: string;
  /** Factory passwords that are public, the same on every box of this model: tried first, when none is saved. */
  defaults: string[];
  /** Where the factory password is, when each box has its own: said beside the field. */
  factory: string;
  /** Whether the page at `base` is this model's: a GET or two of what the page shows before logging in. */
  detect(http: RouterHttp, base: string): Promise<boolean>;
  /** How many tries the router allows before it locks its page, when it says. */
  attemptsLeft?(http: RouterHttp, base: string): Promise<number | undefined>;
  /** Logs in (a `Refused` when the password is wrong), reads the devices it knows, and logs out. */
  read(http: RouterHttp, base: string, user: string, password: string): Promise<RouterClient[]>;
}

/** The router said no to the password. */
export class Refused extends Error {}

/** A small HTTP client for a router's page: a cookie jar, a timeout, no redirects followed. */
export class RouterHttp {
  private readonly cookies = new Map<string, string>();
  private readonly timeout: number;
  constructor(timeout = 8000) {
    this.timeout = timeout;
  }

  async get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; text: string }> {
    const jar = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(url, {
      headers: { ...headers, ...(jar ? { Cookie: jar } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeout),
    });
    for (const c of res.headers.getSetCookie()) {
      const m = /^([^=;\s]+)=([^;]*)/.exec(c);
      if (m) this.cookies.set(m[1]!, m[2]!);
    }
    return { status: res.status, headers: res.headers, text: await res.text() };
  }

  async json(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; data: unknown }> {
    const r = await this.get(url, headers);
    return { status: r.status, headers: r.headers, data: r.status === 200 ? lenientJson(r.text) : undefined };
  }
}

/** A router's JSON, written by templates: a comma before a closing brace is forgiven. */
export function lenientJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return undefined;
    }
  }
}

/** What is kept for one router: the user and password that let Argus in, and its model. */
export interface RouterKey {
  user: string;
  password: string;
  model: string;
  /** Epoch seconds. */
  saved: number;
}

/**
 * The passwords of his routers, on this machine only: a JSON file readable by this user alone (600, in a folder of
 * 700), by the router's MAC. Never in the data folder (a capture or a backup of it must not carry them), the
 * repository, a log, or anything the API sends back: the page learns only that one is saved, and for which user.
 */
export class RouterKeys {
  readonly file: string;
  constructor(file: string) {
    this.file = file;
  }

  async all(): Promise<Record<string, RouterKey>> {
    try {
      const v = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, RouterKey>) : {};
    } catch {
      return {};
    }
  }

  async get(mac: string): Promise<RouterKey | undefined> {
    return (await this.all())[mac.toLowerCase()];
  }

  async set(mac: string, key: RouterKey): Promise<void> {
    const all = await this.all();
    all[mac.toLowerCase()] = key;
    await this.write(all);
  }

  async forget(mac: string): Promise<boolean> {
    const all = await this.all();
    if (!all[mac.toLowerCase()]) return false;
    delete all[mac.toLowerCase()];
    await this.write(all);
    return true;
  }

  private async write(all: Record<string, RouterKey>): Promise<void> {
    const dir = path.dirname(this.file);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Written aside at 600 and moved over: never, even for a moment, readable by another user.
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
  }
}

/** The router at the way out, as the page asks it to be read. */
export interface RouterAsk {
  /** `http://<the gateway's address>` (or ARGUS_ROUTER_URL, for the tests and the demo). */
  base: string;
  /** The router's MAC: what its password is kept by, and checked against before it is given. */
  mac: string;
  /** A password he typed, to try (and keep, if it lets Argus in). */
  password?: string;
  user?: string;
}

/** What reading the router came to. */
export type RouterOutcome =
  | { ok: true; model: string; clients: RouterClient[]; factory: boolean; saved: boolean }
  | { ok: false; model?: string; need?: 'password'; /** Where the factory password is. */ hint?: string; user?: string; error: string; attemptsLeft?: number };

/** Below this, Argus does not try a password the router may refuse: the page would lock him out of his own router. */
const SPARE_ATTEMPTS = 2;

/**
 * Reads the router: which model (the first adapter that knows its page), then which password (the one he typed, else
 * the one saved for this MAC, else a public factory one), then the list. A password that works and was typed is kept;
 * one that does not is never kept. When there is none to try, it says so, with where the factory one is.
 */
export async function readRouter(ask: RouterAsk, keys: RouterKeys, adapters: RouterAdapter[]): Promise<RouterOutcome> {
  const http = new RouterHttp();
  let adapter: RouterAdapter | undefined;
  for (const a of adapters) {
    if (await a.detect(http, ask.base).catch(() => false)) {
      adapter = a;
      break;
    }
  }
  if (!adapter) {
    return {
      ok: false,
      error: `The router's page is not one Argus can read yet. It reads: ${adapters.map((a) => a.name).join(', ')}. Another model needs its own adapter (server/routers/).`,
    };
  }
  const model = adapter.name;
  const saved = await keys.get(ask.mac);
  const tries: { user: string; password: string; how: 'typed' | 'saved' | 'factory' }[] = ask.password
    ? [{ user: ask.user || adapter.user, password: ask.password, how: 'typed' }]
    : saved
      ? [{ user: saved.user, password: saved.password, how: 'saved' }]
      : adapter.defaults.map((password) => ({ user: adapter.user, password, how: 'factory' as const }));
  if (!tries.length) return { ok: false, model, need: 'password', hint: adapter.factory, user: adapter.user, error: `${model}: its password is needed.` };

  for (const t of tries) {
    const left = await adapter.attemptsLeft?.(http, ask.base).catch(() => undefined);
    // A typed password is his to try down to the last spare attempt; a saved or factory one never risks the lock.
    if (left !== undefined && left <= (t.how === 'typed' ? SPARE_ATTEMPTS - 1 : SPARE_ATTEMPTS)) {
      return {
        ok: false,
        model,
        need: 'password',
        hint: adapter.factory,
        user: adapter.user,
        attemptsLeft: left,
        error: `The router allows ${left === 1 ? 'one more try' : `${left} more tries`} before it locks its page: Argus does not risk it. Log in on the router's own page once, then try again.`,
      };
    }
    try {
      const clients = await adapter.read(new RouterHttp(), ask.base, t.user, t.password);
      if (t.how === 'typed') await keys.set(ask.mac, { user: t.user, password: t.password, model, saved: Math.floor(Date.now() / 1000) });
      return { ok: true, model, clients, factory: t.how === 'factory', saved: t.how !== 'factory' };
    } catch (err) {
      if (!(err instanceof Refused)) return { ok: false, model, error: `${model}: ${(err as Error).message}` };
      if (t.how === 'factory') continue;
      const after = await adapter.attemptsLeft?.(http, ask.base).catch(() => undefined);
      return {
        ok: false,
        model,
        need: 'password',
        hint: adapter.factory,
        user: t.user,
        ...(after !== undefined ? { attemptsLeft: after } : {}),
        error:
          (t.how === 'saved' ? 'The password saved for this router no longer lets Argus in: type the new one.' : 'The router refused this password.') +
          (after !== undefined ? ` It allows ${after === 1 ? 'one more try' : `${after} more tries`} before it locks its page.` : ''),
      };
    }
  }
  return { ok: false, model, need: 'password', hint: adapter.factory, user: adapter.user, error: `${model}: the factory password does not let Argus in (good: it was changed). Type it.` };
}
