// Whom a device (or the whole house) is talking to now: its conversations of the last seconds grouped by who is at
// the other end (the app, else the company, else the site, else the host), each with what it is for, how fast it
// moves now (argus.flows) and since when. What a page shows live under "Talking to now".

import { companyOf, siteOf } from '../../../shared/sites.ts';
import type { Conversation, Device } from '../../../shared/types.ts';
import { subject } from '../../../shared/words.ts';
import { argus, type Source } from './argus.svelte.ts';
import { entityHref, link } from './router.svelte.ts';

export interface Talk {
  key: string;
  /** Who is at the other end, in a word: "Claude", "Google", "AWS", "iPhone". */
  name: string;
  /** What for: the dictionary's category ("Artificial intelligence"), or the service when it has none. */
  what: string;
  /** The device here that talks. */
  device?: Device;
  href: string;
  rate: number;
  bytes: number;
  since: number;
  last: number;
  /** What went in the clear, if anything did. */
  clear?: Conversation['clear'];
  conversations: number;
  /** The busiest conversation's rate: whose words `what` is. */
  top: number;
}

/** Talking now: a conversation heard in the last `window` seconds, or still moving. */
export function talks(source: Source, opts: { device?: string; window?: number; now?: number } = {}): Talk[] {
  const now = opts.now ?? Date.now() / 1000;
  const window = opts.window ?? 20;
  const devices = new Map(source.devices.map((d) => [`device:${d.id}`, d]));
  const by = new Map<string, Talk>();
  for (const c of source.conversations) {
    if (opts.device && c.a !== opts.device && c.b !== opts.device) continue;
    const rate = argus.flows[c.id] ?? 0;
    if (c.last < now - window && rate < 1) continue;
    const mine = opts.device ? (c.a === opts.device ? c.a : c.b) : c.a;
    const other = mine === c.a ? c.b : c.a;
    const end = otherEnd(source, c, other, devices);
    // Two devices here talking to each other are one line, whichever began.
    const key = devices.has(other) && !opts.device ? [mine, other].sort().join('\t') : `${mine}\t${end.name}`;
    const t = by.get(key) ?? {
      key,
      name: end.name,
      what: end.what,
      device: devices.get(mine),
      href: end.href,
      rate: 0,
      bytes: 0,
      since: c.first,
      last: c.last,
      conversations: 0,
      top: 0,
    };
    // What it is for is the busiest conversation's: Claude's API ahead of an update of its app.
    if (rate > t.top || (!t.top && !t.conversations)) {
      t.top = rate;
      t.what = end.what;
    }
    t.rate += rate;
    t.bytes += c.sent + c.received;
    t.since = Math.min(t.since, c.first);
    t.last = Math.max(t.last, c.last);
    t.conversations++;
    if (c.clear && !c.clear.harmless) t.clear = c.clear;
    by.set(key, t);
  }
  // A conversation is never faster than its whole device: the two are taken over three seconds cut a little apart (the
  // server's and the page's), and a stream's bursts fall either side.
  for (const t of by.values()) if (t.device) t.rate = Math.min(t.rate, argus.meters[t.device.id] ?? t.rate);
  return [...by.values()].sort((a, b) => b.rate - a.rate || b.last - a.last);
}

function otherEnd(source: Source, c: Conversation, other: string, devices: Map<string, Device>): { name: string; what: string; href: string } {
  const local = devices.get(other);
  if (local) return { name: local.name, what: 'On the network here', href: link.device(local.id) };
  const ip = other.replace(/^remote:/, '');
  const r = source.graph.get(other);
  const site = c.site ?? (r?.kind === 'remote' ? r.names.map((n) => siteOf(n.name)).find(Boolean) : undefined);
  const company = site ? companyOf(site) : undefined;
  const name = (c.app && !c.app.carrier ? subject(c.app) : undefined) ?? company ?? c.app?.company ?? (r?.name || ip);
  const href = company ? link.site(company) : entityHref('remote', ip);
  // A site the dictionary has no word for is said by its name already: what for is not known.
  return { name, what: c.app && c.app.by !== 'site' ? c.app.label : 'Unknown', href };
}
