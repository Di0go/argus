// Traffic in plain words: from what a conversation shows (the names its host was asked by in DNS or said in TLS, its
// address, its service) to who runs it, the app, the category and what someone is doing ("rr3---sn-….googlevideo.com"
// → Google · YouTube · watching video). The words are in shared/dictionary/apps.ts, on top of the open sources beside it;
// the server loads those (server/dictionary.ts) and gives what it says to every host and conversation, so the pages
// and the agent read it from there.
//
// It says only what is known. A name first (the most particular rule wins: googlevideo.com before google.com), then
// the network the address belongs to, then the port. A CDN or a cloud says who carries the bytes, not whose they are.

import { type Category, CATEGORIES, type Entry } from './dictionary/apps.ts';

export type { Category } from './dictionary/apps.ts';

export interface Classification {
  company?: string;
  /** The app or service; absent when only the company, the carrier or the site is known. */
  app?: string;
  category: Category;
  /** The category, as he would say it ("Video"). */
  label: string;
  /** What someone is doing, in plain English ("watching video"). */
  activity: string;
  /** Advertising, tracking or telemetry. */
  tracking: boolean;
  /** A CDN or cloud carrying others' bytes: the company is the carrier's, the app unknown. */
  carrier?: boolean;
  /** The registrable name it was known by ("googlevideo.com"), by the Public Suffix List. */
  site?: string;
  /** How it was known: by a name, by the address's network, by the port, or by how the traffic goes. */
  by: 'name' | 'network' | 'port' | 'pattern';
  /** The rule that said it: the name's suffix, "AS15169", "udp/3478". */
  rule: string;
}

/** What is known of a conversation, or of a host. */
export interface Clue {
  /** The names, most telling first: what TLS said, then what DNS answered. */
  names?: string[];
  ip?: string;
  /** "tcp/443", "udp/3478", "icmp" (shared/services.ts). */
  service?: string;
  /** What tshark recognised it as, above TCP or UDP ("wg", "stun"). */
  protocol?: string;
}

/** The open sources, as scripts/dictionary.ts writes them. */
export interface DictionaryData {
  v2fly: { domains: Record<string, [string, number]>; parents: Record<string, string[]> };
  psl: { rules: string[] };
  asn: { v4: [string, string, number][]; v6: [string, string, number][] };
}

/** The words: apps.ts's, and the house's own on top (data/dicionario.json: its work's domains, its devices' clouds). */
export interface Words {
  lists: Record<string, Entry>;
  domains: Record<string, Entry>;
  asns: Record<number, Entry>;
  ports: Record<string, Entry>;
  protocols: Record<string, Entry>;
}

const ADS = 1;
const FULL = 2;
const TELEMETRY = 4;

/** Apps that call: UDP with them, off the web's ports, is a call (WhatsApp, Messenger, Telegram, Signal, Discord…). */
const CALLING = new Set(['WhatsApp', 'Messenger', 'Telegram', 'Signal', 'Discord', 'FaceTime', 'Google Meet', 'Teams', 'Zoom', 'Skype', 'Viber', 'LINE', 'Slack']);
/** The ports of STUN and TURN: a call, or a game, finding its way through the router. */
const STUN = /^udp\/(3478|3479|3480|3481|5349|19302|19303|19304|19305|19306|19307|19308|19309)$/;

export class Dictionary {
  private readonly psl: Set<string>;
  private readonly v4: [number, number, number][];
  private readonly v6: [bigint, bigint, number][];
  private readonly lists = new Map<string, Entry | null>();
  private readonly data: DictionaryData;
  private readonly words: Words;

  constructor(data: DictionaryData, words: Words) {
    this.data = data;
    this.words = words;
    this.psl = new Set(data.psl.rules);
    this.v4 = data.asn.v4.map(([a, b, n]) => [ipv4(a), ipv4(b), n] as [number, number, number]).sort((x, y) => x[0] - y[0]);
    this.v6 = data.asn.v6.map(([a, b, n]) => [ipv6(a), ipv6(b), n] as [bigint, bigint, number]).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  }

  /** What a conversation, or a host, is: the best of what its names say, else its network, else its port. */
  classify(clue: Clue): Classification | undefined {
    let best = this.byNames(clue.names ?? []);
    const net = clue.ip ? this.byNetwork(clue.ip) : undefined;
    // A network that names the app tells more than a name that only says the carrier (a host behind its own CDN).
    if (net && rank(net) > rank(best) && (!best || best.carrier)) best = { ...net, site: best?.site };
    const port = clue.service ? this.byPort(clue.service) : undefined;
    if (port && (!best || (!best.app && !best.company))) best = port;
    else if (port && best?.carrier && !best.app) best = { ...port, company: best.company, site: best.site };
    if (!best && net) best = net;
    // What the traffic is tells more than whom it is with: WireGuard to a company's server is its VPN, whatever port.
    const proto = clue.protocol ? this.words.protocols[clue.protocol] : undefined;
    if (proto) {
      const known = port && port.category === proto.category ? port : { ...describe(proto), by: 'pattern' as const, rule: clue.protocol! };
      best = { ...known, ...(best?.company && !known.company ? { company: best.company } : {}), ...(best?.site ? { site: best.site } : {}) };
    }
    if (best && (clue.service || clue.protocol)) best = this.pattern(best, clue.service ?? '', clue.protocol);
    return best;
  }

  /**
   * What a host's names say together. One address serves many names (a CDN, a company's front door), and what went to
   * which is not seen: when they say one thing, that; when they say one app but several things, the app and "several
   * services"; when several apps of one company, those apps and the company. The best (app, then company, then carrier)
   * are the ones that count.
   */
  private byNames(names: string[]): Classification | undefined {
    const said = names.map((n) => this.byName(n)).filter((c): c is Classification => Boolean(c));
    const top = Math.max(0, ...said.map(rank));
    const best = said.filter((c) => rank(c) === top);
    const first = best[0];
    if (!first || best.every((c) => c.app === first.app && c.activity === first.activity && c.company === first.company)) return first;
    // The category most of them say, the first one's on a tie.
    const counts = new Map<Category, number>();
    for (const c of best) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    const category = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    const one = best.find((c) => c.category === category)!;
    const apps = [...new Set(best.map((c) => c.app).filter(Boolean))];
    const companies = [...new Set(best.map((c) => c.company).filter(Boolean))];
    const company = companies.length === 1 ? companies[0] : undefined;
    return {
      ...one,
      ...(company ? { company } : { company: undefined }),
      ...(apps.length ? { app: apps.length <= 3 ? apps.join(' / ') : `${apps.slice(0, 3).join(' / ')}…` } : {}),
      activity: `several services${apps.length === 1 ? ` (${apps[0]})` : company ? ` of ${company}` : ''}`,
      tracking: best.some((c) => c.tracking),
      rule: best.map((c) => c.rule).filter((r, i, a) => a.indexOf(r) === i).slice(0, 4).join(', '),
    };
  }

  /** The registrable part of a name ("rr3---sn-x.googlevideo.com" → "googlevideo.com"), by the Public Suffix List. */
  siteOf(name: string): string | undefined {
    const n = clean(name);
    if (!n || /^[\d.]+$/.test(n) || n.includes(':')) return undefined;
    const labels = n.split('.');
    if (labels.length < 2) return undefined;
    // The longest public suffix, from the longest candidate down: an exception ("!www.ck" takes one label off), a rule
    // ("co.uk"), or a wildcard ("*.ck", any one label before "ck"). None: the last label alone (the list's "*").
    let suffix = 1;
    for (let i = 0; i < labels.length; i++) {
      const rest = labels.slice(i).join('.');
      const length = labels.length - i;
      if (this.psl.has(`!${rest}`)) {
        suffix = length - 1;
        break;
      }
      if (this.psl.has(rest) || (length > 1 && this.psl.has(`*.${labels.slice(i + 1).join('.')}`))) {
        suffix = length;
        break;
      }
    }
    if (suffix >= labels.length) return undefined;
    return labels.slice(-(suffix + 1)).join('.');
  }

  /** What a name says: the most particular rule, the house's or the dictionary's, then the source lists'. */
  byName(name: string): Classification | undefined {
    const n = clean(name);
    if (!n || /^[\d.]+$/.test(n) || n.includes(':')) return undefined;
    const site = this.siteOf(n);
    // A certificate's status, asked of whoever issued it: ocsp.digicert.com, r10.o.lencr.org, crl3.digicert.com.
    if (/^(ocsp|crl)\d*\.|\.o\.lencr\.org$|\.c\.lencr\.org$/.test(n)) {
      return { ...describe({ app: 'Certificates', category: 'network', activity: 'checking certificates' }), site, by: 'name', rule: n };
    }
    // From the most particular suffix to the least: the first that knows the name says what it says, and what it
    // leaves out (the company, the app) is said by the less particular ("ping.archlinux.org" is a connectivity check,
    // "archlinux.org" says whose).
    const labels = n.split('.');
    let said: Entry | undefined;
    let rule = '';
    let before: string[] = [];
    for (let i = 0; i < labels.length - 1 && !(said?.app && said.company); i++) {
      const suffix = labels.slice(i).join('.');
      let entry = this.words.domains[suffix];
      if (!entry) {
        const hit = this.data.v2fly.domains[suffix];
        const list = hit && (!(hit[1] & FULL) || i === 0) ? this.list(hit[0]) : undefined;
        if (list) entry = hit![1] & ADS ? { ...list, category: 'ads', activity: undefined, tracking: true } : hit![1] & TELEMETRY ? { ...list, category: 'telemetry', activity: undefined, tracking: true } : list;
      }
      if (!entry) continue;
      if (!said) {
        said = strip(entry);
        rule = suffix;
        before = labels.slice(0, i);
      } else if (!said.carrier) said = fill(said, entry);
    }
    return said ? this.inside({ ...describe(said), site, by: 'name', rule }, before) : undefined;
  }

  /** What the address's network says (iptoasn.com): who runs it; the app only when the network is one app's own. */
  byNetwork(ip: string): Classification | undefined {
    const asn = ip.includes(':') ? find(this.v6, ipv6Safe(ip)) : find(this.v4, ipv4Safe(ip));
    const entry = asn === undefined ? undefined : this.words.asns[asn];
    return entry ? { ...describe(entry), by: 'network', rule: `AS${asn}` } : undefined;
  }

  byPort(service: string): Classification | undefined {
    const entry = this.words.ports[service] ?? (STUN.test(service) ? this.words.ports['udp/3478'] : undefined);
    return entry ? { ...describe(entry), by: 'port', rule: service } : undefined;
  }

  /**
   * A carrier's name sometimes holds its customer's: "audio-ak-spotify-com.akamaized.net" is Spotify's audio on
   * Akamai. The labels before the carrier's suffix are read as a name ("spotify-com" → "spotify.com").
   */
  private inside(c: Classification, before: string[]): Classification {
    if (!c.carrier || !before.length) return c;
    for (const label of before) {
      for (const m of label.matchAll(/([a-z0-9]+)-(com|net|org|tv|pt|io|co)(?=$|-)/g)) {
        const inner = this.byName(`${m[1]}.${m[2]}`);
        if (inner && !inner.carrier && inner.app) return { ...inner, by: 'name', rule: `${m[1]}.${m[2]} em ${c.rule}`, site: c.site };
      }
    }
    return c;
  }

  /** How the traffic goes says what the name cannot: UDP off the web's ports with an app that calls is a call. */
  private pattern(c: Classification, service: string, protocol?: string): Classification {
    const udp = service.startsWith('udp/') && service !== 'udp/443' && service !== 'udp/53' && service !== 'udp/123';
    const stun = protocol === 'stun' || STUN.test(service);
    if (c.app && CALLING.has(c.app) && (udp || stun)) {
      return { ...c, category: 'calls', label: CATEGORIES.calls.label, activity: 'on a call', by: 'pattern', rule: `${c.rule} + ${protocol ?? service}` };
    }
    // STUN with no app that calls: finding a way through the router, for a call, a VPN or a game; it does not say which.
    if (stun && !c.app) return { ...c, ...describe(this.words.ports['udp/3478']!), ...(c.company ? { company: c.company } : {}), by: 'pattern', rule: protocol ?? service };
    return c;
  }

  /** Who a source list is: its own entry, with what it leaves out said by the lists that include it. */
  private list(name: string, seen = new Set<string>()): Entry | undefined {
    if (this.lists.has(name)) return this.lists.get(name) ?? undefined;
    if (seen.has(name)) return undefined;
    seen.add(name);
    const own = this.words.lists[name];
    let entry: Entry | undefined = own ? { ...own } : undefined;
    let category: Entry | undefined;
    for (const parent of this.data.v2fly.parents[name] ?? []) {
      // An include that selects by attribute ("google @ads") is said by the attribute, on each domain.
      if (parent.includes('@')) continue;
      const p = this.list(parent, seen);
      if (!p) continue;
      if (parent.startsWith('category-')) category ??= p;
      else if (!entry) entry = { ...p };
      else entry = { ...p, ...strip(entry) };
    }
    if (!entry && category && !own) entry = { app: title(name), ...category };
    else if (entry && category) entry = { ...category, ...strip(entry) };
    if (entry && !entry.category) entry.category = 'web';
    this.lists.set(name, entry ?? null);
    return entry;
  }
}

/**
 * What `general` adds to `particular`: the company and the app it leaves out. Its category comes with its own activity
 * and tracking, or not at all: a connectivity check under archlinux.org stays a connectivity check.
 */
function fill(particular: Entry, general: Entry): Entry {
  const out: Entry = { ...particular };
  if (!out.company && general.company && !general.carrier) out.company = general.company;
  if (!out.app && general.app && !general.carrier) out.app = general.app;
  if (!out.category && general.category) Object.assign(out, strip({ category: general.category, activity: general.activity, tracking: general.tracking }));
  return out;
}

/** An entry's fields that are set. */
function strip(e: Entry): Entry {
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)) as Entry;
}

function describe(e: Entry): Omit<Classification, 'by' | 'rule'> {
  const category = e.category ?? 'web';
  const c = CATEGORIES[category];
  return {
    ...(e.company ? { company: e.company } : {}),
    ...(e.app ? { app: e.app } : {}),
    category,
    label: c.label,
    activity: e.activity ?? c.activity,
    tracking: e.tracking ?? c.tracking ?? false,
    ...(e.carrier ? { carrier: true } : {}),
  };
}

/** How much a classification says: the app (3), the company (2), only the carrier (1). */
function rank(c: Classification | undefined): number {
  if (!c) return 0;
  if (c.carrier) return 1;
  return c.app ? 3 : 2;
}

/** A source list's name, as a name ("ookla-speedtest" → "Ookla Speedtest"). */
function title(list: string): string {
  return list
    .split('-')
    .filter((w) => w !== '!cn')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function clean(name: string): string {
  return name.toLowerCase().trim().replace(/\.$/, '');
}

function ipv4(ip: string): number {
  return ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
}

function ipv4Safe(ip: string): number | undefined {
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ipv4(ip) : undefined;
}

function ipv6(ip: string): bigint {
  const [head = '', tail] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(Number.parseInt(g || '0', 16)), 0n);
}

function ipv6Safe(ip: string): bigint | undefined {
  try {
    return /^[0-9a-f:]+$/i.test(ip) ? ipv6(ip) : undefined;
  } catch {
    return undefined;
  }
}

/** The network whose range holds `ip`: a binary search over the ranges sorted by their start. */
function find<T extends number | bigint>(ranges: [T, T, number][], ip: T | undefined): number | undefined {
  if (ip === undefined) return undefined;
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end, asn] = ranges[mid]!;
    if (ip < start) hi = mid - 1;
    else if (ip > end) lo = mid + 1;
    else return asn;
  }
  return undefined;
}
